#!/usr/bin/env node
/* Pruebas con usuarios reales S-1 a S-6 (docs/dev/f12c0-diseno-front.md §5.4) contra la plataforma desplegada o la local.
 * Solo v2 (/api/v2/vuelos) y la API interna (/api/admin/v1). Lo ejecuta el HUMANO; ver docs/dev/f12c-pruebas-reales.md.
 *
 *   Nube:   BASE_URL=https://... CUSTOMER_A_TOKEN=... CUSTOMER_B_TOKEN=... ADMIN_TOKEN=... [PARTNER_CLIENT_ID=... PARTNER_CLIENT_SECRET=...] node platform/api-gateway/scripts/f12c-pruebas-reales.cjs
 *   Ensayo: node platform/api-gateway/scripts/f12c-pruebas-reales.cjs --local   (plataforma de local:up; fabrica sus tokens con el CLI dev:token y su socio de prueba)
 *
 * Opcionales: ADMIN_PATCH_FLIGHT=<vuelo>:<AAAA-MM-DD> (PATCH real y REVERSIBLE sobre un vuelo de PRUEBA: mueve la hora estimada +30 min y la devuelve; sin él el PATCH solo se comprueba en modo lectura),
 *             SKIP_PENDING=1 (omite pay_pending_*: esa reserva queda PENDING_PAYMENT y no se puede cancelar),
 *             CAP_PROBE_MAX (reservas máximas para buscar el tope, 8), RATE_LIMIT_MAX (peticiones máximas por prueba de límite, 130), SKIP_CAPS=1, SKIP_RATE_LIMIT=1.
 * Imprime una línea OK / FALLA / N/A por comprobación y un resumen. Nunca imprime tokens, secretos, correos, documentos ni referencias de pago.
 * Todo lo que crea se cancela o libera al final (bloque finally), también si una comprobación falla a la mitad. Sale con 0 solo si no hay FALLA. */
/* global fetch, AbortSignal, URLSearchParams, __dirname */
const process = require('node:process');
const { Buffer } = require('node:buffer');
const { setTimeout } = require('node:timers');
const { randomUUID } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
const local = args.includes('--local');
const env = (name) => (process.env[name] ?? '').trim();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const intEnv = (name, fallback) => { const value = Number(env(name)); return Number.isInteger(value) && value > 0 ? value : fallback; };

const USER_SCOPES = 'flights:read flights:hold flights:book flights:cancel';
const ADMIN_SCOPES = `${USER_SCOPES} flights:webhooks flights:admin`;
const base = (env('BASE_URL') || (local ? 'http://127.0.0.1:3000' : '')).replace(/\/+$/, '');
const V2 = '/api/v2/vuelos';
const ADMIN_API = '/api/admin/v1';

// ───────── Resultados ─────────
const results = []; let counter = 0;
/** `tag` = S-1..S-6 (o "-" si es previa). `state`: OK | FALLA | N/A. */
function report(tag, state, description, detail) {
  counter += 1; results.push({ tag, state });
  const pad = state === 'OK' ? 'OK   ' : state === 'FALLA' ? 'FALLA' : 'N/A  ';
  process.stdout.write(`${pad} ${tag.padEnd(3)} #${String(counter).padStart(2, '0')} ${description}${detail ? ` -> ${detail}` : ''}\n`);
  return state === 'OK';
}
const check = (tag, description, condition, detail) => report(tag, condition ? 'OK' : 'FALLA', description, condition ? undefined : detail);
const notApplicable = (tag, description, why) => report(tag, 'N/A', description, why);
const brief = (response) => `${response.status}${response.body && typeof response.body === 'object' && typeof response.body.code === 'string' ? ` ${response.body.code}` : ''}`;
const problemKind = (response) => String(response.body?.type ?? '').split('/').pop();

// ───────── HTTP ─────────
async function api(method, path, { token, headers = {}, body, key, form, user } = {}) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(90_000) };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (key) init.headers['Idempotency-Key'] = key;
  if (user) init.headers['X-User-Id'] = user;
  if (form) { init.headers['content-type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  try {
    const response = await fetch(`${base}${path}`, init); const text = await response.text(); let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: response.status, body: json, headers: response.headers };
  } catch (error) { return { status: 0, body: undefined, headers: new Map(), error: error instanceof Error ? error.name : 'error' }; }
}
const v2 = (method, path, options) => api(method, `${V2}${path}`, options);

// ───────── Utilidades de datos (solo lo que se necesita; nunca se imprimen) ─────────
const claimsOf = (token) => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { return {}; } };
const passenger = (id) => ({ passengerId: id, passengerType: 'ADULT', firstName: 'Prueba', lastName: 'Web', documentType: 'PASSPORT', documentNumber: 'F12C0001', nationality: 'EC', documentExpiryDate: '2035-01-01', birthDate: '1990-01-01', gender: 'F', contact: { email: 'prueba@example.invalid', phone: '+593999999999' }, assignedSeats: [], extraBaggage: [] });
const dayString = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const seatsOf = (map, cabinClass) => (map?.cabins ?? []).filter((cabin) => cabin.cabinClass === cabinClass).flatMap((cabin) => (cabin.rows ?? []).flatMap((row) => row.seats ?? []));
const isTerminalCancelled = (value) => value === 'CANCELLED';

// ───────── Registro de lo que se crea (para la limpieza) ─────────
const created = { holds: [], bookings: [] };
const forgetBooking = (id) => { const found = created.bookings.find((item) => item.id === id); if (found) found.done = true; };

async function makeHold(token, flight, { seat, breakdown = { adults: 1 } } = {}) {
  const body = { offerId: flight.offerId, itinerarySelections: [{ itineraryId: flight.itineraryId, cabinClass: flight.cabinClass, fareBrand: flight.fareBrand }], passengersBreakdown: breakdown, ...(seat ? { assignedSeats: [{ segmentId: flight.segmentId, seatNumber: seat }] } : {}) };
  const response = await v2('POST', '/offers/hold', { token, key: randomUUID(), body });
  if (response.status === 201 && response.body?.holdId) created.holds.push({ id: response.body.holdId, token });
  return response;
}
async function reserve(token, hold, reference, extra = {}) {
  const response = await v2('POST', '/bookings', { token, key: randomUUID(), body: { holdId: hold.body.holdId, passengers: [passenger('PAX-1')], payment: { paymentReference: reference, amount: hold.body.lockedPrice }, ...extra } });
  if (response.body?.bookingId && response.status < 300) created.bookings.push({ id: response.body.bookingId, token, done: false });
  return response;
}

