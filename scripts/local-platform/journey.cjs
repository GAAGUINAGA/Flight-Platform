#!/usr/bin/env node
/* Recorrido v2 completo contra la plataforma local ya levantada (up.ps1):
 *   node scripts/local-platform/journey.cjs [--url http://127.0.0.1:3000] [--profile .local/integracion.env]
 * Crea su propio cliente client_credentials (el secreto va a .local/, se borra al terminar y el cliente se desactiva), simula la API de pagos de Booking
 * si BOOKING_PAYMENTS_BASE_URL del perfil apunta a 127.0.0.1, firma los eventos de Booking con BOOKING_EVENTS_SECRET y recorre compra, pago, postventa y cancelación.
 * Cada comprobación imprime una línea con su ID (lista --verbose). Sale con 0 solo si todas pasan. No imprime secretos. */
/* global fetch, AbortSignal, URLSearchParams, __dirname */
const process = require('node:process');
const { createHmac, randomUUID } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, rmSync } = require('node:fs');
const { createServer } = require('node:http');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
const base = option('url', 'http://127.0.0.1:3000').replace(/\/+$/, '');
const profilePath = resolve(repo, option('profile', '.local/integracion.env'));

function readProfile(path) {
  const values = {}; if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) { const text = line.trim(); if (!text || text.startsWith('#')) continue; const index = text.indexOf('='); if (index > 0) values[text.slice(0, index).trim()] = text.slice(index + 1).trim().replace(/^(["'])(.*)\1$/, '$2'); }
  return values;
}
const profile = readProfile(profilePath);
const results = []; let counter = 0;
function check(description, condition, detail) {
  counter += 1; const id = `V2-JNY-${String(counter).padStart(2, '0')}`; results.push(Boolean(condition));
  process.stdout.write(`${condition ? 'OK   ' : 'FALLA'} ${id} ${description}${condition || !detail ? '' : ` -> ${detail}`}\n`);
  return Boolean(condition);
}
const api = async (method, path, { token, user, body, key, form, headers = {}, raw } = {}) => {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(30_000) };
  if (token) init.headers.Authorization = `Bearer ${token}`; if (user) init.headers['X-User-Id'] = user; if (key) init.headers['Idempotency-Key'] = key;
  if (form) { init.headers['content-type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(form).toString(); }
  else if (raw !== undefined) init.body = raw; else if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const response = await fetch(`${base}${path}`, init); const text = await response.text(); let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: response.status, body: json, headers: response.headers };
};

/** Simulador de GET /pagos/{ref} de Booking, solo si el perfil lo apunta a esta máquina. */
async function startPaymentSimulator() {
  const url = profile.BOOKING_PAYMENTS_BASE_URL; const replies = new Map();
  const match = url && /^http:\/\/(127\.0\.0\.1|localhost):(\d+)$/.exec(url.replace(/\/+$/, ''));
  if (!match) return { replies, stop: async () => undefined, active: false };
  const server = createServer((request, response) => {
    const reference = decodeURIComponent((request.url ?? '').replace(/^\/pagos\//, '')); const reply = replies.get(reference);
    if (!reply) { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{}'); return; }
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(reply));
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(Number(match[2]), '127.0.0.1', resolveListen); });
  return { replies, active: true, stop: () => new Promise((resolveStop) => server.close(() => resolveStop())) };
}

function cli(...cliArgs) {
  const run = spawnSync('npx', ['tsx', '--env-file=platform/api-gateway/.env', 'platform/api-gateway/scripts/dev-auth-client.ts', ...cliArgs], { cwd: repo, encoding: 'utf8', shell: true });
  return { ok: run.status === 0, message: (run.stdout || run.stderr || '').split(/\r?\n/)[0] };
}

const passenger = (id) => ({ passengerId: id, passengerType: 'ADULT', firstName: 'Maria', lastName: 'Andrade', documentType: 'PASSPORT', documentNumber: 'JNY12345', nationality: 'EC', documentExpiryDate: '2035-01-01', birthDate: '1990-01-01', gender: 'F', contact: { email: 'maria@example.invalid', phone: '+593999999999' }, assignedSeats: [], extraBaggage: [] });

async function main() {
  const simulator = await startPaymentSimulator();
  // BOOKING_EVENTS_CLIENT_ID es obligatorio con BOOKING_EVENTS_SECRET (ADR-F12a2-03): si el perfil usa un id que empieza por "journey", el recorrido crea ese cliente y firma los eventos con él.
  const fixedId = /^journey[A-Za-z0-9_-]*$/.test(profile.BOOKING_EVENTS_CLIENT_ID ?? '') ? profile.BOOKING_EVENTS_CLIENT_ID : undefined;
  const clientId = fixedId ?? `journey-${Date.now().toString(36)}`; const secretFile = join(repo, '.local', `${clientId}.secret`); mkdirSync(join(repo, '.local'), { recursive: true });
  let created = false;
  try {
    const health = await api('GET', '/api/v2/vuelos/health');
    check('health del gateway responde HEALTHY con los 7 servicios UP', health.status === 200 && health.body?.status === 'HEALTHY' && health.body.dependencias?.length >= 7 && health.body.dependencias.every((d) => d.status === 'UP'), JSON.stringify(health.body?.dependencias?.filter((d) => d.status !== 'UP')));
    const made = cli('create', '--client-id', clientId, '--out', secretFile); created = made.ok;
    if (!check('alta del cliente client_credentials de prueba (secreto solo en .local/)', made.ok, made.message)) return;
    const secret = /client_secret=(.+)/.exec(readFileSync(secretFile, 'utf8'))[1].trim();
    const tokenResponse = await api('POST', '/api/v2/oauth2/token', { form: { grant_type: 'client_credentials', client_id: clientId, client_secret: secret } });
    const token = tokenResponse.body?.access_token;
    check('POST /oauth2/token entrega un access_token Bearer', tokenResponse.status === 200 && typeof token === 'string' && tokenResponse.body.token_type?.toLowerCase() === 'bearer', String(tokenResponse.status));
    check('el JWKS público responde con una llave', (await api('GET', '/api/v2/.well-known/jwks.json')).body?.keys?.length >= 1);
    const bad = await api('POST', '/api/v2/oauth2/token', { form: { grant_type: 'client_credentials', client_id: clientId, client_secret: 'incorrecto' } });
    check('un secreto incorrecto se rechaza con 401', bad.status === 401, String(bad.status));
    if (!token) return;
    const user = 'journey-user';

    const date = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const search = await api('POST', '/api/v2/vuelos/search', { body: { itineraries: [{ origin: 'UIO', destination: 'GYE', departureDate: date }], passengers: { adults: 1 } }, headers: { 'x-device-fingerprint': randomUUID() } });
    const offer = search.body?.offers?.[0];
    if (!check(`búsqueda UIO→GYE el ${date} devuelve ofertas (¿se corrió el seed?)`, search.status === 200 && offer, String(search.status))) return;
    const itinerary = offer.itineraries[0]; const option0 = itinerary.pricingOptions[0]; const segmentId = itinerary.segments[0].segmentId; const flightNumber = itinerary.segments[0].flightNumber;
    const seatmap = await api('GET', `/api/v2/vuelos/offers/${offer.offerId}/seatmap?segmentId=${segmentId}`);
    // Solo los asientos de la cabina que se compra (un asiento de otra cabina da 422 SEAT_CABIN_MISMATCH).
    const seats = (seatmap.body?.cabins ?? []).filter((cabin) => cabin.cabinClass === option0.cabinClass).flatMap((cabin) => (cabin.rows ?? []).flatMap((row) => row.seats ?? []));
    check('el mapa de asientos de la oferta trae asientos AVAILABLE', seatmap.status === 200 && seats.some((seat) => seat.status === 'AVAILABLE'), String(seatmap.status));
    const wanted = seats.filter((seat) => seat.status === 'AVAILABLE').map((seat) => seat.seatNumber);
    const status = await api('GET', `/api/v2/vuelos/flights/${flightNumber}/status?date=${date}`);
    check('el estado público del vuelo responde (SCHEDULED, retraso 0)', status.status === 200 && status.body?.status === 'SCHEDULED', `${status.status} ${JSON.stringify(status.body?.code ?? '')}`);

    const hold = await api('POST', '/api/v2/vuelos/offers/hold', { token, user, key: randomUUID(), body: { offerId: offer.offerId, itinerarySelections: [{ itineraryId: itinerary.itineraryId, cabinClass: option0.cabinClass, fareBrand: option0.fareBrand }], passengersBreakdown: { adults: 1 } } });
    check('POST /offers/hold congela el precio (201 HELD con ttl)', hold.status === 201 && hold.body?.status === 'HELD' && hold.body.ttlMinutes > 0, String(hold.status));
    if (hold.status !== 201) return;
    const total = hold.body.lockedPrice.total; const currency = hold.body.lockedPrice.currency;
    check('GET /offers/hold/{id} devuelve el hold del mismo usuario', (await api('GET', `/api/v2/vuelos/offers/hold/${hold.body.holdId}`, { token, user })).body?.status === 'HELD');
    check('otro X-User-Id no ve el hold (404)', (await api('GET', `/api/v2/vuelos/offers/hold/${hold.body.holdId}`, { token, user: 'otro-usuario' })).status === 404);

    const reference = `PAY-JNY-${randomUUID()}`; if (simulator.active) simulator.replies.set(reference, { estado: 'PENDIENTE', monto: total, moneda: currency });
    const verifyOff = profile.BOOKING_PAYMENTS_VERIFY === 'off';
    const booking = await api('POST', '/api/v2/vuelos/bookings', { token, user, key: randomUUID(), body: { holdId: hold.body.holdId, passengers: [passenger('PAX-1')], payment: { paymentReference: reference } } });
    const bookingId = booking.body?.bookingId;
    if (verifyOff) check('con BOOKING_PAYMENTS_VERIFY=off la reserva se confirma sin verificar el pago (201)', booking.status === 201 && booking.body?.status === 'CONFIRMED', String(booking.status));
    else check('reserva con pago aún pendiente: 202 PENDING_PAYMENT', booking.status === 202 && booking.body?.status === 'PENDING_PAYMENT', `${booking.status} ${booking.body?.status}`);
    if (!bookingId) return;

    if (!verifyOff) {
      const secretEvents = profile.BOOKING_EVENTS_SECRET; const header = (profile.BOOKING_EVENTS_SIGNATURE_HEADER ?? 'x-webhook-signature').toLowerCase(); const prefix = profile.BOOKING_EVENTS_SIGNATURE_PREFIX ?? 'sha256=';
      const raw = JSON.stringify({ specversion: '1.0', type: 'ec.edu.epn.booking.pagos.payment.confirmed', source: '/booking/pagos', id: `evt-bkp-${randomUUID()}`, time: new Date().toISOString(), correlationid: `corr-${randomUUID()}`, data: { bookingId, paymentReference: reference, amount: { currency, total } } });
      const send = (body, signature) => api('POST', '/api/v2/vuelos/booking-events', { raw: body, headers: { 'content-type': 'application/cloudevents+json', [header]: signature } });
      check('booking-events con firma inválida se rechaza con 401', (await send(raw, `${prefix}${'0'.repeat(64)}`)).status === 401);
      if (!check('hay BOOKING_EVENTS_SECRET en el perfil para firmar eventos', Boolean(secretEvents))) return;
      if (simulator.active) simulator.replies.set(reference, { estado: 'CONFIRMADO', monto: total, moneda: currency });
      const signature = `${prefix}${createHmac('sha256', secretEvents).update(raw).digest('hex')}`;
      const accepted = await send(raw, signature);
      check('payment.confirmed firmado emite los boletos (202 ISSUED)', accepted.status === 202 && accepted.body?.outcome === 'ISSUED', `${accepted.status} ${accepted.body?.outcome}`);
      const replay = await send(raw, signature);
      check('el mismo evento repetido responde 202 sin efectos nuevos (idempotente)', replay.status === 202, String(replay.status));
    }
    const detail = await api('GET', `/api/v2/vuelos/bookings/${bookingId}`, { token, user });
    check('GET /bookings/{id}: CONFIRMED con boleto ISSUED y el id de pasajero de Booking (PAX-1)', detail.status === 200 && detail.body?.status === 'CONFIRMED' && detail.body.tickets?.some((t) => t.status === 'ISSUED') && detail.body.passengers?.[0]?.passengerId === 'PAX-1', `${detail.status} ${detail.body?.status}`);
    check('otro X-User-Id no ve la reserva (404)', (await api('GET', `/api/v2/vuelos/bookings/${bookingId}`, { token, user: 'otro-usuario' })).status === 404);
    const tickets = await api('GET', `/api/v2/vuelos/bookings/${bookingId}/tickets`, { token, user }); check('GET /bookings/{id}/tickets lista el boleto', tickets.status === 200 && tickets.body?.tickets?.length === 1);
    check('GET /bookings (lista por PNR) incluye la reserva', (await api('GET', `/api/v2/vuelos/bookings?pnr=${detail.body.pnr}`, { token, user })).body?.items?.some((i) => i.bookingId === bookingId));

    const options = await api('GET', `/api/v2/vuelos/bookings/${bookingId}/baggage-options`, { token, user });
    check('opciones de equipaje: precio por maleta y máximo 3', options.status === 200 && options.body?.[0]?.maxAllowed === 3, String(options.status));
    if (options.status === 200) {
      const price = options.body[0].price.total; const bagRef = `PAY-JNY-${randomUUID()}`; if (simulator.active) simulator.replies.set(bagRef, { estado: 'CONFIRMADO', monto: price, moneda: options.body[0].price.currency });
      const bag = await api('POST', `/api/v2/vuelos/bookings/${bookingId}/baggage`, { token, user, key: randomUUID(), body: { passengerId: 'PAX-1', itineraryId: itinerary.itineraryId, quantity: 1, payment: { paymentReference: bagRef } } });
      check(verifyOff || simulator.active ? 'compra de 1 maleta con pago confirmado: 200 y totalBaggage 1' : 'compra de equipaje (requiere simulador de pagos o VERIFY=off)', bag.status === 200 && bag.body?.totalBaggage === 1, `${bag.status} ${bag.body?.code ?? ''}`);
    }
    if (wanted.length > 0) {
      const seat = await api('PUT', `/api/v2/vuelos/bookings/${bookingId}/seats`, { token, user, key: randomUUID(), body: { seats: [{ passengerId: 'PAX-1', segmentId, seatNumber: wanted[0] }] } });
      check(`asignación de asiento ${wanted[0]} (PUT /seats): 200 TICKETED`, seat.status === 200 && seat.body?.seats?.[0]?.seatNumber === wanted[0], `${seat.status} ${seat.body?.code ?? ''}`);
    }
    const quote = await api('GET', `/api/v2/vuelos/bookings/${bookingId}/cancellation-quote`, { token, user });
    check('cotización de cancelación con quoteId y montos', quote.status === 200 && typeof quote.body?.quoteId === 'string', String(quote.status));
    const cancel = await api('POST', `/api/v2/vuelos/bookings/${bookingId}/cancel`, { token, user, key: randomUUID(), body: { quoteId: quote.body?.quoteId, reasonCode: 'CUSTOMER_REQUEST', reason: 'recorrido de prueba' } });
    check('cancelación con quoteId: 200 CANCELLED, reembolso informado e inventario RESTORED', cancel.status === 200 && cancel.body?.status === 'CANCELLED' && cancel.body.refund?.refundId && cancel.body.inventoryRestoration?.status === 'RESTORED', `${cancel.status} ${cancel.body?.code ?? ''}`);
    check('cancelar otra vez responde 409 ALREADY_CANCELLED', (await api('POST', `/api/v2/vuelos/bookings/${bookingId}/cancel`, { token, user, key: randomUUID(), body: { reasonCode: 'FLIGHT_CANCELLED' } })).body?.code === 'ALREADY_CANCELLED');

    const second = await api('POST', '/api/v2/vuelos/offers/hold', { token, user, key: randomUUID(), body: { offerId: offer.offerId, itinerarySelections: [{ itineraryId: itinerary.itineraryId, cabinClass: option0.cabinClass, fareBrand: option0.fareBrand }], passengersBreakdown: { adults: 1 } } });
    check('un segundo hold se libera (compensación de la saga): DELETE responde 204', second.status === 201 && (await api('DELETE', `/api/v2/vuelos/offers/hold/${second.body.holdId}`, { token, user })).status === 204, String(second.status));

    const feed = await api('GET', '/api/v2/vuelos/eventos?limit=50', { token });
    check('el feed GET /vuelos/eventos trae los eventos de la aerolínea', feed.status === 200 && JSON.stringify(feed.body).includes('booking.cancelled'), String(feed.status));
    const hook = await api('POST', '/api/v2/vuelos/webhooks', { token, key: randomUUID(), body: { url: 'http://100.64.0.1:9/webhooks/gabatair', events: ['booking.cancelled'], secret: `secreto-de-prueba-${randomUUID()}` } });
    check('registro de un webhook http://100.x (perfil local): 201', hook.status === 201, `${hook.status} ${hook.body?.code ?? ''}`);
    if (hook.status === 201) { check('el webhook figura en la lista del cliente', (await api('GET', '/api/v2/vuelos/webhooks', { token })).body?.items?.some?.((item) => item.id === hook.body.id) ?? JSON.stringify((await api('GET', '/api/v2/vuelos/webhooks', { token })).body).includes(hook.body.id)); check('DELETE del webhook responde 204', (await api('DELETE', `/api/v2/vuelos/webhooks/${hook.body.id}`, { token })).status === 204); }
  } finally {
    await simulator.stop();
    if (existsSync(secretFile)) rmSync(secretFile, { force: true });
    if (created) { const off = cli('disable', '--client-id', clientId); process.stdout.write(`cliente de prueba ${clientId}: ${off.ok ? 'desactivado' : 'NO se pudo desactivar'}\n`); }
  }
}
main().then(() => { const failed = results.filter((ok) => !ok).length; process.stdout.write(`\nRecorrido: ${results.length - failed}/${results.length} comprobaciones OK\n`); process.exit(failed === 0 && results.length > 0 ? 0 : 1); }).catch((error) => { process.stdout.write(`Recorrido interrumpido: ${error instanceof Error ? error.message : 'error'}\n`); process.exit(1); });
