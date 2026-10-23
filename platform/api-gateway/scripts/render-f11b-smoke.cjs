const { randomUUID } = require('node:crypto');
const process = require('node:process');

const required = (name) => { if (!process.env[name]) throw new Error(`${name}: status 0, code MISSING_ENV`); return process.env[name]; };
async function main() {
  const base = required('BASE_URL').replace(/\/$/, '');
  const token = required('SUPABASE_CUSTOMER_TOKEN');
  const auth = { authorization: `Bearer ${token}` };
  const json = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const post = (body) => json(body, { ...auth, 'idempotency-key': randomUUID() });
  const fail = (name, status, code) => { throw new Error(`${name}: status ${status}, code ${code}`); };
  async function call(name, path, expected, options = {}, report = true) {
    let response;
    try { response = await globalThis.fetch(`${base}/flights/v1${path}`, options); }
    catch { fail(name, 0, 'NETWORK_ERROR'); }
    const body = await response.json().catch(() => ({}));
    if (response.status !== expected) fail(name, response.status, body.code || 'UNKNOWN');
    if (report) process.stdout.write(`OK   ${name}\n`);
    return body;
  }
  async function choose(name, checkIn) {
    const now = Date.now();
    for (let day = 0; day <= (checkIn ? 2 : 14); day++) {
      const departureDate = new Date(now + day * 86400000).toISOString().slice(0, 10);
      const result = await call(name, '/search', 200, json({ itineraries: [{ origin: process.env.SMOKE_ORIGIN || 'UIO', destination: process.env.SMOKE_DESTINATION || 'GYE', departureDate }], passengers: { adults: 1 } }, { 'x-device-fingerprint': randomUUID() }), false);
      for (const offer of result.offers || []) for (const itinerary of offer.itineraries || []) {
        const segment = itinerary.segments?.find((item) => {
          const start = Date.parse(item.departure?.at);
          const named = checkIn ? process.env.SMOKE_CHECKIN_FLIGHT_NUMBER : process.env.SMOKE_POSTSALE_FLIGHT_NUMBER;
          return Number.isFinite(start) && (!named || item.flightNumber === named) && (checkIn ? start >= now + 2 * 3600000 && start <= now + 47 * 3600000 : start > now + 6 * 3600000);
        });
        const option = itinerary.pricingOptions?.find((item) => item.availableSeats > 0 && (checkIn || item.fareRules?.isChangeable === true));
        if (segment && option && itinerary.segments.length === 1) { process.stdout.write(`OK   ${name}\n`); return { offer, itinerary, segment, option }; }
      }
    }
    fail(name, 200, 'NO_SUITABLE_FLIGHT');
  }
  async function buy(name, candidate, seat) {
    const { offer, itinerary, segment, option } = candidate;
    const hold = await call(`${name} hold`, '/offers/hold', 201, post({ offerId: offer.offerId, itinerarySelections: [{ itineraryId: itinerary.itineraryId, cabinClass: option.cabinClass, fareBrand: option.fareBrand }], passengersBreakdown: { adults: 1 } }));
    const passengerId = randomUUID();
    const booking = await call(`${name} reserva`, '/bookings', 201, post({ holdId: hold.holdId, passengers: [{ passengerId, passengerType: 'ADULT', firstName: 'Smoke', lastName: 'Passenger', documentType: 'PASSPORT', documentNumber: 'SMOKE123', nationality: 'EC', documentExpiryDate: '2035-01-01', birthDate: '1990-01-01', gender: 'X', contact: { email: 'smoke@example.invalid', phone: '+593999999999' }, assignedSeats: seat ? [{ segmentId: segment.segmentId, seatNumber: seat }] : [], extraBaggage: [] }], payment: { paymentReference: `pay_ok_${randomUUID()}` } }));
    if (booking.status !== 'CONFIRMED') fail(`${name} reserva`, 201, 'BOOKING_NOT_CONFIRMED');
    return { path: `/bookings/${encodeURIComponent(booking.bookingId)}`, passengerId };
  }
  const sale = await choose('J5 búsqueda', false); const purchased = await buy('J5', sale);
  const options = await call('J5 equipaje opciones', `${purchased.path}/baggage-options`, 200, { headers: auth });
  const baggage = options.find((item) => item.passengerId === purchased.passengerId && item.itineraryId === sale.itinerary.itineraryId && item.maxAllowed > 0);
  if (!baggage) fail('J5 equipaje opciones', 200, 'NO_BAGGAGE_OPTION');
  await call('J5 equipaje', `${purchased.path}/baggage`, 200, post({ passengerId: purchased.passengerId, itineraryId: sale.itinerary.itineraryId, quantity: 1, payment: { paymentReference: `pay_ok_${randomUUID()}` } }));
  const originalDate = sale.segment.departure.at.slice(0, 10); let selected;
  for (let day = 1; day <= 14 && !selected; day++) {
    const date = new Date(Date.parse(`${originalDate}T00:00:00Z`) + day * 86400000).toISOString().slice(0, 10);
    const changes = await call('J5 buscar cambio', `${purchased.path}/date-change/search`, 200, json({ changes: [{ itineraryId: sale.itinerary.itineraryId, newDepartureDate: date }] }, auth), false);
    selected = changes.find((item) => item.changeOfferId && Date.parse(item.expiresAt) > Date.now());
  }
  if (!selected) fail('J5 buscar cambio', 200, 'NO_CHANGE_OFFER');
  process.stdout.write('OK   J5 buscar cambio\n');
  await call('J5 cambio', `${purchased.path}/date-change`, 200, post({ changeOfferId: selected.changeOfferId, assignedSeats: [], payment: { paymentReference: `pay_ok_${randomUUID()}` } }));
  const quote = await call('J5 cotización', `${purchased.path}/cancellation-quote`, 200, { headers: auth });
  await call('J5 cancelación', `${purchased.path}/cancel`, 200, post({ quoteId: quote.quoteId }));
  const day = await choose('J6 búsqueda', true);
  const map = await call('J6 mapa', `/offers/${encodeURIComponent(day.offer.offerId)}/seatmap?segmentId=${encodeURIComponent(day.segment.segmentId)}`, 200, { headers: { 'x-device-fingerprint': randomUUID() } });
  const cabin = map.cabins?.find((item) => item.cabinClass === day.option.cabinClass);
  const seat = cabin?.rows?.flatMap((row) => row.seats || []).find((item) => item.isAvailable)?.seatNumber;
  if (!seat) fail('J6 mapa', 200, 'NO_AVAILABLE_SEAT');
  const checkInBooking = await buy('J6', day, seat);
  const checkIn = await call('J6 check-in', `${checkInBooking.path}/check-in`, 200, { method: 'POST', headers: auth });
  if (!checkIn.checkedInPassengers?.some((item) => item.passengerId === checkInBooking.passengerId && item.status === 'CHECKED_IN')) fail('J6 check-in', 200, 'NOT_CHECKED_IN');
  const passes = await call('J6 pases', `${checkInBooking.path}/boarding-passes`, 200, { headers: auth });
  if (!passes.boardingPasses?.some((item) => item.passengerId === checkInBooking.passengerId && item.segmentId === day.segment.segmentId && item.seat === seat && item.barcode)) fail('J6 pases', 200, 'NO_BOARDING_PASS');
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