// ───────── Selección automática de vuelos ─────────
/** Candidatos desde el panel de operaciones del admin: futuros, SCHEDULED y con asientos libres.
 *  - `normal`: sale dentro de más de 48 h (nunca se usa un vuelo de menos de 48 h con reservas de otros: no hay forma de distinguir las de Booking, así que esos vuelos solo se usan sin ocupación alguna).
 *  - `window`: sale dentro de la ventana de check-in (menos de 48 h) y está completamente vacío (ni asientos retenidos, ni reservados, ni holds). */
async function candidates(adminToken) {
  const normal = []; const window = []; let failures = 0; const diag = { statuses: {}, items: 0, notScheduled: 0, tooFewSeats: 0 };
  for (let offset = 0; offset <= 12 && (normal.length < 4 || window.length < 1); offset += 1) {
    const date = dayString(offset); const response = await v2('GET', `/operaciones/vuelos?date=${date}&limit=50`, { token: adminToken });
    diag.statuses[response.status] = (diag.statuses[response.status] ?? 0) + 1;
    if (response.status !== 200) { failures += 1; if (failures >= 3) break; continue; }
    const items = [...(response.body?.items ?? [])];
    for (let page = 0, cursor = response.body?.nextCursor; cursor && page < 3; page += 1) { const next = await v2('GET', `/operaciones/vuelos?date=${date}&limit=50&cursor=${encodeURIComponent(cursor)}`, { token: adminToken }); if (next.status !== 200) break; items.push(...(next.body?.items ?? [])); cursor = next.body?.nextCursor; }
    for (const item of items) {
      diag.items += 1; const hours = (Date.parse(item.departureAt) - Date.now()) / 3_600_000;
      if (item.status !== 'SCHEDULED' || !Number.isFinite(hours)) { diag.notScheduled += 1; continue; }
      const free = Math.max(0, ...(item.cabins ?? []).map((cabin) => cabin.seatsByStatus?.AVAILABLE ?? 0));
      const empty = (item.loadFactor ?? 100) === 0 && (item.activeHolds ?? 1) === 0 && (item.cabins ?? []).every((cabin) => ['HELD', 'BOOKED', 'TICKETED', 'CHECKED_IN', 'BOARDED'].every((key) => (cabin.seatsByStatus?.[key] ?? 0) === 0));
      const entry = { flightNumber: item.flightNumber, date: item.date ?? date, origin: item.origin, destination: item.destination, hours };
      if (hours >= 50 && free >= 6) normal.push(entry);
      else if (hours >= 1.5 && hours < 47 && empty && free >= 2) window.push(entry);
      else diag.tooFewSeats += 1;
    }
  }
  return { normal, window, diag };
}

/** Busca la oferta del vuelo candidato (búsqueda pública con huella) y su mapa de asientos. Devuelve el vuelo listo para retener o undefined. */
async function resolveFlight(candidate, fingerprint, minSeats) {
  const search = await v2('POST', '/search', { headers: { 'X-Device-Fingerprint': fingerprint }, body: { itineraries: [{ origin: candidate.origin, destination: candidate.destination, departureDate: candidate.date }], passengers: { adults: 1 } } });
  if (search.status !== 200) return undefined;
  for (const offer of search.body?.offers ?? []) {
    const itinerary = offer.itineraries?.[0]; const segment = itinerary?.segments?.[0];
    if (!itinerary || segment?.flightNumber !== candidate.flightNumber) continue;
    const map = await v2('GET', `/offers/${offer.offerId}/seatmap?segmentId=${segment.segmentId}`);
    if (map.status !== 200) continue;
    for (const option of itinerary.pricingOptions ?? []) {
      const free = seatsOf(map.body, option.cabinClass).filter((seat) => seat.status === 'AVAILABLE').map((seat) => seat.seatNumber);
      if (free.length >= minSeats) return { ...candidate, offerId: offer.offerId, itineraryId: itinerary.itineraryId, segmentId: segment.segmentId, cabinClass: option.cabinClass, fareBrand: option.fareBrand, free, searchCount: search.body.offers.length };
    }
  }
  return undefined;
}
async function pickFlight(list, fingerprint, minSeats) { for (const candidate of list.slice(0, 6)) { const flight = await resolveFlight(candidate, fingerprint, minSeats); if (flight) return flight; } return undefined; }

// ───────── Cancelación (flujo y limpieza) ─────────
async function cancelBooking(token, bookingId, user) {
  const quote = await v2('GET', `/bookings/${bookingId}/cancellation-quote`, { token, user });
  const cancel = await v2('POST', `/bookings/${bookingId}/cancel`, { token, user, key: randomUUID(), body: { ...(quote.body?.quoteId ? { quoteId: quote.body.quoteId } : {}), reasonCode: 'CUSTOMER_REQUEST', reason: 'prueba automatizada F12c' } });
  return { quote, cancel };
}
async function withRetryAfter(action) {
  let result = await action();
  if (result.status === 429) { const wait = Math.min(70, Number(result.headers.get?.('retry-after')) || 60); process.stdout.write(`     (límite de peticiones: se espera ${wait} s para terminar la limpieza)\n`); await sleep(wait * 1000); result = await action(); }
  return result;
}
async function cleanup() {
  let cancelled = 0; let released = 0; const residual = []; const expected = [];
  for (const booking of [...created.bookings].reverse()) {
    if (booking.done) continue;
    try {
      const cancel = await withRetryAfter(async () => (await cancelBooking(booking.token, booking.id, booking.user)).cancel);
      if (cancel.status === 200 || (cancel.status === 409 && cancel.body?.code === 'ALREADY_CANCELLED')) { cancelled += 1; booking.done = true; }
      else if ((booking.checkedIn || booking.pending) && cancel.status === 409) expected.push(`${booking.id} (${booking.pending ? 'pago pendiente' : 'con check-in'})`);
      else residual.push(`reserva ${booking.id} (${brief(cancel)})`);
    } catch { residual.push(`reserva ${booking.id}`); }
  }
  for (const hold of created.holds) {
    try {
      const response = await withRetryAfter(() => v2('DELETE', `/offers/hold/${hold.id}`, { token: hold.token, user: hold.user }));
      if ([204, 404].includes(response.status)) released += 1; else if (!(response.status === 409 && response.body?.code === 'HOLD_ALREADY_CONSUMED')) residual.push(`hold ${hold.id} (${brief(response)})`);
    } catch { residual.push(`hold ${hold.id}`); }
  }
  if (expected.length) process.stdout.write(`\nAviso: no se pueden cancelar por regla de negocio (409 BOOKING_NOT_CANCELLABLE: solo se cancela una reserva CONFIRMED sin pago pendiente): ${expected.join(', ')}. Son de prueba (canal WEB, WEB_TEST); la de pago pendiente no se puede cancelar desde la API (la resuelve el reintento de pagos de Reservation) y se ve en GET /api/admin/v1/web-bookings. Use SKIP_PENDING=1 para no crearla.\n`);
  process.stdout.write(`\nLimpieza: ${cancelled} reservas canceladas, ${released} holds liberados${residual.length ? `; NO se pudo limpiar: ${residual.join(', ')} (cancelar a mano o esperar el vencimiento del hold)` : ''}\n`);
  return residual.length === 0;
}

