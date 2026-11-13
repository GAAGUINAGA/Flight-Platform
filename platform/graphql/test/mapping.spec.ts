import { Buffer } from 'node:buffer';
import { afterAll, describe, expect, it } from '@jest/globals';
import { cleanupKeys, FINGERPRINT, makeApp, run, tokenFor, UUID_A, UUID_B } from './helpers';

afterAll(cleanupKeys);
const money = (total: string) => ({ currency: 'USD', total, baseFare: total, taxes: '0.00' });
const booking = { bookingId: UUID_A, pnr: 'ABC123', status: 'CONFIRMED', grandTotal: money('100.00'), createdAt: '2026-11-12T10:00:00Z', itineraries: [], paymentReference: 'pay_ok_secret', holdId: UUID_B, tickets: [{ ticketId: 't1', passengerId: 'PAX-1', status: 'ISSUED' }], passengers: [{ passengerId: 'PAX-1', passengerType: 'ADULT', firstName: 'Ana', lastName: 'Paz', documentType: 'PASSPORT', documentNumber: 'AB1234567', nationality: 'EC', birthDate: '1990-01-01', gender: 'F', assignedSeats: [{ segmentId: 's1', seatNumber: '1A' }], extraBaggage: [] }], changes: [{ changedAt: '2026-11-12T10:00:00Z', description: 'CONFIRMED' }], _links: { self: { href: 'x' }, cancel: { href: 'y' }, 'check-in': { href: 'z' } } };
const passenger = { passengerId: 'PAX-1', passengerType: 'ADULT', firstName: 'Ana', lastName: 'Paz', documentType: 'PASSPORT', documentNumber: 'AB1234567', nationality: 'EC', birthDate: '1990-01-01', gender: 'F', contact: { email: 'ana@example.test', phone: '+593999999999' } };
const customer = tokenFor('user-1'); const admin = tokenFor('admin-1', 'admin');

