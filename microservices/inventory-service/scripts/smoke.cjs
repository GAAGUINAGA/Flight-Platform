/* global process, console, __dirname */
// INV-14 ? smoke: QueryAvailability, CreateHold, GetHold, ReleaseHold (+ llamada sin llave).
//   INTERNAL_API_KEY=<llave> node microservices/inventory-service/scripts/smoke.cjs <host:puerto> [--insecure]
// Cloud Run: host = <servicio>.a.run.app:443 (TLS). Local: localhost:50051 --insecure.
// La llave solo se lee del entorno; nunca se imprime.
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const grpc = require('@grpc/grpc-js');
const { loadSync } = require('@grpc/proto-loader');

const target = process.argv[2];
const insecure = process.argv.includes('--insecure');
const key = process.env.INTERNAL_API_KEY;
if (!target || !key) {
  console.error('uso: INTERNAL_API_KEY=... node smoke.cjs <host:puerto> [--insecure]');
  process.exit(2);
}

const root = path.resolve(__dirname, '../../../contracts/proto');
const def = loadSync(path.join(root, 'flightplatform/inventory/v1/inventory.proto'), {
  includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true
});
const { InventoryService } = grpc.loadPackageDefinition(def).flightplatform.inventory.v1;
const client = new InventoryService(target, insecure ? grpc.credentials.createInsecure() : grpc.credentials.createSsl());

const call = (method, request, withKey = true) => new Promise((resolve, reject) => {
  const md = new grpc.Metadata();
  if (withKey) md.set('x-internal-key', key);
  md.set('x-role', 'customer');
  md.set('x-correlation-id', `smoke-${randomUUID()}`);
  client[method](request, md, { deadline: Date.now() + 15000 }, (err, res) => (err ? reject(err) : resolve(res)));
});

const steps = [];
const check = (name, ok, detail = '') => {
  steps.push(ok);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` ? ${detail}` : ''}`);
};

(async () => {
  const owner = `smoke-${randomUUID()}`;
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const avail = await call('QueryAvailability', {
    origin: 'UIO', destination: 'GYE', departureDate: date, passengers: { adults: 1, youths: 0, children: 0, infants: 0 }
  });
  const offer = avail.flights.find((f) => f.cabinClass === 'ECONOMY');
  check('QueryAvailability', Boolean(offer), `${avail.flights.length} opciones`);
  if (!offer) throw new Error('sin disponibilidad: ?se ejecut? el seed?');

  const hold = await call('CreateHold', {
    ownerId: owner, idempotencyKey: randomUUID(),
    segments: [{ flightInstanceId: offer.segment.flightInstanceId, cabinClass: 'ECONOMY', seats: 1 }]
  });
  check('CreateHold', hold.status === 'HELD', hold.status);
  const got = await call('GetHold', { holdId: hold.holdId, ownerId: owner });
  check('GetHold', got.status === 'HELD' && got.holdId === hold.holdId, got.status);
  const released = await call('ReleaseHold', { holdId: hold.holdId, ownerId: owner });
  check('ReleaseHold', released.status === 'RELEASED', released.status);
  const denied = await call('GetHold', { holdId: hold.holdId, ownerId: owner }, false).then(() => null, (e) => e.code);
  check('sin llave interna ? UNAUTHENTICATED', denied === grpc.status.UNAUTHENTICATED, `code ${denied}`);
})()
  .catch((e) => { check('smoke', false, `${e.code ?? ''} ${e.details ?? e.message}`); })
  .finally(() => {
    client.close();
    process.exit(steps.length > 0 && steps.every(Boolean) ? 0 : 1);
  });
