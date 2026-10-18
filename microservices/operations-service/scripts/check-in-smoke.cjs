/* global console, process, __dirname */
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { appendFileSync } = require('node:fs');
const grpc = require('@grpc/grpc-js');
const { loadSync } = require('@grpc/proto-loader');
const { findCandidate } = require('./check-in-offers.cjs');

const key = process.env.INTERNAL_API_KEY;
const targets = { operations: process.env.OPERATIONS_GRPC_URL, pricing: process.env.PRICING_GRPC_URL, reservation: process.env.RESERVATION_GRPC_URL };
if (!key || Object.values(targets).some((target) => !target)) {
  console.error('FAIL Configuration code=INVALID_ARGUMENT details=MISSING_CONFIGURATION');
  process.exitCode = 2;
} else {
  const root = path.resolve(__dirname, '../../../contracts/proto');
  const load = (name, service) => grpc.loadPackageDefinition(loadSync(path.join(root, 'flightplatform', name, 'v1', `${name}.proto`), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true })).flightplatform[name].v1[service];
  const creds = process.env.GRPC_TLS === 'false' ? grpc.credentials.createInsecure() : grpc.credentials.createSsl();
  const clients = { operations: new (load('operations', 'OperationsService'))(targets.operations, creds), pricing: new (load('pricing', 'PricingService'))(targets.pricing, creds), reservation: new (load('reservation', 'ReservationService'))(targets.reservation, creds) };
  const ownerId = process.env.CHECKIN_SMOKE_OWNER_ID || `dcs-smoke-${randomUUID()}`;
  const metadata = (role = 'customer', owner = ownerId, includeKey = true) => { const value = new grpc.Metadata(); if (includeKey) value.set('x-internal-key', key); value.set('x-owner-id', owner); value.set('x-role', role); value.set('x-correlation-id', `dcs-smoke-${randomUUID()}`); return value; };
  const call = (client, method, request, role, owner, includeKey = true) => new Promise((resolve, reject) => client[method](request, metadata(role, owner, includeKey), { deadline: Date.now() + 20000 }, (error, response) => error ? reject(error) : resolve(response)));
  const failed = (details) => Object.assign(new Error(details), { code: 'ASSERTION_FAILED', details });
  const step = async (name, action, predicate = () => true) => {
    try {
      const value = await action();
      if (!predicate(value)) throw failed('ASSERTION_FAILED');
      console.log(`OK   ${name}`);
      return value;
    } catch (error) {
      const code = Number.isInteger(error?.code) ? error.code : /^[A-Z_]+$/.test(String(error?.code)) ? error.code : 'UNKNOWN';
      const details = /^[A-Z0-9_]+$/.test(String(error?.details)) ? error.details : 'REDACTED';
      console.log(`FAIL ${name} code=${code} details=${details}`);
      throw error;
    }
  };

  (async () => {
    const passengerId = randomUUID();
    const candidate = await step('Pricing.SearchOffers', () => findCandidate((request) => call(clients.pricing, 'searchOffers', request), Date.now(), (result) => { if (process.env.CHECKIN_SMOKE_TRACE_FILE) for (const offer of result.offers ?? []) if (offer.offerId) appendFileSync(process.env.CHECKIN_SMOKE_TRACE_FILE, `${offer.offerId}\n`); }));
    const hold = await step('Pricing.HoldOffer', () => call(clients.pricing, 'holdOffer', { ownerId, offerId: candidate.offer.offerId, itinerarySelections: [{ itineraryId: candidate.itinerary.itineraryId, cabinClass: candidate.fare.cabinClass, fareBrand: candidate.fare.fareBrand }], passengersBreakdown: { adults: 1, youths: 0, children: 0, infants: 0 }, idempotencyKey: randomUUID() }), (value) => Boolean(value.holdId));
    const booking = await step('Reservation.CreateReservation', () => call(clients.reservation, 'createReservation', { ownerId, holdId: hold.holdId, passengers: [{ passengerId, passengerType: 'ADULT', firstName: 'Smoke', lastName: 'Passenger', documentType: 'PASSPORT', documentNumber: 'SMOKE123', nationality: 'EC', documentExpiryDate: '2039-01-01', birthDate: '1990-01-01', gender: 'X', contact: { email: 'smoke@example.invalid', phone: '+593999999999' }, assignedSeats: [], extraBaggage: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }), (value) => Boolean(value.bookingId) && value.status === 'CONFIRMED');
    const checkIn = await step('Operations.CheckIn', () => call(clients.operations, 'checkIn', { bookingId: booking.bookingId }), (value) => value.status === 'COMPLETED' && value.checkedInPassengers?.some((passenger) => passenger.passengerId === passengerId && passenger.status === 'CHECKED_IN'));
    await step('Operations.ListBoardingPasses', () => call(clients.operations, 'listBoardingPasses', { bookingId: booking.bookingId }), (value) => value.boardingPasses?.some((pass) => pass.passengerId === passengerId && pass.barcodeType === 'QR' && pass.barcode && pass.seat));
    await step('Operations.CheckInIdempotent', () => call(clients.operations, 'checkIn', { bookingId: booking.bookingId }), (value) => JSON.stringify(value) === JSON.stringify(checkIn));
    await step('Operations.OtherOwner', async () => { try { await call(clients.operations, 'listBoardingPasses', { bookingId: booking.bookingId }, 'customer', `other-${randomUUID()}`); } catch (error) { if (error.code === grpc.status.NOT_FOUND && error.details === 'NOT_FOUND') return true; throw error; } return false; }, (value) => value === true);
    await step('Operations.WithoutKey', async () => { try { await call(clients.operations, 'listBoardingPasses', { bookingId: booking.bookingId }, 'customer', ownerId, false); } catch (error) { if (error.code === grpc.status.UNAUTHENTICATED) return true; throw error; } return false; }, (value) => value === true);
  })().catch(() => { process.exitCode = 1; }).finally(() => { for (const client of Object.values(clients)) client.close(); });
}