describe('GQL-MAP: cada operación se traduce a una llamada v2 y vuelve con tipos explícitos (Gateway simulado)', () => {
  it('GQL-MAP-01 searchFlights: POST /search con la huella, sin token, y el resultado pasa tal cual', async () => {
    const { app, gateway } = makeApp(); gateway.responder = () => ({ status: 200, body: { totalOffers: 1, offers: [{ offerId: 'O1', airline: { code: 'FP', name: 'GabatAIR' }, grandTotal: money('100.00'), itineraries: [] }] } });
    const reply = await run(app, 'SearchFlights', { input: { itineraries: [{ origin: 'UIO', destination: 'GYE', departureDate: '2026-12-01' }], passengers: { adults: 1 } } }, { fingerprint: FINGERPRINT, token: customer });
    expect(reply.body.errors).toBeUndefined(); expect(reply.body.data).toMatchObject({ searchFlights: { totalOffers: 1, offers: [{ offerId: 'O1', grandTotal: { currency: 'USD', total: '100.00' } }] } });
    expect(gateway.calls).toHaveLength(1); expect(gateway.calls[0]).toMatchObject({ method: 'POST', path: '/api/v2/vuelos/search', body: { itineraries: [{ origin: 'UIO', destination: 'GYE', departureDate: '2026-12-01' }], passengers: { adults: 1 } } });
    expect(gateway.calls[0].headers['X-Device-Fingerprint']).toBe(FINGERPRINT); expect(gateway.calls[0].headers.Authorization).toBeUndefined();
  });
  it('GQL-MAP-02 searchFlights sin huella ⇒ VALIDATION y no llama al Gateway; IATA o fecha inválidos ⇒ VALIDATION', async () => {
    const { app, gateway } = makeApp(); const input = { itineraries: [{ origin: 'UIO', destination: 'GYE', departureDate: '2026-12-01' }], passengers: { adults: 1 } };
    const noFp = await run(app, 'SearchFlights', { input }); expect(noFp.body.errors?.[0].extensions).toMatchObject({ code: 'VALIDATION_FAILED', category: 'VALIDATION' });
    const badIata = await run(app, 'SearchFlights', { input: { ...input, itineraries: [{ origin: 'uio', destination: 'GYE', departureDate: '2026-12-01' }] } }, { fingerprint: FINGERPRINT }); expect(badIata.body.errors?.[0].extensions.category).toBe('VALIDATION');
    const badDate = await run(app, 'SearchFlights', { input: { ...input, itineraries: [{ origin: 'UIO', destination: 'GYE', departureDate: '01/12/2026' }] } }, { fingerprint: FINGERPRINT }); expect(badDate.body.errors?.length).toBe(1);
    expect(gateway.calls).toHaveLength(0);
  });
  it('GQL-MAP-03 seatMap con HELD y flightStatus (públicas, sin token)', async () => {
    const { app, gateway } = makeApp();
    gateway.responder = (request) => request.path.endsWith('/seatmap') ? { status: 200, body: { segmentId: 's1', cabins: [{ cabinClass: 'ECONOMY', rows: [{ rowNumber: 1, seats: [{ seatNumber: '1A', status: 'HELD', isAvailable: false, characteristics: ['WINDOW'] }] }] }] } } : { status: 200, body: { flightNumber: 'FP103', date: '2026-12-01', marketingCarrier: 'FP', operatingCarrier: 'FP', status: 'SCHEDULED', delayMinutes: 0, departure: { iataCode: 'UIO', scheduledAt: '2026-12-01T10:00:00-05:00' }, arrival: { iataCode: 'GYE', scheduledAt: '2026-12-01T11:00:00-05:00' } } };
    const map = await run(app, 'SeatMap', { offerId: 'O1', segmentId: 's1' }); expect(map.body.data).toMatchObject({ seatMap: { cabins: [{ rows: [{ seats: [{ seatNumber: '1A', status: 'HELD', isAvailable: false, characteristics: ['WINDOW'] }] }] }] } });
    expect(gateway.calls[0]).toMatchObject({ method: 'GET', path: '/api/v2/vuelos/offers/O1/seatmap', query: { segmentId: 's1' } });
    const status = await run(app, 'FlightStatus', { flightNumber: 'FP103', date: '2026-12-01' }); expect(status.body.data).toMatchObject({ flightStatus: { flightNumber: 'FP103', status: 'SCHEDULED' } });
  });
  it('GQL-MAP-04 holdOffer: selections → itinerarySelections, passengers → passengersBreakdown, seats → assignedSeats (solo si hay) e Idempotency-Key reenviada', async () => {
    const { app, gateway } = makeApp(); gateway.responder = () => ({ status: 201, body: { holdId: UUID_A, status: 'HELD', expiresAt: '2026-12-01T10:15:00Z', ttlMinutes: 15, lockedPrice: money('100.00') } });
    const input = { offerId: 'O1', selections: [{ itineraryId: 'I1', cabinClass: 'ECONOMY', fareBrand: 'BASIC' }], passengers: { adults: 1 }, ttlMinutes: 15, seats: [{ segmentId: 's1', seatNumber: '1A' }] };
    const reply = await run(app, 'HoldOffer', { input, idempotencyKey: UUID_B }, { token: customer }); expect(reply.body.errors).toBeUndefined(); expect(reply.body.data).toMatchObject({ holdOffer: { holdId: UUID_A, status: 'HELD', ttlMinutes: 15, lockedPrice: { total: '100.00' } } });
    expect(gateway.calls[0]).toMatchObject({ method: 'POST', path: '/api/v2/vuelos/offers/hold', body: { offerId: 'O1', itinerarySelections: input.selections, passengersBreakdown: { adults: 1 }, ttlMinutes: 15, assignedSeats: input.seats } });
    expect(gateway.calls[0].headers['Idempotency-Key']).toBe(UUID_B); expect(gateway.calls[0].headers.Authorization).toBe(`Bearer ${customer}`);
    await run(app, 'HoldOffer', { input: { ...input, seats: [], ttlMinutes: null }, idempotencyKey: UUID_B }, { token: customer }); expect(gateway.calls[1].body).not.toHaveProperty('assignedSeats'); expect(gateway.calls[1].body).not.toHaveProperty('ttlMinutes');
  });
  it('GQL-MAP-05 holdOffer rechaza una clave de idempotencia que no es UUID y un ttl fuera de 5..30 sin llamar al Gateway', async () => {
    const { app, gateway } = makeApp(); const input = { offerId: 'O1', selections: [{ itineraryId: 'I1', cabinClass: 'ECONOMY', fareBrand: 'BASIC' }], passengers: { adults: 1 } };
    expect((await run(app, 'HoldOffer', { input, idempotencyKey: 'no-uuid' }, { token: customer })).body.errors?.[0].extensions.code).toBe('VALIDATION_FAILED');
    expect((await run(app, 'HoldOffer', { input: { ...input, ttlMinutes: 99 }, idempotencyKey: UUID_B }, { token: customer })).body.errors?.[0].extensions.code).toBe('VALIDATION_FAILED'); expect(gateway.calls).toHaveLength(0);
  });
  it('GQL-MAP-06 createBooking: 201 ⇒ COMPLETED, 202 ⇒ PENDING; envía solo holdId, pasajeros y payment.paymentReference (sin amount, canal, provider ni X-User-Id)', async () => {
    const { app, gateway } = makeApp(); let status = 201; gateway.responder = () => ({ status, body: booking });
    const input = { holdId: UUID_A, passengers: [passenger], paymentReference: 'pay_ok_123' };
    const done = await run(app, 'CreateBooking', { input, idempotencyKey: UUID_B }, { token: customer }); expect(done.body.errors).toBeUndefined(); expect(done.body.data).toMatchObject({ createBooking: { outcome: 'COMPLETED', booking: { bookingId: UUID_A, pnr: 'ABC123', status: 'CONFIRMED', availableActions: ['cancel', 'check-in'] } } });
    status = 202; expect((await run(app, 'CreateBooking', { input, idempotencyKey: UUID_B }, { token: customer })).body.data).toMatchObject({ createBooking: { outcome: 'PENDING' } });
    const sent = gateway.calls[0]; expect(Object.keys(sent.body as object).sort()).toEqual(['holdId', 'passengers', 'payment']); expect(sent.body).toMatchObject({ payment: { paymentReference: 'pay_ok_123' } }); expect(JSON.stringify(sent.body)).not.toMatch(/paymentChannel|provider|salesChannel|amount/);
    expect(Object.keys(sent.headers).map((name) => name.toLowerCase())).not.toContain('x-user-id'); expect(sent.headers['Idempotency-Key']).toBe(UUID_B);
  });
  it('GQL-MAP-07 el documento sale enmascarado y paymentReference/holdId no existen en el esquema ni en la respuesta', async () => {
    const { app, gateway } = makeApp(); gateway.responder = () => ({ status: 200, body: booking });
    const reply = await run(app, 'Booking', { bookingId: UUID_A }, { token: customer }); const text = JSON.stringify(reply.body);
    expect(reply.body.data).toMatchObject({ booking: { passengers: [{ documentNumberMasked: '******567' }] } }); expect(text).not.toContain('AB1234567'); expect(text).not.toContain('pay_ok_secret'); expect(text).not.toContain('paymentReference'); expect(text).not.toContain('holdId');
    const direct = await (await import('supertest')).default(app).post('/graphql').send({ query: `query { booking(bookingId: "${UUID_A}") { paymentReference } }` }).set('Authorization', `Bearer ${customer}`); expect(direct.status).toBe(400);
    const documentQuery = await (await import('supertest')).default(app).post('/graphql').send({ query: `query { booking(bookingId: "${UUID_A}") { passengers { documentNumber } } }` }).set('Authorization', `Bearer ${customer}`); expect(documentQuery.status).toBe(400);
  });
  it('GQL-MAP-08 myBookings: first/after → limit/cursor, pageInfo desde nextCursor (sin modificarlo) y first>50 ⇒ VALIDATION', async () => {
    const { app, gateway } = makeApp(); gateway.responder = () => ({ status: 200, body: { nextCursor: 'CURSOR-ABC_123', items: [{ bookingId: UUID_A, pnr: 'ABC123', status: 'CONFIRMED', origin: 'UIO', destination: 'GYE', departureDate: '2026-12-01', grandTotal: money('100.00'), _links: { self: { href: 'x' } } }] } });
    const reply = await run(app, 'MyBookings', { first: 3, after: 'PREV-CURSOR', filter: { status: 'CONFIRMED', pnr: 'ABC123' } }, { token: customer });
    expect(reply.body.data).toMatchObject({ myBookings: { edges: [{ cursor: UUID_A, node: { bookingId: UUID_A, origin: 'UIO', availableActions: [] } }], pageInfo: { endCursor: 'CURSOR-ABC_123', hasNextPage: true } } });
    expect(gateway.calls[0]).toMatchObject({ method: 'GET', path: '/api/v2/vuelos/bookings', query: { limit: 3, cursor: 'PREV-CURSOR', status: 'CONFIRMED', pnr: 'ABC123' } });
    gateway.responder = () => ({ status: 200, body: { nextCursor: null, items: [] } }); expect((await run(app, 'MyBookings', {}, { token: customer })).body.data).toMatchObject({ myBookings: { edges: [], pageInfo: { endCursor: null, hasNextPage: false } } }); expect(gateway.calls[1].query?.limit).toBe(10);
    const tooMany = await run(app, 'MyBookings', { first: 51 }, { token: customer }); expect(tooMany.body.errors?.[0].extensions).toMatchObject({ category: 'VALIDATION' }); expect(gateway.calls).toHaveLength(2);
  });
  it('GQL-MAP-08b (audit-25 H1): el cursor es OPACO: el compuesto (fecha|id en base64url) viaja y vuelve byte a byte, sin parsearlo ni formatearlo; un 400 VALIDATION_FAILED del Gateway sube como VALIDATION', async () => {
    const composite = Buffer.from(`2026-11-12T10:00:00.123Z|${UUID_A}`).toString('base64url'); const { app, gateway } = makeApp();
    gateway.responder = () => ({ status: 200, body: { nextCursor: composite, items: [] } });
    const reply = await run(app, 'MyBookings', { first: 2, after: composite }, { token: customer });
    expect(reply.body.data.myBookings.pageInfo).toEqual({ endCursor: composite, hasNextPage: true }); expect(gateway.calls[0].query?.cursor).toBe(composite);
    gateway.responder = () => ({ status: 400, body: { type: 'https://flight-platform.dev/problems/validation', title: 'Solicitud inválida', status: 400, code: 'VALIDATION_FAILED', correlation_id: 'c1' } });
    const rejected = await run(app, 'MyBookings', { first: 2, after: `${composite.slice(0, -3)}AAA` }, { token: customer }); expect(rejected.body.errors?.[0].extensions).toMatchObject({ category: 'VALIDATION' }); expect(rejected.body.data?.myBookings ?? null).toBeNull();
    const calls = gateway.calls.length; for (const after of ["' OR 1=1 --", 'a b', 'A'.repeat(201), 'x=y']) { const bad = await run(app, 'MyBookings', { after }, { token: customer }); expect(bad.body.errors?.[0].extensions).toMatchObject({ category: 'VALIDATION' }); }
    expect(gateway.calls).toHaveLength(calls);
  });
  it('GQL-MAP-09 postventa: cotización, cancelación (Outcome), asiento, equipaje, cambio de fecha (búsqueda y confirmación), pases y check-in', async () => {
    const { app, gateway } = makeApp();
    gateway.responder = (request) => {
      if (request.path.endsWith('/cancellation-quote')) return { status: 200, body: { quoteId: 'QTE-1', isRefundable: true, refundAmount: '90.00', penaltyAmount: '10.00', currency: 'USD', expiresAt: '2026-12-01T10:15:00Z' } };
      if (request.path.endsWith('/cancel')) return { status: 200, body: { bookingId: UUID_A, pnr: 'ABC123', status: 'CANCELLED', cancelledAt: '2026-12-01T10:00:00Z', refund: { refundId: 'R1', amount: '90.00', currency: 'USD', percentage: 90, status: 'CALCULATED', originalPaymentReference: 'secreto' }, ticketsVoided: ['T1'], inventoryRestoration: { status: 'RESTORED', seatsReleased: 1 } } };
      if (request.path.endsWith('/seats')) return { status: 200, body: { bookingId: UUID_A, seats: [{ passengerId: 'PAX-1', segmentId: 's1', previousSeatNumber: '1A', seatNumber: '2B', status: 'BOOKED' }] } };
      if (request.path.endsWith('/baggage-options')) return { status: 200, body: [{ passengerId: 'PAX-1', itineraryId: 'I1', price: money('30.00'), maxAllowed: 3, alreadyPurchased: 0 }] };
      if (request.path.endsWith('/baggage')) return { status: 200, body: { passengerId: 'PAX-1', itineraryId: 'I1', totalBaggage: 1 } };
      if (request.path.endsWith('/date-change/search')) return { status: 200, body: [{ changeOfferId: 'CHG-1', expiresAt: '2026-12-01T10:15:00Z', segments: [], priceDifference: { fareDifference: '15.00', taxDifference: '1.80', changeFee: '25.00', totalToPay: '41.80' } }] };
      if (request.path.endsWith('/date-change')) return { status: 202, body: { bookingId: UUID_A } };
      if (request.path.endsWith('/boarding-passes')) return { status: 200, body: { bookingId: UUID_A, boardingPasses: [{ passengerId: 'PAX-1', segmentId: 's1', seat: '2B', barcode: 'M1X', barcodeType: 'PDF417', gate: null }] } };
      if (request.path.endsWith('/check-in')) return { status: 200, body: { bookingId: UUID_A, status: 'COMPLETED', checkedInPassengers: [{ passengerId: 'PAX-1', status: 'CHECKED_IN', segments: [{ segmentId: 's1', seat: '2B', status: 'CHECKED_IN' }] }] } };
      return undefined;
    };
    const t = { token: customer };
    expect((await run(app, 'CancellationQuote', { bookingId: UUID_A }, t)).body.data).toMatchObject({ cancellationQuote: { quoteId: 'QTE-1', refundAmount: '90.00', isRefundable: true } });
    const cancel = await run(app, 'CancelBooking', { bookingId: UUID_A, quoteId: 'QTE-1', idempotencyKey: UUID_B }, t); expect(cancel.body.data).toMatchObject({ cancelBooking: { outcome: 'COMPLETED', status: 'CANCELLED', refund: { amount: '90.00', status: 'CALCULATED' }, ticketsVoided: ['T1'], inventoryRestoration: { status: 'RESTORED' } } });
    expect(JSON.stringify(cancel.body)).not.toContain('secreto'); expect(gateway.calls.at(-1)?.body).toMatchObject({ quoteId: 'QTE-1', reasonCode: 'CUSTOMER_REQUEST' });
    expect((await run(app, 'ChangeSeats', { bookingId: UUID_A, seats: [{ passengerId: 'PAX-1', segmentId: 's1', seatNumber: '2B' }], idempotencyKey: UUID_B }, t)).body.data).toMatchObject({ changeSeats: { seats: [{ previousSeatNumber: '1A', seatNumber: '2B', status: 'BOOKED' }] } });
    expect((await run(app, 'BaggageOptions', { bookingId: UUID_A }, t)).body.data).toMatchObject({ baggageOptions: [{ maxAllowed: 3, price: { total: '30.00' } }] });
    expect((await run(app, 'AddBaggage', { input: { bookingId: UUID_A, passengerId: 'PAX-1', itineraryId: 'I1', quantity: 1, paymentReference: 'pay_ok_1' }, idempotencyKey: UUID_B }, t)).body.data).toMatchObject({ addBaggage: { totalBaggage: 1 } });
    expect(gateway.calls.at(-1)?.body).toEqual({ passengerId: 'PAX-1', itineraryId: 'I1', quantity: 1, payment: { paymentReference: 'pay_ok_1' } });
    expect((await run(app, 'SearchDateChange', { bookingId: UUID_A, changes: [{ itineraryId: 'I1', newDepartureDate: '2026-12-05' }] }, t)).body.data).toMatchObject({ searchDateChange: [{ changeOfferId: 'CHG-1', priceDifference: { totalToPay: '41.80' } }] });
    expect((await run(app, 'ConfirmDateChange', { input: { bookingId: UUID_A, changeOfferId: 'CHG-1', paymentReference: 'pay_ok_2' }, idempotencyKey: UUID_B }, t)).body.data).toMatchObject({ confirmDateChange: { outcome: 'PENDING', booking: null } });
    expect((await run(app, 'BoardingPasses', { bookingId: UUID_A }, t)).body.data).toMatchObject({ boardingPasses: [{ seat: '2B', barcodeType: 'PDF417', gate: null }] });
    expect((await run(app, 'CheckIn', { bookingId: UUID_A }, t)).body.data).toMatchObject({ checkIn: { status: 'COMPLETED', checkedInPassengers: [{ status: 'CHECKED_IN' }] } });
  });
  it('GQL-MAP-10 issueTickets consulta la reserva después de emitir; releaseHold responde true con 204; hold y viewer', async () => {
    const { app, gateway } = makeApp();
    gateway.responder = (request) => request.method === 'POST' ? { status: 200, body: { bookingId: UUID_A, issued: 1 } } : request.method === 'DELETE' ? { status: 204 } : request.path.includes('/offers/hold/') ? { status: 200, body: { holdId: UUID_A, status: 'HELD', remainingSeconds: 600, lockedPrice: money('100.00') } } : { status: 200, body: booking };
    const issued = await run(app, 'IssueTickets', { bookingId: UUID_A }, { token: customer }); expect(issued.body.data).toMatchObject({ issueTickets: { issued: 1, booking: { bookingId: UUID_A } } }); expect(gateway.calls.map((call) => call.method)).toEqual(['POST', 'GET']);
    expect((await run(app, 'ReleaseHold', { holdId: UUID_A }, { token: customer })).body.data).toEqual({ releaseHold: true });
    expect((await run(app, 'Hold', { holdId: UUID_A }, { token: customer })).body.data).toMatchObject({ hold: { status: 'HELD', remainingSeconds: 600 } });
    const before = gateway.calls.length; expect((await run(app, 'Viewer', {}, { token: customer })).body.data).toEqual({ viewer: { userId: 'user-1', role: 'CUSTOMER' } }); expect(gateway.calls).toHaveLength(before);
  });
  it('GQL-MAP-11 administración: vuelos, tarifas, operaciones, salud (incluso DOWN con 503), promociones (404 ⇒ null), estado de vuelo y tarifa', async () => {
    const { app, gateway } = makeApp(); const fare = { fareId: UUID_A, flightInstanceId: UUID_B, cabinClass: 'ECONOMY', fareBrand: 'BASIC', price: money('100.00'), fareRules: { isRefundable: true, isChangeable: false }, baggageAllowance: { carryOnIncluded: 1 }, extraCheckedBaggagePrice: money('30.00') };
    let health = 200; let promo = 200;
    gateway.responder = (request) => {
      if (request.path === '/api/admin/v1/flights') return { status: 200, body: { items: [{ flightInstanceId: UUID_B, segment: { flightNumber: 'FP103', departure: { iataCode: 'GYE', at: '2026-12-01T10:00:00-05:00' }, arrival: { iataCode: 'UIO', at: '2026-12-01T11:00:00-05:00' }, aircraft: 'A320' }, cabins: [{ cabinClass: 'ECONOMY', capacity: 150 }], closed: false }], page: { nextCursor: UUID_B } } };
      if (request.path === '/api/admin/v1/fares') return { status: 200, body: request.method === 'PUT' ? { fare } : { fares: [{ fare }] } };
      if (request.path.endsWith('/operaciones/vuelos')) return { status: 200, body: { date: '2026-12-01', totalFlights: 1, nextCursor: null, items: [{ flightNumber: 'FP103', date: '2026-12-01', origin: 'GYE', destination: 'UIO', departureAt: '2026-12-01T10:00:00-05:00', status: 'SCHEDULED', totalSeats: 150, loadFactor: 10, cabins: [{ cabinClass: 'ECONOMY', totalSeats: 150, seatsByStatus: { AVAILABLE: 135, HELD: 5, BOOKED: 0, TICKETED: 10, CHECKED_IN: 0, BOARDED: 0 } }], activeHolds: 1, nextHoldExpiryAt: null, checkInOpen: false, alerts: [] }] } };
      if (request.path.endsWith('/health')) return { status: health, body: { status: health === 200 ? 'HEALTHY' : 'DOWN', nodo_id: 'NODE_X', version: '2.0.0', uptime_seconds: 10, latencia_ms: 5, timestamp: '2026-12-01T10:00:00Z', dependencias: [{ nombre: 'inventory-service', status: health === 200 ? 'UP' : 'DOWN', latencia_ms: 4 }] } };
      if (request.path.endsWith('/promociones/contrato')) return promo === 404 ? { status: 404, body: { code: 'NOT_FOUND' } } : { status: 200, body: { permite_promociones: true, porcentaje_descuento_maximo: 12, destinos_habilitados: ['Quito'], rutas_habilitadas: ['UIO-GYE'], cabinas_habilitadas: ['ECONOMY'], vigencia_hasta: '2026-12-31', condiciones_combo: 'ok', actualizado_en: '2026-11-12T10:00:00Z' } };
      if (request.path.endsWith('/status')) return { status: 200, body: { previousStatus: 'SCHEDULED', affectedBookings: 2, eventId: 'evt-1', flight: { flightNumber: 'FP103', date: '2026-12-01', marketingCarrier: 'FP', operatingCarrier: 'FP', status: 'DELAYED', departure: { iataCode: 'GYE', scheduledAt: '2026-12-01T10:00:00-05:00' }, arrival: { iataCode: 'UIO', scheduledAt: '2026-12-01T11:00:00-05:00' } } } };
      return undefined;
    };
    const a = { token: admin };
    expect((await run(app, 'AdminFlights', { date: '2026-12-01', first: 2 }, a)).body.data).toMatchObject({ adminFlights: { items: [{ flightInstanceId: UUID_B, flightNumber: 'FP103', departureIata: 'GYE', arrivalIata: 'UIO', closed: false, cabins: [{ capacity: 150 }] }], pageInfo: { endCursor: UUID_B, hasNextPage: true } } });
    expect(gateway.calls[0]).toMatchObject({ path: '/api/admin/v1/flights', query: { limit: 2, date: '2026-12-01' } });
    expect((await run(app, 'AdminFares', { flightInstanceId: UUID_B }, a)).body.data).toMatchObject({ adminFares: [{ fareId: UUID_A, price: { total: '100.00' }, fareRules: { isChangeable: false } }] });
    expect((await run(app, 'FlightOperations', { date: '2026-12-01' }, a)).body.data).toMatchObject({ flightOperations: { totalFlights: 1, items: [{ flightNumber: 'FP103', cabins: [{ seatsByStatus: { AVAILABLE: 135, HELD: 5 } }] }], pageInfo: { hasNextPage: false } } });
    expect((await run(app, 'PlatformHealth', {})).body.data).toMatchObject({ platformHealth: { status: 'HEALTHY', nodeId: 'NODE_X', dependencies: [{ name: 'inventory-service', status: 'UP', latencyMs: 4 }] } });
    health = 503; expect((await run(app, 'PlatformHealth', {})).body.data).toMatchObject({ platformHealth: { status: 'DOWN' } });
    expect((await run(app, 'PromotionAgreement', {}, a)).body.data).toMatchObject({ promotionAgreement: { allowsPromotions: true, maxDiscountPercent: 12, destinations: ['Quito'] } });
    promo = 404; expect((await run(app, 'PromotionAgreement', {}, a)).body.data).toEqual({ promotionAgreement: null });
    expect((await run(app, 'UpdateFlightStatus', { flightNumber: 'FP103', input: { date: '2026-12-01', status: 'DELAYED' } }, a)).body.data).toMatchObject({ updateFlightStatus: { previousStatus: 'SCHEDULED', affectedBookings: 2, flight: { status: 'DELAYED' } } });
    const upsert = await run(app, 'UpsertFare', { input: { flightInstanceId: UUID_B, cabinClass: 'ECONOMY', fareBrand: 'BASIC', price: { currency: 'USD', total: '100.00' }, isRefundable: true, isChangeable: false, extraCheckedBaggagePrice: { currency: 'USD', total: '30.00' } } }, a); expect(upsert.body.data).toMatchObject({ upsertFare: { fareId: UUID_A } });
    expect(gateway.calls.at(-1)).toMatchObject({ method: 'PUT', path: '/api/admin/v1/fares', body: { fareRules: { isRefundable: true, isChangeable: false }, price: { currency: 'USD', total: '100.00' } } });
    promo = 200; const set = await run(app, 'SetPromotionAgreement', { input: { allowsPromotions: true, maxDiscountPercent: 12, routes: ['UIO-GYE'] }, idempotencyKey: UUID_B }, a); expect(set.body.data).toMatchObject({ setPromotionAgreement: { maxDiscountPercent: 12 } });
    expect(gateway.calls.at(-1)).toMatchObject({ method: 'PUT', body: { permite_promociones: true, porcentaje_descuento_maximo: 12, rutas_habilitadas: ['UIO-GYE'] } });
    expect((await run(app, 'SetPromotionAgreement', { input: { allowsPromotions: true, maxDiscountPercent: 120 }, idempotencyKey: UUID_B }, a)).body.errors?.[0].extensions.code).toBe('VALIDATION_FAILED');
  });
  it('GQL-MAP-12 un Gateway simulado completo no recibe jamás las cabeceras X-User-Id ni campos de canal desde ninguna operación del cliente', async () => {
    const { app, gateway } = makeApp(); gateway.responder = () => ({ status: 200, body: booking });
    await run(app, 'Booking', { bookingId: UUID_A }, { token: customer, extra: { 'X-User-Id': 'intruso', 'X-Role': 'admin' } });
    expect(gateway.calls.every((call) => !Object.keys(call.headers).some((name) => /^x-user-id$|^x-role$|^x-owner/i.test(name)))).toBe(true);
  });
});
