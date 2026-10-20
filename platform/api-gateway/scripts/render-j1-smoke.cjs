const { randomUUID } = require('node:crypto');
const process = require('node:process');

function required(name) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
  return process.env[name];
}

async function main() {
  const base = required('BASE_URL').replace(/\/$/, '');
  const token = required('SUPABASE_CUSTOMER_TOKEN');
  const authorization = { authorization: `Bearer ${token}` };
  async function step(name, path, expected, options = {}) {
    const response = await globalThis.fetch(`${base}/flights/v1${path}`, options);
    const body = await response.json().catch(() => ({}));
    if (response.status !== expected) throw new Error(`${name}: status ${response.status}, code ${typeof body.code === 'string' ? body.code : 'UNKNOWN'}`);
    process.stdout.write(`OK   ${name}\n`);
    return body;
  }
  const json = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  await step('sin token', '/bookings', 401);
  const departureDate = process.env.SMOKE_DEPARTURE_DATE || new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const search = await step('search', '/search', 200, json({ itineraries: [{ origin: process.env.SMOKE_ORIGIN || 'UIO', destination: process.env.SMOKE_DESTINATION || 'GYE', departureDate }], passengers: { adults: 1 } }, { 'x-device-fingerprint': randomUUID() }));
  const offer = search.offers?.find((item) => item.itineraries?.some((itinerary) => itinerary.pricingOptions?.some((option) => option.availableSeats > 0)));
  if (!offer) throw new Error('search: status 200, code NO_AVAILABLE_OFFER');
  const itinerary = offer.itineraries.find((item) => item.pricingOptions?.some((option) => option.availableSeats > 0));
  const option = itinerary.pricingOptions.find((item) => item.availableSeats > 0);
  const segment = itinerary.segments.find((item) => item.segmentId);
  if (!segment) throw new Error('search: status 200, code NO_SEGMENT');
  const map = await step('seatmap', `/offers/${encodeURIComponent(offer.offerId)}/seatmap?segmentId=${encodeURIComponent(segment.segmentId)}`, 200, { headers: { 'x-device-fingerprint': randomUUID() } });
  if (map.segmentId !== segment.segmentId) throw new Error('seatmap: status 200, code SEGMENT_MISMATCH');
  const hold = await step('hold', '/offers/hold', 201, json({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: itinerary.itineraryId, cabinClass: option.cabinClass, fareBrand: option.fareBrand }], passengersBreakdown: { adults: 1 } }, { ...authorization, 'idempotency-key': randomUUID() }));
  const passengerId = randomUUID();
  const booking = await step('booking', '/bookings', 201, json({ holdId: hold.holdId, passengers: [{ passengerId, passengerType: 'ADULT', firstName: 'Smoke', lastName: 'Passenger', documentType: 'PASSPORT', documentNumber: 'SMOKE123', nationality: 'EC', documentExpiryDate: '2035-01-01', birthDate: '1990-01-01', gender: 'X', contact: { email: 'smoke@example.invalid', phone: '+593999999999' }, assignedSeats: [], extraBaggage: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` } }, { ...authorization, 'idempotency-key': randomUUID() }));
  const path = `/bookings/${encodeURIComponent(booking.bookingId)}`;
  const detail = await step('detalle', path, 200, { headers: authorization });
  if (detail.bookingId !== booking.bookingId || detail.status !== 'CONFIRMED') throw new Error('detalle: status 200, code BOOKING_MISMATCH');
  const tickets = await step('tickets', `${path}/tickets`, 200, { headers: authorization });
  if (!tickets.tickets?.some((item) => item.passengerId === passengerId && item.status === 'ISSUED')) throw new Error('tickets: status 200, code NO_ISSUED_TICKET');
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
