/* global process, console, __dirname */
// PRC-14: SearchOffers simple/multidestino, HoldOffer, GetOfferHold,
// ReleaseOfferHold y rechazo sin llave. La llave se lee del entorno y nunca se imprime.
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const grpc = require('@grpc/grpc-js');
const { loadSync } = require('@grpc/proto-loader');

const target = process.argv[2];
const insecure = process.argv.includes('--insecure');
const key = process.env.INTERNAL_API_KEY;
if (!target || !key) {
  console.error('uso: INTERNAL_API_KEY=... node microservices/pricing-service/scripts/smoke.cjs <host:puerto> [--insecure]');
  process.exit(2);
}

const root = path.resolve(__dirname, '../../../contracts/proto');
const definition = loadSync(path.join(root, 'flightplatform/pricing/v1/pricing.proto'), {
  includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true
});
const { PricingService } = grpc.loadPackageDefinition(definition).flightplatform.pricing.v1;
const client = new PricingService(target, insecure ? grpc.credentials.createInsecure() : grpc.credentials.createSsl());
const outcomes = [];
const passengers = { adults: 1, youths: 0, children: 0, infants: 0 };
const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const nextDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

const check = (name, ok, detail = '') => {
  outcomes.push(ok);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const call = (method, request, withKey = true) => new Promise((resolve, reject) => {
  const metadata = new grpc.Metadata();
  if (withKey) metadata.set('x-internal-key', key);
  metadata.set('x-role', 'customer');
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
  const simple = await verify('SearchOffers simple', () => call('SearchOffers', {
    legs: [{ origin: 'UIO', destination: 'GYE', departureDate: date }], passengers
  }), (response) => response.totalOffers > 0 && response.offers.length > 0);
  const multi = await verify('SearchOffers multidestino', () => call('SearchOffers', {
    legs: [{ origin: 'UIO', destination: 'GYE', departureDate: date }, { origin: 'GYE', destination: 'MIA', departureDate: nextDate }], passengers
  }), (response) => response.totalOffers > 0 && response.offers[0]?.itineraries?.length === 2);
  const offer = simple?.offers?.[0];
  const option = offer?.itineraries?.[0]?.pricingOptions?.[0];
  const hold = await verify('HoldOffer', () => offer && option ? call('HoldOffer', {
    ownerId, offerId: offer.offerId,
    itinerarySelections: [{ itineraryId: offer.itineraries[0].itineraryId, cabinClass: option.cabinClass, fareBrand: option.fareBrand }],
    passengersBreakdown: passengers, idempotencyKey: randomUUID()
  }) : Promise.reject({ code: 'missing_offer' }), (response) => response.status === 'HELD' && Boolean(response.holdId));
  await verify('GetOfferHold', () => hold ? call('GetOfferHold', { holdId: hold.holdId, ownerId }) : Promise.reject({ code: 'missing_hold' }),
    (response) => response.status === 'HELD');
  await verify('ReleaseOfferHold', () => hold ? call('ReleaseOfferHold', { holdId: hold.holdId, ownerId }) : Promise.reject({ code: 'missing_hold' }),
    (response) => Object.keys(response).length === 0);
  const denied = await call('SearchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate: date }], passengers }, false).then(() => null, (error) => error.code);
  check('sin llave interna → UNAUTHENTICATED', denied === grpc.status.UNAUTHENTICATED, `code ${denied}`);
  void multi;
})()
  .catch((error) => check('smoke', false, `code ${error.code ?? 'unknown'}`))
  .finally(() => {
    client.close();
    process.exit(outcomes.length > 0 && outcomes.every(Boolean) ? 0 : 1);
  });
