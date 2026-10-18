/* global console, process, __dirname */
// F9 smoke: this script creates and modifies one disposable reservation.
// Required: INTERNAL_API_KEY, PRICING_GRPC_URL and target <host:443>.
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const grpc = require('@grpc/grpc-js');
const { loadSync } = require('@grpc/proto-loader');

const target = process.argv[2];
const key = process.env.INTERNAL_API_KEY;
const pricingTarget = process.env.PRICING_GRPC_URL;
const insecure = process.argv.includes('--insecure') || process.env.GRPC_TLS === 'false';
if (!target || !key || !pricingTarget) {
  console.error('uso: INTERNAL_API_KEY=... PRICING_GRPC_URL=<host:443> node microservices/reservation-service/scripts/post-sale-smoke.cjs <host:443> [--insecure]');
  process.exit(2);
}

const root = path.resolve(__dirname, '../../../contracts/proto');
const load = (parts) => loadSync(path.join(root, ...parts), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
const Reservation = grpc.loadPackageDefinition(load(['flightplatform', 'reservation', 'v1', 'reservation.proto'])).flightplatform.reservation.v1.ReservationService;
const Pricing = grpc.loadPackageDefinition(load(['flightplatform', 'pricing', 'v1', 'pricing.proto'])).flightplatform.pricing.v1.PricingService;
const credentials = insecure ? grpc.credentials.createInsecure() : grpc.credentials.createSsl();
const reservation = new Reservation(target, credentials);
const pricing = new Pricing(pricingTarget, credentials);
const ownerId = process.env.POST_SALE_SMOKE_OWNER_ID || `pst-smoke-${randomUUID()}`;
const outcomes = [];
const metadata = () => { const value = new grpc.Metadata(); value.set('x-internal-key', key); value.set('x-owner-id', ownerId); value.set('x-role', 'customer'); value.set('x-correlation-id', `pst-smoke-${randomUUID()}`); return value; };
const call = (client, method, request) => new Promise((resolve, reject) => client[method](request, metadata(), { deadline: Date.now() + 20000 }, (error, response) => error ? reject(error) : resolve(response)));
const safeDetails = (error) => typeof error?.details === 'string' && /^[A-Z0-9_]+$/.test(error.details) ? error.details : 'REDACTED';
const run = async (name, action, predicate = () => true) => {
  try {
    const result = await action();
    if (!predicate(result)) throw Object.assign(new Error('assertion failed'), { code: 'ASSERTION_FAILED', details: 'ASSERTION_FAILED' });
    outcomes.push(true); console.log(`OK   ${name}`); return result;
  } catch (error) {
    outcomes.push(false); console.log(`FAIL ${name} code=${Number.isInteger(error?.code) ? error.code : error?.code ?? 'UNKNOWN'} details=${safeDetails(error)}`); return undefined;
  }
};

(async () => {
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const search = await run('Pricing.SearchOffers', () => call(pricing, 'searchOffers', { legs: [{ origin: 'UIO', destination: 'GYE', departureDate: date }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } }), (value) => value.offers?.length > 0);
  const selection = search?.offers?.flatMap((offer) => (offer.itineraries ?? []).map((itinerary) => ({ offer, itinerary, fare: itinerary.pricingOptions?.find((option) => option.fareRules?.isChangeable === true || (option.fareRules == null && ['CLASSIC', 'FLEX'].includes(option.fareBrand))) }))).find((item) => item.fare);
  const { offer, itinerary, fare } = selection ?? {};
  const hold = await run('Pricing.HoldOffer', () => {
    if (!search) throw Object.assign(new Error('offer unavailable'), { code: 'NOT_READY', details: 'NOT_READY' });
    if (!offer || !itinerary || !fare) throw Object.assign(new Error('no changeable fare available'), { code: 'NO_CHANGEABLE_FARE', details: 'NO_CHANGEABLE_FARE' });
    return call(pricing, 'holdOffer', { ownerId, offerId: offer.offerId, itinerarySelections: [{ itineraryId: itinerary.itineraryId, cabinClass: fare.cabinClass, fareBrand: fare.fareBrand }], passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, idempotencyKey: randomUUID() });
  }, (value) => Boolean(value.holdId));
  const passengerId = randomUUID();
  const booking = await run('CreateReservation', () => {
    if (!hold) throw Object.assign(new Error('hold unavailable'), { code: 'NOT_READY', details: 'NOT_READY' });
    return call(reservation, 'createReservation', { holdId: hold.holdId, passengers: [{ passengerId, passengerType: 'ADULT', firstName: 'Smoke', lastName: 'Passenger', documentType: 'PASSPORT', documentNumber: 'SMOKE123', nationality: 'EC', documentExpiryDate: '2030-01-01', birthDate: '1990-01-01', gender: 'X', contact: { email: 'smoke@example.invalid', phone: '+593999999999' }, assignedSeats: [], extraBaggage: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() });
  }, (value) => Boolean(value.bookingId) && value.status === 'CONFIRMED');
  const detail = await run('GetReservation', () => booking && call(reservation, 'getReservation', { bookingId: booking.bookingId }), (value) => value.status === 'CONFIRMED' && value.itineraries?.length > 0);
  const baggageOptions = await run('GetBaggageOptions', () => booking && call(reservation, 'getBaggageOptions', { bookingId: booking.bookingId }), (value) => Array.isArray(value?.options) && value.options.some((item) => item.passengerId === passengerId && item.maxAllowed > 0));
  const baggage = baggageOptions?.options.find((item) => item.passengerId === passengerId && item.maxAllowed > 0);
  await run('AddBaggage', () => {
    if (!booking || !baggage) throw Object.assign(new Error('baggage unavailable'), { code: 'NOT_READY', details: 'NOT_READY' });
    return call(reservation, 'addBaggage', { bookingId: booking.bookingId, passengerId, itineraryId: baggage.itineraryId, quantity: 1, payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() });
  }, (value) => value.passengerId === passengerId && value.totalBaggage >= 1);
  const first = detail?.itineraries?.[0];
  const oldDate = first?.segments?.[0]?.departure?.at;
  const nextDate = oldDate ? new Date(oldDate) : null;
  if (nextDate && !Number.isNaN(nextDate.getTime())) nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const dateSearch = await run('SearchDateChange', () => {
    if (!booking || !first?.itineraryId || !nextDate || Number.isNaN(nextDate.getTime())) throw Object.assign(new Error('itinerary departure unavailable'), { code: 'NOT_READY', details: 'NOT_READY' });
    return call(reservation, 'searchDateChange', { bookingId: booking.bookingId, changes: [{ itineraryId: first.itineraryId, newDepartureDate: nextDate.toISOString().slice(0, 10) }] });
  }, (value) => Array.isArray(value?.offers) && value.offers.some((item) => Boolean(item.changeOfferId)));
  const changeOffer = dateSearch?.offers.find((item) => item.changeOfferId);
  const changed = await run('ConfirmDateChange', () => {
    if (!booking || !changeOffer) throw Object.assign(new Error('change offer unavailable'), { code: 'NOT_READY', details: 'NOT_READY' });
    return call(reservation, 'confirmDateChange', { bookingId: booking.bookingId, changeOfferId: changeOffer.changeOfferId, payment: { paymentReference: `pay_ok_${randomUUID()}` }, assignedSeats: [], idempotencyKey: randomUUID() });
  }, (value) => value.bookingId === booking?.bookingId && value.status === 'CONFIRMED');
  const cancellationQuote = await run('GetCancellationQuote', () => changed && call(reservation, 'getCancellationQuote', { bookingId: booking.bookingId }), (value) => Boolean(value.quoteId));
  await run('CancelReservation', () => {
    if (!booking || !cancellationQuote) throw Object.assign(new Error('cancellation quote unavailable'), { code: 'NOT_READY', details: 'NOT_READY' });
    return call(reservation, 'cancelReservation', { bookingId: booking.bookingId, quoteId: cancellationQuote.quoteId, idempotencyKey: randomUUID() });
  }, (value) => value.bookingId === booking?.bookingId && value.status === 'CANCELLED');
})().finally(() => {
  reservation.close(); pricing.close();
  process.exit(outcomes.length >= 10 && outcomes.every(Boolean) ? 0 : 1);
});