// ───────── Ensayo local: tokens y socio de prueba propios ─────────
function cli(...cliArgs) { const run = spawnSync('npx', ['tsx', '--env-file=platform/api-gateway/.env', 'platform/api-gateway/scripts/dev-auth-client.ts', ...cliArgs], { cwd: repo, encoding: 'utf8', shell: true }); return { ok: run.status === 0, message: (run.stdout || run.stderr || '').split(/\r?\n/)[0] }; }
function devToken(sub, role, scope) { const run = spawnSync('npx', ['tsx', 'infra/scripts/dev-token.ts', '--sub', sub, '--app-role', role, '--scope', `"${scope}"`], { cwd: repo, encoding: 'utf8', shell: true }); return run.status === 0 ? run.stdout.trim().split(/\r?\n/).pop() : ''; }

// ───────── Programa ─────────
async function run(ctx) {
  const { tokenA, tokenB, tokenAdmin } = ctx; let { partner } = ctx;
  const subA = claimsOf(tokenA).sub; const subB = claimsOf(tokenB).sub;
  check('-', 'las credenciales de A, B y administrador son distintas y A y B son usuarios diferentes', Boolean(subA && subB && subA !== subB && tokenAdmin !== tokenA), 'A y B deben ser dos usuarios de Supabase distintos');
  check('-', 'roles de los tokens: A y B customer, administrador admin', claimsOf(tokenA).app_role === 'customer' && claimsOf(tokenB).app_role === 'customer' && claimsOf(tokenAdmin).app_role === 'admin', 'revisar el claim app_role (hook de Supabase)');

  // Calentamiento (Cloud Run / Render pueden tardar en despertar).
  let health = await v2('GET', '/health'); for (const deadline = Date.now() + 120_000; health.status !== 200 && Date.now() < deadline;) { await sleep(5000); health = await v2('GET', '/health'); }
  if (!check('-', 'GET /vuelos/health responde 200 (sin token)', health.status === 200, brief(health))) return;

  // ── Vuelos ──
  const fingerprint = randomUUID();
  const { normal, window, diag } = await candidates(tokenAdmin);
  const flight = await pickFlight(normal, fingerprint, 6);
  if (!check('S-1', 'se encontró automáticamente un vuelo futuro (>48 h) con asientos libres', Boolean(flight), `sin candidatos en el panel (respuestas ${JSON.stringify(diag.statuses)}, vuelos vistos ${diag.items}, no SCHEDULED ${diag.notScheduled}, fuera de criterio ${diag.tooFewSeats}); ¿corrió el seed? o la búsqueda no devolvió la oferta`)) return;
  process.stdout.write(`     vuelo elegido: ${flight.flightNumber} el ${flight.date} (${flight.origin}→${flight.destination}, cabina ${flight.cabinClass}, sale en ~${Math.round(flight.hours)} h)\n`);
  const windowFlight = window.length ? await pickFlight(window, fingerprint, 2) : undefined;
  const correlationId = `f12c-${randomUUID()}`;

  // ── S-1: recorrido del cliente A ──
  const noFingerprint = await v2('POST', '/search', { body: { itineraries: [{ origin: flight.origin, destination: flight.destination, departureDate: flight.date }], passengers: { adults: 1 } } });
  check('S-1', 'búsqueda sin X-Device-Fingerprint se rechaza (400)', noFingerprint.status === 400, brief(noFingerprint));
  const search = await v2('POST', '/search', { headers: { 'X-Device-Fingerprint': fingerprint, 'X-Correlation-Id': correlationId }, body: { itineraries: [{ origin: flight.origin, destination: flight.destination, departureDate: flight.date }], passengers: { adults: 1 } } });
  check('S-1', 'búsqueda con X-Device-Fingerprint: 200 con ofertas y X-Correlation-Id devuelto igual', search.status === 200 && search.body?.offers?.length > 0 && search.headers.get('x-correlation-id') === correlationId, brief(search));
  const status = await v2('GET', `/flights/${flight.flightNumber}/status?date=${flight.date}`);
  check('S-1', 'estado público del vuelo (sin token): 200', status.status === 200 && typeof status.body?.status === 'string', brief(status));
  const map = await v2('GET', `/offers/${flight.offerId}/seatmap?segmentId=${flight.segmentId}`);
  const [seat1, seat2] = flight.free;
  check('S-1', 'mapa de asientos: 200 con asientos AVAILABLE y estado por asiento', map.status === 200 && seatsOf(map.body, flight.cabinClass).every((seat) => typeof seat.status === 'string') && flight.free.length >= 2, brief(map));

  const hold = await makeHold(tokenA, flight, { seat: seat1 });
  if (!check('S-1', 'POST /offers/hold con assignedSeats: 201 HELD con precio congelado y ttl', hold.status === 201 && hold.body?.status === 'HELD' && hold.body.ttlMinutes > 0 && Boolean(hold.body.lockedPrice?.total), brief(hold))) return;
  const holdState = await v2('GET', `/offers/hold/${hold.body.holdId}`, { token: tokenA });
  check('S-1', 'GET /offers/hold/{id} del dueño: 200 HELD con tiempo restante', holdState.status === 200 && holdState.body?.status === 'HELD' && holdState.body.remainingSeconds > 0, brief(holdState));
  const mapHeld = await v2('GET', `/offers/${flight.offerId}/seatmap?segmentId=${flight.segmentId}`);
  check('S-1', 'el mapa muestra el asiento del hold como HELD', seatsOf(mapHeld.body, flight.cabinClass).find((seat) => seat.seatNumber === seat1)?.status === 'HELD', `estado ${seatsOf(mapHeld.body, flight.cabinClass).find((seat) => seat.seatNumber === seat1)?.status}`);

  // Aislamiento del hold (B y socio): nunca 200 ni 2xx; esperado 404 o 403.
  const foreign = [['B', tokenB, undefined]]; if (partner) foreign.push(['socio', partner.token, subA]);
  const denied = (response) => response.status === 404 || response.status === 403;
  for (const [who, token, user] of foreign) {
    const get = await v2('GET', `/offers/hold/${hold.body.holdId}`, { token, user }); check('S-1', `aislamiento: ${who} no ve el hold de A (404/403)`, denied(get), brief(get));
    const release = await v2('DELETE', `/offers/hold/${hold.body.holdId}`, { token, user }); check('S-1', `aislamiento: ${who} no libera el hold de A (404/403)`, denied(release), brief(release));
    const consume = await v2('POST', '/bookings', { token, user, key: randomUUID(), body: { holdId: hold.body.holdId, passengers: [passenger('PAX-1')], payment: { paymentReference: `pay_ok_${randomUUID()}`, amount: hold.body.lockedPrice } } });
    if (consume.body?.bookingId) created.bookings.push({ id: consume.body.bookingId, token, done: false });
    check('S-1', `aislamiento: ${who} no consume el hold de A (404/403)`, denied(consume), brief(consume));
  }
  const holdAfter = await v2('GET', `/offers/hold/${hold.body.holdId}`, { token: tokenA });
  check('S-1', 'tras los intentos ajenos, el hold de A sigue HELD', holdAfter.status === 200 && holdAfter.body?.status === 'HELD', brief(holdAfter));

  // El cliente no puede forzar canal ni marca por el cuerpo.
  const forced = await reserve(tokenA, hold, `pay_ok_${randomUUID()}`, { paymentChannel: 'BOOKING', salesChannel: { partnerId: 'BOOKING', passengers: 99 } });
  let booking;
  if (forced.status === 201) { booking = forced; check('S-1', 'el cuerpo no cambia el canal: la reserva queda marcada WEB_TEST (c)', forced.body?.salesChannel?.partnerId === 'WEB_TEST', `salesChannel ${forced.body?.salesChannel?.partnerId}`); }
  else {
    check('S-1', 'el cuerpo con canal/marca propios se rechaza sin vender (c)', forced.status === 400 || forced.status === 422, brief(forced));
    booking = await reserve(tokenA, hold, `pay_ok_${randomUUID()}`);
  }
  if (!check('S-5', 'POST /bookings con pay_ok_*: 201 CONFIRMED con boletos emitidos', booking.status === 201 && booking.body?.status === 'CONFIRMED', `${brief(booking)} ${problemKind(booking)}`)) return;
  const id = booking.body.bookingId;
  check('S-5', 'la reserva del canal WEB queda marcada como de prueba (salesChannel WEB_TEST)', booking.body.salesChannel?.partnerId === 'WEB_TEST', `salesChannel ${booking.body.salesChannel?.partnerId}`);
  check('S-1', 'la reserva trae el asiento asignado en el hold (assignedSeats)', JSON.stringify(booking.body.passengers ?? []).includes(seat1), 'no aparece el asiento del hold en passengers[].assignedSeats');
  const tickets = await v2('GET', `/bookings/${id}/tickets`, { token: tokenA });
  const firstTicket = tickets.body?.tickets?.[0];
  check('S-1', 'GET /bookings/{id}/tickets: boletos ISSUED', tickets.status === 200 && tickets.body?.tickets?.length >= 1 && tickets.body.tickets.every((ticket) => ticket.status === 'ISSUED'), brief(tickets));
  if (firstTicket?.ticketId) { const one = await v2('GET', `/bookings/${id}/tickets/${firstTicket.ticketId}`, { token: tokenA }); check('S-1', 'GET /bookings/{id}/tickets/{ticketId}: 200', one.status === 200, brief(one)); }
  const detail = await v2('GET', `/bookings/${id}`, { token: tokenA });
  check('S-1', 'detalle de la reserva: 200 CONFIRMED con _links', detail.status === 200 && detail.body?.status === 'CONFIRMED' && Boolean(detail.body._links), brief(detail));
  const list = await v2('GET', '/bookings?limit=50', { token: tokenA });
  check('S-1', 'mis reservas: la lista de A incluye la reserva', list.status === 200 && list.body?.items?.some((item) => item.bookingId === id), brief(list));
  const byPnr = detail.body?.pnr ? await v2('GET', `/bookings?pnr=${encodeURIComponent(detail.body.pnr)}`, { token: tokenA }) : undefined;
  check('S-1', 'mis reservas: el filtro por PNR encuentra la reserva', byPnr?.status === 200 && byPnr.body?.items?.some((item) => item.bookingId === id), byPnr ? brief(byPnr) : 'sin PNR');

  // Panel interno: reservas WEB de prueba, sin exponer al dueño.
  const webBookings = await api('GET', `${ADMIN_API}/web-bookings?limit=100`, { token: tokenAdmin });
  check('S-6', 'API interna: GET /web-bookings (admin) lista la reserva marcada de prueba y sin exponer el sub del dueño', webBookings.status === 200 && webBookings.body?.items?.some((item) => item.bookingId === id && item.test === true && item.channel === 'WEB') && !JSON.stringify(webBookings.body).includes(subA), brief(webBookings));

  // Postventa: equipaje, cambio de asiento (S-3), cotización.
  const options = await v2('GET', `/bookings/${id}/baggage-options`, { token: tokenA });
  const option = options.body?.[0];
  check('S-1', 'equipaje: opciones con precio y máximo', options.status === 200 && Boolean(option?.price?.total) && option.maxAllowed > 0, brief(options));
  if (option?.price) {
    const bag = await v2('POST', `/bookings/${id}/baggage`, { token: tokenA, key: randomUUID(), body: { passengerId: 'PAX-1', itineraryId: flight.itineraryId, quantity: 1, payment: { paymentReference: `pay_ok_${randomUUID()}`, amount: option.price } } });
    check('S-1', 'equipaje: compra de 1 maleta con pago simulado (200)', bag.status === 200 && bag.body?.totalBaggage === 1, `${brief(bag)} ${problemKind(bag)}`);
  }
  const seatChange = await v2('PUT', `/bookings/${id}/seats`, { token: tokenA, key: randomUUID(), body: { seats: [{ passengerId: 'PAX-1', segmentId: flight.segmentId, seatNumber: seat2 }] } });
  check('S-3', 'PUT /bookings/{id}/seats sobre una reserva de v2 de la misma cuenta: 200 con el asiento nuevo', seatChange.status === 200 && seatChange.body?.seats?.[0]?.seatNumber === seat2, `${brief(seatChange)} ${problemKind(seatChange)}`);
  const quote = await v2('GET', `/bookings/${id}/cancellation-quote`, { token: tokenA });
  check('S-1', 'cotización de cancelación: 200 con quoteId y reembolso calculado', quote.status === 200 && typeof quote.body?.quoteId === 'string', brief(quote));
  const early = await v2('POST', `/bookings/${id}/check-in`, { token: tokenA });
  check('S-1', 'check-in fuera de ventana (vuelo a más de 48 h) se rechaza con un error de negocio (4xx)', early.status >= 400 && early.status < 500, brief(early));

  // Aislamiento de la reserva: B y socio.
  const anyBody = { passengerId: 'PAX-1', itineraryId: flight.itineraryId, quantity: 1, payment: { paymentReference: `pay_ok_${randomUUID()}`, amount: { currency: 'USD', total: '1.00' } } };
  for (const [who, token, user] of foreign) {
    const probes = [['GET', `/bookings/${id}`], ['GET', `/bookings/${id}/tickets`], ['GET', `/bookings/${id}/boarding-passes`], ['GET', `/bookings/${id}/baggage-options`], ['GET', `/bookings/${id}/cancellation-quote`],
      ['PUT', `/bookings/${id}/seats`, { seats: [{ passengerId: 'PAX-1', segmentId: flight.segmentId, seatNumber: flight.free[2] ?? seat1 }] }], ['POST', `/bookings/${id}/baggage`, anyBody],
      ['POST', `/bookings/${id}/cancel`, { quoteId: quote.body?.quoteId ?? 'QTE-1', reasonCode: 'CUSTOMER_REQUEST' }], ['POST', `/bookings/${id}/check-in`]];
    const bad = [];
    for (const [method, path, body] of probes) { const response = await v2(method, path, { token, user, key: method === 'GET' ? undefined : randomUUID(), body }); if (!denied(response)) bad.push(`${method} ${path.replace(id, '{id}')} -> ${brief(response)}`); }
    check('S-1', `aislamiento: ${who} no ve, cambia, cancela ni hace check-in de la reserva de A (todo 404/403)`, bad.length === 0, bad.join('; '));
    const theirList = await v2('GET', '/bookings?limit=50', { token, user }); check('S-1', `aislamiento: la lista de ${who} no incluye la reserva de A`, theirList.status === 200 && !JSON.stringify(theirList.body).includes(id), brief(theirList));
  }
  const intact = await v2('GET', `/bookings/${id}`, { token: tokenA });
  check('S-1', 'tras los intentos ajenos, la reserva de A sigue CONFIRMED', intact.status === 200 && intact.body?.status === 'CONFIRMED', brief(intact));
  if (partner) {
    const partnerOwn = await v2('GET', '/bookings?limit=50', { token: partner.token, user: 'f12c-prueba' }); check('S-1', 'el cliente no ve en su lista reservas del socio y el socio no ve las del cliente (b)', partnerOwn.status === 200 && !JSON.stringify(partnerOwn.body).includes(id), brief(partnerOwn));
  } else notApplicable('S-1', 'aislamiento frente a un socio (b)', 'faltan PARTNER_CLIENT_ID y PARTNER_CLIENT_SECRET');
  const webhookAsCustomer = await v2('POST', '/webhooks', { token: tokenA, key: randomUUID(), body: { url: 'https://example.com/f12c-prueba', events: ['booking.confirmed'], secret: `f12c-${randomUUID()}` } });
  if (webhookAsCustomer.body?.id) await v2('DELETE', `/webhooks/${webhookAsCustomer.body.id}`, { token: tokenA });
  check('S-1', 'el cliente no puede publicar como socio: crear un webhook responde 403 (c)', webhookAsCustomer.status === 403, brief(webhookAsCustomer));

  // Cancelación (flujo del cliente) y restauración del inventario.
  const cancelled = await v2('POST', `/bookings/${id}/cancel`, { token: tokenA, key: randomUUID(), body: { quoteId: quote.body?.quoteId, reasonCode: 'CUSTOMER_REQUEST', reason: 'prueba automatizada F12c' } });
  check('S-1', 'cancelación con quoteId: 200 CANCELLED con reembolso informado', cancelled.status === 200 && isTerminalCancelled(cancelled.body?.status) && Boolean(cancelled.body.refund), `${brief(cancelled)} ${problemKind(cancelled)}`);
  if (cancelled.status === 200) forgetBooking(id);
  const again = await v2('POST', `/bookings/${id}/cancel`, { token: tokenA, key: randomUUID(), body: { reasonCode: 'CUSTOMER_REQUEST' } });
  check('S-1', 'cancelar otra vez responde 409 ALREADY_CANCELLED', again.status === 409 && again.body?.code === 'ALREADY_CANCELLED', brief(again));
  let restored = false; for (const deadline = Date.now() + 20_000; !restored && Date.now() < deadline; await sleep(1500)) { const after = await v2('GET', `/offers/${flight.offerId}/seatmap?segmentId=${flight.segmentId}`); restored = ['AVAILABLE'].includes(seatsOf(after.body, flight.cabinClass).find((seat) => seat.seatNumber === seat2)?.status) && seatsOf(after.body, flight.cabinClass).find((seat) => seat.seatNumber === seat1)?.status === 'AVAILABLE'; }
  check('S-1', 'al cancelar, los asientos vuelven a AVAILABLE en el mapa', restored, 'el inventario no se restauró en 20 s');

  // Check-in con vuelo dentro de la ventana (si existe uno vacío).
  if (!windowFlight) notApplicable('S-1', 'check-in y pase de abordar (vuelo dentro de las 48 h)', 'no hay un vuelo vacío dentro de la ventana de check-in; no es una falla');
  else {
    const winHold = await makeHold(tokenA, windowFlight, { seat: windowFlight.free[0] });
    const winBooking = winHold.status === 201 ? await reserve(tokenA, winHold, `pay_ok_${randomUUID()}`) : winHold;
    if (check('S-1', `reserva sobre un vuelo vacío dentro de la ventana (${windowFlight.flightNumber}, sale en ~${Math.round(windowFlight.hours)} h)`, winBooking.status === 201, brief(winBooking))) {
      const checkIn = await v2('POST', `/bookings/${winBooking.body.bookingId}/check-in`, { token: tokenA });
      check('S-1', 'check-in dentro de la ventana: 200', checkIn.status === 200, `${brief(checkIn)} ${problemKind(checkIn)}`);
      if (checkIn.status === 200) created.bookings.find((item) => item.id === winBooking.body.bookingId).checkedIn = true;
      const passes = await v2('GET', `/bookings/${winBooking.body.bookingId}/boarding-passes`, { token: tokenA });
      check('S-1', 'pases de abordar: 200 con al menos un pase', passes.status === 200 && JSON.stringify(passes.body ?? '').length > 20 && (passes.body?.boardingPasses?.length ?? passes.body?.length ?? passes.body?.items?.length ?? 1) > 0, brief(passes));
      const foreignPasses = await v2('GET', `/bookings/${winBooking.body.bookingId}/boarding-passes`, { token: tokenB }); check('S-1', 'aislamiento: B no ve los pases de A (404/403)', denied(foreignPasses), brief(foreignPasses));
    }
  }

  // ── S-5: pago ──
  const payHold = await makeHold(tokenA, flight);
  if (check('S-5', 'hold de A para las pruebas de pago: 201', payHold.status === 201, brief(payHold))) {
    const refused = await reserve(tokenA, payHold, `pay_denied_${randomUUID()}`);
    check('S-5', 'pay_denied_* → 422 PAYMENT_NOT_AUTHORIZED y no se crea reserva', refused.status === 422 && refused.body?.code === 'PAYMENT_NOT_AUTHORIZED' && !refused.body?.bookingId, `${brief(refused)} ${problemKind(refused)}`);
    const stillHeld = await v2('GET', `/offers/hold/${payHold.body.holdId}`, { token: tokenA }); check('S-5', 'tras el pago rechazado el hold sigue HELD (se puede reintentar)', stillHeld.body?.status === 'HELD', brief(stillHeld));
    if (env('SKIP_PENDING') === '1') notApplicable('S-5', 'pay_pending_* → 202 PENDING_PAYMENT', 'SKIP_PENDING=1');
    else {
      const pending = await reserve(tokenA, payHold, `pay_pending_${randomUUID()}`);
      check('S-5', 'pay_pending_* → 202 PENDING_PAYMENT', pending.status === 202 && pending.body?.status === 'PENDING_PAYMENT', `${brief(pending)} ${problemKind(pending)}`);
      const entry = created.bookings.find((item) => item.id === pending.body?.bookingId); if (entry) entry.pending = true;
    }
  }
  if (partner) {
    const partnerHold = await v2('POST', '/offers/hold', { token: partner.token, user: 'f12c-prueba', key: randomUUID(), body: { offerId: flight.offerId, itinerarySelections: [{ itineraryId: flight.itineraryId, cabinClass: flight.cabinClass, fareBrand: flight.fareBrand }], passengersBreakdown: { adults: 1 } } });
    if (partnerHold.status === 201) {
      created.holds.push({ id: partnerHold.body.holdId, token: partner.token, user: 'f12c-prueba' });
      const sale = await v2('POST', '/bookings', { token: partner.token, user: 'f12c-prueba', key: randomUUID(), body: { holdId: partnerHold.body.holdId, passengers: [passenger('PAX-1')], payment: { paymentReference: `pay_ok_${randomUUID()}`, amount: partnerHold.body.lockedPrice } } });
      if (sale.body?.bookingId) created.bookings.push({ id: sale.body.bookingId, token: partner.token, user: 'f12c-prueba', done: false });
      check('S-5', `un socio con pay_ok_* NO vende (el canal BOOKING exige el pago real de Booking; respuesta ${sale.status})`, sale.status >= 400 && !sale.body?.bookingId, brief(sale));
      await v2('DELETE', `/offers/hold/${partnerHold.body.holdId}`, { token: partner.token, user: 'f12c-prueba' });
    } else notApplicable('S-5', 'un socio con pay_ok_* no vende', `el socio de prueba no pudo retener (${brief(partnerHold)})`);
  } else notApplicable('S-5', 'un socio con pay_ok_* no vende', 'faltan PARTNER_CLIENT_ID y PARTNER_CLIENT_SECRET');
  notApplicable('S-5', 'canal WEB con WEB_PAYMENT_MODE apagado no vende y correo sin confirmar → 403', 'no se puede apagar el interruptor ni fabricar un token sin confirmar desde aquí; lo cubre la prueba e2e WEB-E2E-02/06');

  // ── S-2 y S-6: administrador ──
  const none = await v2('GET', `/operaciones/vuelos?date=${flight.date}`); check('S-2', 'panel de operaciones sin token: 401', none.status === 401, brief(none));
  const asCustomer = await v2('GET', `/operaciones/vuelos?date=${flight.date}`, { token: tokenA }); check('S-2', 'panel de operaciones con token de customer: 403', asCustomer.status === 403, brief(asCustomer));
  const panel = await v2('GET', `/operaciones/vuelos?date=${flight.date}&limit=5`, { token: tokenAdmin }); check('S-2', 'panel de operaciones con token de admin: 200 con vuelos (no 403)', panel.status === 200 && Array.isArray(panel.body?.items), brief(panel));
  const patchBody = { date: flight.date, status: 'SCHEDULED' };
  const patchCustomer = await v2('PATCH', '/flights/ZZ9999/status', { token: tokenA, body: patchBody }); check('S-2', 'PATCH de estado con token de customer: 403', patchCustomer.status === 403, brief(patchCustomer));
  const patchAdmin = await v2('PATCH', '/flights/ZZ9999/status', { token: tokenAdmin, body: patchBody });
  check('S-2', 'PATCH de estado con token de admin sobre un vuelo inexistente: autorizado (404, no 403) y sin efectos (modo lectura)', patchAdmin.status === 404 || patchAdmin.status === 400, brief(patchAdmin));
  const patchTarget = env('ADMIN_PATCH_FLIGHT').split(':');
  if (patchTarget.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(patchTarget[1])) {
    const [number, date] = patchTarget; const before = await v2('GET', `/flights/${number}/status?date=${date}`);
    if (check('S-2', `PATCH real: el vuelo de prueba ${number} existe y está SCHEDULED`, before.status === 200 && before.body?.status === 'SCHEDULED', brief(before))) {
      // Solo un cambio REVERSIBLE: mismo estado (SCHEDULED) y la hora estimada +30 min, que se devuelve a la hora programada. Nunca se pasa a DELAYED/CANCELLED (esas transiciones no se deshacen).
      const scheduledAt = before.body.departure?.scheduledAt; let changed = false;
      try {
        const moved = await v2('PATCH', `/flights/${number}/status`, { token: tokenAdmin, body: { date, status: 'SCHEDULED', estimatedDepartureAt: new Date(Date.parse(scheduledAt) + 1_800_000).toISOString(), reason: 'prueba automatizada F12c' } });
        changed = moved.status === 200;
        if (moved.status === 409) notApplicable('S-2', 'PATCH real con token de admin (hora estimada +30 min)', `el vuelo no admite un cambio reversible (${brief(moved)} ${problemKind(moved)}); no se aplicó ningún cambio`);
        else check('S-2', 'PATCH real con token de admin (mismo estado, hora estimada +30 min): 200', moved.status === 200, `${brief(moved)} ${problemKind(moved)}`);
      } finally { if (changed) { const back = await v2('PATCH', `/flights/${number}/status`, { token: tokenAdmin, body: { date, status: 'SCHEDULED', estimatedDepartureAt: scheduledAt, reason: 'restauración de la prueba F12c' } }); check('S-2', 'el vuelo de prueba se restauró (hora estimada = programada, SCHEDULED)', back.status === 200, `${brief(back)} ${problemKind(back)}; restaurar a mano`); } }
    }
  } else notApplicable('S-2', 'PATCH real de estado sobre un vuelo de prueba', 'sin ADMIN_PATCH_FLIGHT=<vuelo>:<fecha>; solo se comprobó la autorización en modo lectura');
  const promo = await v2('GET', '/promociones/contrato', { token: tokenAdmin });
  if (promo.status === 404) notApplicable('S-2', 'GET /promociones/contrato con token de admin: 200', 'autorizado (no 403), pero todavía no hay acuerdo guardado (404); el PUT del admin no se prueba para no crear uno');
  else check('S-2', 'GET /promociones/contrato con token de admin: 200 (no 403)', promo.status === 200, brief(promo));
  const putCustomer = await v2('PUT', '/promociones/contrato', { token: tokenA, body: promo.status === 200 && promo.body && typeof promo.body === 'object' ? promo.body : {} });
  check('S-2', 'PUT /promociones/contrato con token de customer: 403', putCustomer.status === 403, brief(putCustomer));
  if (promo.status === 200 && promo.body && typeof promo.body === 'object') {
    const putAdmin = await v2('PUT', '/promociones/contrato', { token: tokenAdmin, body: promo.body }); check('S-2', 'PUT /promociones/contrato con token de admin (mismo contenido que acaba de leer): 200 (no 403)', putAdmin.status === 200, `${brief(putAdmin)} ${problemKind(putAdmin)}`);
  }
  // API interna (S-6)
  const adminNone = await api('GET', `${ADMIN_API}/flights`); check('S-6', 'API interna sin token: 401', adminNone.status === 401, brief(adminNone));
  const adminCustomer = await api('GET', `${ADMIN_API}/flights`, { token: tokenA }); check('S-6', 'API interna con token de customer: 403', adminCustomer.status === 403, brief(adminCustomer));
  const putFareCustomer = await api('PUT', `${ADMIN_API}/fares`, { token: tokenA, body: {} }); check('S-6', 'API interna: PUT /fares con token de customer: 403 (la autorización va antes que la validación)', putFareCustomer.status === 403, brief(putFareCustomer));
  if (partner) { const adminPartner = await api('GET', `${ADMIN_API}/flights`, { token: partner.token }); check('S-6', 'API interna con token de socio: 403', adminPartner.status === 403, brief(adminPartner)); } else notApplicable('S-6', 'API interna con token de socio: 403', 'faltan las credenciales del socio');
  const adminFlights = await api('GET', `${ADMIN_API}/flights?date=${flight.date}&limit=200`, { token: tokenAdmin });
  check('S-6', 'API interna con token de admin: GET /flights → 200 con flightInstanceId', adminFlights.status === 200 && Array.isArray(adminFlights.body?.items) && adminFlights.body.items.every((item) => item.flightInstanceId), brief(adminFlights));
  const instance = adminFlights.body?.items?.[0]?.flightInstanceId;
  if (instance) { const fares = await api('GET', `${ADMIN_API}/fares?flightInstanceId=${instance}`, { token: tokenAdmin }); check('S-6', 'API interna con token de admin: GET /fares → 200', fares.status === 200 && Array.isArray(fares.body?.fares), brief(fares)); }
  else notApplicable('S-6', 'API interna: GET /fares', 'la lista de vuelos de la fecha vino vacía');

  // ── Topes del canal WEB (B-3) con el cliente B ──
  if (env('SKIP_CAPS') === '1') notApplicable('S-5', 'topes del canal WEB (reservas activas / pasajeros por día)', 'SKIP_CAPS=1');
  else {
    const max = intEnv('CAP_PROBE_MAX', 8); let hit; let made = 0;
    for (let index = 0; index < max && !hit; index += 1) {
      const capHold = await makeHold(tokenB, flight); if (capHold.status !== 201) { hit = capHold; break; }
      const sale = await reserve(tokenB, capHold, `pay_ok_${randomUUID()}`);
      if (sale.status === 429) hit = sale; else if (sale.status === 201) made += 1; else { hit = sale; break; }
    }
    if (hit?.status === 429) check('S-5', `tope del canal WEB: la reserva ${made + 1} de B responde 429 con tipo propio (${problemKind(hit)})`, ['web-active-bookings-limit', 'web-passengers-per-day-limit'].includes(problemKind(hit)) && hit.body?.code === 'RATE_LIMIT_EXCEEDED', `${brief(hit)} ${problemKind(hit)}`);
    else if (hit) check('S-5', 'tope del canal WEB: la búsqueda del tope no se interrumpió por otro error', false, `${brief(hit)} ${problemKind(hit)}`);
    else notApplicable('S-5', 'tope del canal WEB', `no se alcanzó en ${max} reservas (CAP_PROBE_MAX); los topes de la nube son mayores o están desactivados`);
    // Se cancelan ya las reservas de B (antes de la prueba de límite de peticiones, que lo dejaría 429 durante un minuto).
    for (const item of created.bookings.filter((entry) => entry.token === tokenB && !entry.done)) { const result = await cancelBooking(tokenB, item.id); if (result.cancel.status === 200) item.done = true; }
  }

  // ── S-4: límite de peticiones ──
  if (env('SKIP_RATE_LIMIT') === '1') notApplicable('S-4', 'límite de peticiones por huella y por sub', 'SKIP_RATE_LIMIT=1');
  else {
    const maxTries = intEnv('RATE_LIMIT_MAX', 130); const probeFp = `f12c-${randomUUID()}`; const searchBody = { itineraries: [{ origin: flight.origin, destination: flight.destination, departureDate: flight.date }], passengers: { adults: 1 } };
    let limited; let sent = 0;
    for (; sent < maxTries && !limited; sent += 1) { const response = await v2('POST', '/search', { headers: { 'X-Device-Fingerprint': probeFp }, body: searchBody }); if (response.status === 429) limited = response; else if (response.status !== 200) { limited = response; break; } }
    check('S-4', `límite público por X-Device-Fingerprint: la petición ${sent} (misma huella) responde 429 con Retry-After`, limited?.status === 429 && Boolean(limited.headers.get('retry-after')), limited ? brief(limited) : `sin 429 tras ${maxTries} peticiones`);
    const otherFp = await v2('POST', '/search', { headers: { 'X-Device-Fingerprint': `f12c-${randomUUID()}` }, body: searchBody }); check('S-4', 'otra huella no queda limitada (200)', otherFp.status === 200, brief(otherFp));
    let limitedAuth; let sentAuth = 0;
    for (; sentAuth < maxTries && !limitedAuth; sentAuth += 1) { const response = await v2('GET', '/bookings?limit=1', { token: tokenB }); if (response.status === 429) limitedAuth = response; else if (response.status !== 200) { limitedAuth = response; break; } }
    check('S-4', `límite autenticado por sub: la petición ${sentAuth} de B responde 429 con Retry-After`, limitedAuth?.status === 429 && Boolean(limitedAuth.headers.get('retry-after')), limitedAuth ? brief(limitedAuth) : `sin 429 tras ${maxTries} peticiones`);
    const aStill = await v2('GET', '/bookings?limit=1', { token: tokenA }); check('S-4', 'el límite de B no afecta a A (200)', aStill.status === 200, brief(aStill));
  }
}

