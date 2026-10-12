/* global console, process, __dirname */
// ANC-11 smoke. Required: INTERNAL_API_KEY, PRICING_GRPC_URL and target <host:443>.
// Optional: GRPC_TLS=true (default) or --insecure for local plaintext targets.
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const grpc = require('@grpc/grpc-js');
const { loadSync } = require('@grpc/proto-loader');

const target = process.argv[2];
const key = process.env.INTERNAL_API_KEY;
const pricingTarget = process.env.PRICING_GRPC_URL;
const insecure = process.argv.includes('--insecure') || process.env.GRPC_TLS === 'false';
if (!target || !key || !pricingTarget) { console.error('uso: INTERNAL_API_KEY=... PRICING_GRPC_URL=<host:443> node microservices/ancillaries-service/scripts/smoke.cjs <host:443> [--insecure]'); process.exit(2); }
const root = path.resolve(__dirname, '../../../contracts/proto');
const load = (name) => loadSync(path.join(root, ...name), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
const Ancillaries = grpc.loadPackageDefinition(load(['flightplatform', 'ancillaries', 'v1', 'ancillaries.proto'])).flightplatform.ancillaries.v1.AncillariesService;
const Pricing = grpc.loadPackageDefinition(load(['flightplatform', 'pricing', 'v1', 'pricing.proto'])).flightplatform.pricing.v1.PricingService;
const credentials = insecure ? grpc.credentials.createInsecure() : grpc.credentials.createSsl();
const ancillaries = new Ancillaries(target, credentials); const pricing = new Pricing(pricingTarget, credentials);
const outcomes = []; const ownerId = `smoke-${randomUUID()}`;
const check = (name, ok, detail = '') => { outcomes.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const metadata = (includeKey = true) => { const value = new grpc.Metadata(); if (includeKey) value.set('x-internal-key', key); value.set('x-owner-id', ownerId); value.set('x-role', 'system'); value.set('x-correlation-id', `anc-smoke-${randomUUID()}`); return value; };
const call = (client, method, request, includeKey = true) => new Promise((resolve, reject) => client[method](request, metadata(includeKey), { deadline: Date.now() + 15_000 }, (error, response) => error ? reject(error) : resolve(response)));
const verify = async (name, action, predicate) => { try { const value = await action(); check(name, predicate(value)); return value; } catch (error) { check(name, false, `code ${error.code ?? 'unknown'}`); return undefined; } };

(async () => {
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const offerResult = await verify('Pricing.SearchOffers', () => call(pricing, 'searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate: date }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } }), (value) => value.offers?.length > 0);
  const offer = offerResult?.offers?.[0]; const segment = offer?.itineraries?.[0]?.segments?.[0];
  const mapBefore = await verify('GetSeatMapForOffer', () => offer && segment ? call(ancillaries, 'getSeatMapForOffer', { offerId: offer.offerId, segmentId: segment.segmentId }) : Promise.reject({ code: 'missing_offer' }), (value) => value.cabins?.length > 0);
  const cabin = mapBefore?.cabins?.find((item) => item.rows?.some((row) => row.seats?.some((seat) => seat.isAvailable))) ?? mapBefore?.cabins?.[0];
  const seat = cabin?.rows?.flatMap((row) => row.seats).find((item) => item.isAvailable);
  const bookingId = randomUUID(); const passengerId = randomUUID();
  await verify('ReserveSeats', () => seat && cabin ? call(ancillaries, 'reserveSeats', { bookingId, assignments: [{ passengerId, segmentId: segment.segmentId, seatNumber: seat.seatNumber, passengerType: 'ADULT', cabinClass: cabin.cabinClass }] }) : Promise.reject({ code: 'missing_seat' }), (value) => value.assignments?.length === 1);
  await verify('seat map muestra ocupado', () => call(ancillaries, 'getSeatMapForOffer', { offerId: offer.offerId, segmentId: segment.segmentId }), (value) => value.cabins.flatMap((item) => item.rows).flatMap((row) => row.seats).some((item) => item.seatNumber === seat?.seatNumber && item.isAvailable === false));
  await verify('ReleaseSeats', () => call(ancillaries, 'releaseSeats', { bookingId }), (value) => Object.keys(value).length === 0);
  const denied = await call(ancillaries, 'getSeatMapForOffer', { offerId: offer.offerId, segmentId: segment.segmentId }, false).then(() => null, (error) => error.code);
  check('sin llave interna → UNAUTHENTICATED', denied === grpc.status.UNAUTHENTICATED, `code ${denied}`);
})().catch((error) => check('smoke', false, `code ${error.code ?? 'unknown'}`)).finally(() => { ancillaries.close(); pricing.close(); process.exit(outcomes.length > 0 && outcomes.every(Boolean) ? 0 : 1); });
