/* global process, console, __dirname */
// TKT-09 smoke: IssueTickets, ListTickets, GetTicket y llamada sin llave.
// INTERNAL_API_KEY=<llave> node microservices/ticketing-service/scripts/smoke.cjs <host:puerto> [--insecure]
// Cloud Run usa <servicio>.a.run.app:443 (TLS); local usa localhost:puerto --insecure.
// La llave se lee solo desde el entorno y nunca se registra.
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
const definition = loadSync(path.join(root, 'flightplatform/ticketing/v1/ticketing.proto'), {
  includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true
});
const { TicketingService } = grpc.loadPackageDefinition(definition).flightplatform.ticketing.v1;
const client = new TicketingService(target, insecure ? grpc.credentials.createInsecure() : grpc.credentials.createSsl());
const outcomes = [];

const check = (name, ok, detail = '') => {
  outcomes.push(ok);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const call = (method, request, withKey = true, role = 'system') => new Promise((resolve, reject) => {
  const metadata = new grpc.Metadata();
  if (withKey) metadata.set('x-internal-key', key);
  metadata.set('x-role', role);
  metadata.set('x-correlation-id', `smoke-${randomUUID()}`);
  client[method](request, metadata, { deadline: Date.now() + 15_000 }, (error, response) => (error ? reject(error) : resolve(response)));
});
const verify = async (name, action, predicate) => {
  try {
    const response = await action();
    check(name, predicate(response));
    return response;
  } catch (error) {
    check(name, false, `code ${error.code ?? 'unknown'}`);
    return undefined;
  }
};

(async () => {
  const ownerId = `smoke-${randomUUID()}`;
  const bookingId = randomUUID();
  const issue = await verify('IssueTickets', () => call('IssueTickets', {
    bookingId, ownerId, requestId: randomUUID(),
    passengers: [{ passengerId: `passenger-${randomUUID()}`, passengerType: 'ADULT', firstName: 'Smoke', lastName: 'Test' }],
    itineraries: [{ itineraryId: `itinerary-${randomUUID()}`, segments: [{ segmentId: `segment-${randomUUID()}` }] }]
  }), (response) => response.bookingId === bookingId && response.tickets.length === 1 && /^\d{13}$/.test(response.tickets[0].eTicketNumber));

  const listed = await verify('ListTickets', () => call('ListTickets', { bookingId, ownerId }, true, 'customer'),
    (response) => response.bookingId === bookingId && response.tickets.length === 1);
  const ticketId = listed?.tickets?.[0]?.ticketId ?? issue?.tickets?.[0]?.ticketId;
  await verify('GetTicket', () => ticketId ? call('GetTicket', { bookingId, ticketId, ownerId }, true, 'customer') : Promise.reject({ code: 'missing_ticket' }),
    (response) => response.ticketId === ticketId && response.bookingId === bookingId);
  const denied = await call('ListTickets', { bookingId, ownerId }, false, 'customer').then(() => null, (error) => error.code);
  check('sin llave interna → UNAUTHENTICATED', denied === grpc.status.UNAUTHENTICATED, `code ${denied}`);
})()
  .catch((error) => check('smoke', false, `code ${error.code ?? 'unknown'}`))
  .finally(() => {
    client.close();
    process.exit(outcomes.length > 0 && outcomes.every(Boolean) ? 0 : 1);
  });