async function main() {
  if (!base) { process.stdout.write('Falta BASE_URL (o use --local para el ensayo contra local:up).\n'); return false; }
  let tokenA = env('CUSTOMER_A_TOKEN'); let tokenB = env('CUSTOMER_B_TOKEN'); let tokenAdmin = env('ADMIN_TOKEN'); let partner;
  const dropClient = { id: '', file: '' };
  if (local) {
    const guard = cli('check-local'); if (!guard.ok) { process.stdout.write(`Ensayo abortado: ${guard.message}\n`); return false; }
    tokenA = devToken(randomUUID(), 'customer', USER_SCOPES); tokenB = devToken(randomUUID(), 'customer', USER_SCOPES); tokenAdmin = devToken(randomUUID(), 'admin', ADMIN_SCOPES);
    dropClient.id = `journey-f12c-${Date.now().toString(36)}`; dropClient.file = join(repo, '.local', `${dropClient.id}.secret`); mkdirSync(join(repo, '.local'), { recursive: true });
    const made = cli('create', '--client-id', dropClient.id, '--out', dropClient.file);
    if (made.ok) { const secret = /client_secret=(.+)/.exec(readFileSync(dropClient.file, 'utf8'))?.[1]?.trim(); const issued = await api('POST', '/api/v2/oauth2/token', { form: { grant_type: 'client_credentials', client_id: dropClient.id, client_secret: secret } }); if (issued.body?.access_token) partner = { token: issued.body.access_token }; }
  } else if (env('PARTNER_CLIENT_ID') && env('PARTNER_CLIENT_SECRET')) {
    const issued = await api('POST', '/api/v2/oauth2/token', { form: { grant_type: 'client_credentials', client_id: env('PARTNER_CLIENT_ID'), client_secret: env('PARTNER_CLIENT_SECRET') } });
    if (issued.body?.access_token) partner = { token: issued.body.access_token }; else process.stdout.write(`     (no se pudo obtener el token del socio: ${issued.status}; se saltan sus comprobaciones)\n`);
  }
  const missing = [['CUSTOMER_A_TOKEN', tokenA], ['CUSTOMER_B_TOKEN', tokenB], ['ADMIN_TOKEN', tokenAdmin]].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) { process.stdout.write(`Faltan variables de entorno: ${missing.join(', ')}\n`); return false; }
  process.stdout.write(`Pruebas con usuarios reales S-1 a S-6 · ${local ? 'ENSAYO LOCAL' : 'NUBE'} · socio de prueba: ${partner ? 'sí' : 'no (se saltan sus comprobaciones)'}\n\n`);
  let clean = true;
  try { await run({ tokenA, tokenB, tokenAdmin, partner }); }
  catch (error) { report('-', 'FALLA', 'la ejecución se interrumpió', error instanceof Error ? error.name : 'error'); }
  finally {
    try { clean = await cleanup(); } catch { clean = false; process.stdout.write('\nLimpieza: error inesperado; revise reservas y holds de las cuentas de prueba.\n'); }
    if (dropClient.id) { if (existsSync(dropClient.file)) rmSync(dropClient.file, { force: true }); const removed = cli('delete', '--client-id', dropClient.id, '--yes'); process.stdout.write(`socio de prueba local: ${removed.ok ? 'eliminado' : 'NO se pudo eliminar'}\n`); }
  }
  return clean;
}

main().then((clean) => {
  const tags = ['S-1', 'S-2', 'S-3', 'S-4', 'S-5', 'S-6']; process.stdout.write('\nResumen por prueba:\n');
  for (const tag of tags) { const own = results.filter((item) => item.tag === tag); const failed = own.filter((item) => item.state === 'FALLA').length; process.stdout.write(`  ${tag}: ${own.filter((item) => item.state === 'OK').length} OK, ${failed} FALLA, ${own.filter((item) => item.state === 'N/A').length} N/A${own.length === 0 ? ' (no se ejecutó)' : failed ? '  <- BLOQUEA F12c-1' : ''}\n`); }
  const failed = results.filter((item) => item.state === 'FALLA').length; const total = results.length;
  process.stdout.write(`\nTotal: ${results.filter((item) => item.state === 'OK').length} OK, ${failed} FALLA, ${results.filter((item) => item.state === 'N/A').length} N/A de ${total}. Limpieza: ${clean ? 'completa' : 'INCOMPLETA'}.\n`);
  process.exit(failed === 0 && clean && total > 0 ? 0 : 1);
}).catch((error) => { process.stdout.write(`Interrumpido: ${error instanceof Error ? error.name : 'error'}\n`); process.exit(1); });
