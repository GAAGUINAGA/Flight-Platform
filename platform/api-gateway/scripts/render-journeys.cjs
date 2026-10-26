// Recorridos J1, J2, J5, J6 y J7 contra el Gateway desplegado (PLT-J3). J3 y J4 quedan fuera por decisión documentada (ADR-F11-17).
// Los tokens salen solo de variables de entorno y nunca se imprimen; los errores informan paso, estado y código, sin cuerpos.
const { Buffer } = require('node:buffer');
const { createHmac, randomUUID, timingSafeEqual } = require('node:crypto');
const process = require('node:process');
const { setTimeout: sleep } = require('node:timers/promises');

const required = (name) => { if (!process.env[name]) throw new Error(`${name}: falta la variable de entorno`); return process.env[name]; };
const number = (name, fallback) => { const value = Number(process.env[name] ?? fallback); if (!Number.isFinite(value) || value < 0) throw new Error(`${name}: valor inválido`); return value; };
const base = `${required('BASE_URL').replace(/\/$/, '')}/flights/v1`;
const origin = process.env.SMOKE_ORIGIN || 'UIO'; const destination = process.env.SMOKE_DESTINATION || 'GYE';
const pollSeconds = number('SMOKE_POLL_SECONDS', 20); const j2MaxWaitMinutes = number('SMOKE_J2_MAX_WAIT_MINUTES', 30);
const eventGraceSeconds = number('SMOKE_J2_EVENT_GRACE_SECONDS', 180); const retryDelaySeconds = number('SMOKE_RETRY_SECONDS', 5);
const requested = (process.env.SMOKE_JOURNEYS || 'J1,J2,J5,J6,J7').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
// Cada token se exige solo si algún recorrido pedido lo usa. J2 usa la cuenta partner: webhooks entrega los eventos solo a suscripciones del mismo dueño que creó el hold.
const needs = { SUPABASE_CUSTOMER_TOKEN: ['J1', 'J5', 'J6', 'J7'], SUPABASE_PARTNER_TOKEN: ['J2'], SUPABASE_ADMIN_TOKEN: ['J7'] };
const needed = (name) => requested.some((journey) => needs[name].includes(journey));
const tokenOf = (name) => (needed(name) ? required(name) : '');
const customerToken = tokenOf('SUPABASE_CUSTOMER_TOKEN'); const partnerToken = tokenOf('SUPABASE_PARTNER_TOKEN'); const adminToken = tokenOf('SUPABASE_ADMIN_TOKEN') || (needed('SUPABASE_ADMIN_TOKEN') ? required('SMOKE_ADMIN_TOKEN') : '');

// J2 comprueba la entrega de hold.expired consultando un receptor externo (p. ej. webhook.site): SMOKE_WEBHOOK_URL es su URL pública
// y SMOKE_RECEIVER_API_URL la URL de su API que lista las peticiones recibidas ({ data: [{ content, headers }] }).
const receiverUrl = requested.includes('J2') ? required('SMOKE_RECEIVER_API_URL') : ''; const webhookUrl = requested.includes('J2') ? required('SMOKE_WEBHOOK_URL') : '';
const receiverKey = process.env.SMOKE_RECEIVER_API_KEY;

const failure = (step, status, code) => Object.assign(new Error(`${step}: estado ${status}, código ${code}`), { step });
const asUser = (token) => ({ authorization: `Bearer ${token}` });

/** Una llamada. Reintenta solo lo seguro de repetir (GET o POST con Idempotency-Key) ante red caída o 503 de arranque en frío. */
async function call(step, method, path, expected, { token, body, idempotent, fingerprint = true, headers = {}, report = true, retries = 4 } = {}) {
  const safe = method === 'GET' || method === 'DELETE' || idempotent;
  const key = idempotent ? randomUUID() : undefined;
  for (let attempt = 0; ; attempt++) {
    let response; let payload = {};
    try {
      response = await globalThis.fetch(`${base}${path}`, {
        method,
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? asUser(token) : {}), ...(fingerprint ? { 'x-device-fingerprint': randomUUID() } : {}), ...(key ? { 'idempotency-key': key } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined
      });
      const text = await response.text(); try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
    } catch { response = undefined; }
    const retryable = safe && attempt < retries && (!response || (response.status === 503 && expected !== 503));
    if (retryable) { await sleep(Math.max(retryDelaySeconds, Number(response?.headers.get('retry-after') ?? 0)) * 1000); continue; }
    if (!response) throw failure(step, 0, 'NETWORK_ERROR');
    const accepted = Array.isArray(expected) ? expected : [expected];
    if (!accepted.includes(response.status)) throw failure(step, response.status, payload.code || 'UNKNOWN');
    if (report) process.stdout.write(`OK   ${step}\n`);
    return { status: response.status, body: payload, headers: response.headers };
  }
}

const dayOffset = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const passenger = (passengerId, segmentId, seat) => ({ passengerId, passengerType: 'ADULT', firstName: 'Smoke', lastName: 'Passenger', documentType: 'PASSPORT', documentNumber: 'SMOKE123', nationality: 'EC', documentExpiryDate: '2035-01-01', birthDate: '1990-01-01', gender: 'X', contact: { email: 'smoke@example.invalid', phone: '+593999999999' }, assignedSeats: seat ? [{ segmentId, seatNumber: seat }] : [], extraBaggage: [] });
const pay = (kind = 'ok') => ({ paymentReference: `pay_${kind}_${randomUUID()}` });

/** Busca un vuelo de un solo tramo que cumpla `accept`; recorre días consecutivos desde hoy. */
async function choose(step, { days, accept, flightNumber }) {
  for (let day = 0; day <= days; day++) {
    const result = await call(step, 'POST', '/search', 200, { body: { itineraries: [{ origin, destination, departureDate: dayOffset(day) }], passengers: { adults: 1 } }, report: false });
    for (const offer of result.body.offers || []) for (const itinerary of offer.itineraries || []) {
      if (itinerary.segments?.length !== 1) continue;
      const segment = itinerary.segments[0]; const start = Date.parse(segment.departure?.at);
      const option = itinerary.pricingOptions?.find((item) => item.availableSeats > 0 && accept.option(item));
      if (Number.isFinite(start) && option && accept.start(start) && (!flightNumber || segment.flightNumber === flightNumber)) { process.stdout.write(`OK   ${step}\n`); return { offer, itinerary, segment, option }; }
    }
  }
  throw failure(step, 200, 'NO_SUITABLE_FLIGHT');
}
const later = { start: (start) => start > Date.now() + 6 * 3_600_000, option: (option) => option.fareRules?.isChangeable === true };
const anyLater = { start: later.start, option: () => true };
const window = { start: (start) => start >= Date.now() + 2 * 3_600_000 && start <= Date.now() + 47 * 3_600_000, option: () => true };

const holdOf = (candidate) => ({ offerId: candidate.offer.offerId, itinerarySelections: [{ itineraryId: candidate.itinerary.itineraryId, cabinClass: candidate.option.cabinClass, fareBrand: candidate.option.fareBrand }], passengersBreakdown: { adults: 1 } });
async function purchase(name, candidate, token, seat) {
  const hold = await call(`${name} hold`, 'POST', '/offers/hold', 201, { token, idempotent: true, body: holdOf(candidate) });
  const passengerId = randomUUID();
  const booking = await call(`${name} reserva`, 'POST', '/bookings', 201, { token, idempotent: true, body: { holdId: hold.body.holdId, passengers: [passenger(passengerId, candidate.segment.segmentId, seat)], payment: pay() } });
  if (booking.body.status !== 'CONFIRMED') throw failure(`${name} reserva`, 201, 'BOOKING_NOT_CONFIRMED');
  return { bookingId: booking.body.bookingId, path: `/bookings/${encodeURIComponent(booking.body.bookingId)}`, passengerId };
}

const shared = {};
async function ensureBooking() {
  if (!shared.booking) { const candidate = await choose('J7 búsqueda', { days: 14, accept: anyLater }); shared.booking = await purchase('J7', candidate, customerToken); }
  return shared.booking;
}

async function warmup() {
  const deadline = Date.now() + number('SMOKE_WARMUP_SECONDS', 180) * 1000;
  for (let attempt = 0; ; attempt++) {
    try { const response = await globalThis.fetch(`${base}/health`); if (response.status === 200) break; } catch { /* el servicio sigue despertando */ }
    if (Date.now() > deadline) throw failure('precalentamiento Gateway', 0, 'TIMEOUT');
    await sleep(retryDelaySeconds * 1000);
  }
  process.stdout.write('OK   precalentamiento Gateway\n');
  // Una búsqueda recorre Pricing e Inventory y despierta ambos; las demás dependencias se despiertan en su primer uso, con reintentos.
  await call('precalentamiento servicios', 'POST', '/search', 200, { body: { itineraries: [{ origin, destination, departureDate: dayOffset(1) }], passengers: { adults: 1 } }, retries: 24 });
}

async function j1() {
  await call('J1 sin token', 'GET', '/bookings', 401);
  const candidate = await choose('J1 búsqueda', { days: 14, accept: anyLater });
  await call('J1 mapa', 'GET', `/offers/${encodeURIComponent(candidate.offer.offerId)}/seatmap?segmentId=${encodeURIComponent(candidate.segment.segmentId)}`, 200);
  const booking = await purchase('J1', candidate, customerToken); shared.booking = booking;
  const detail = await call('J1 detalle', 'GET', booking.path, 200, { token: customerToken });
  if (detail.body.bookingId !== booking.bookingId || detail.body.status !== 'CONFIRMED') throw failure('J1 detalle', 200, 'BOOKING_MISMATCH');
  const tickets = await call('J1 tickets', 'GET', `${booking.path}/tickets`, 200, { token: customerToken });
  if (!tickets.body.tickets?.some((item) => item.status === 'ISSUED')) throw failure('J1 tickets', 200, 'NO_ISSUED_TICKET');
}

/** Busca en el receptor el evento hold.expired del hold y verifica su firma con el secreto de la suscripción. Devuelve 'ausente', 'firma' o 'ok'. */
async function receivedExpiry(holdId, secret) {
  let response;
  try { response = await globalThis.fetch(receiverUrl, { headers: { accept: 'application/json', ...(receiverKey ? { 'api-key': receiverKey } : {}) } }); } catch { throw failure('J2 receptor', 0, 'RECEIVER_UNREACHABLE'); }
  if (!response.ok) throw failure('J2 receptor', response.status, 'RECEIVER_ERROR');
  const listing = await response.json().catch(() => ({})); const items = Array.isArray(listing) ? listing : listing.data;
  let result = 'ausente';
  for (const item of Array.isArray(items) ? items : []) {
    const raw = item.content ?? item.body; let event;
    try { event = JSON.parse(raw); } catch { continue; }
    if (event?.eventType !== 'hold.expired' || event.data?.holdId !== holdId) continue;
    const header = [].concat(item.headers?.['x-flight-signature'] ?? item.headers?.['X-Flight-Signature'] ?? [])[0];
    if (validSignature(raw, header, secret)) return 'ok';
    result = 'firma';
  }
  return result;
}
function validSignature(raw, header, secret) {
  const fields = new Map(String(header ?? '').split(',').map((part) => [part.slice(0, part.indexOf('=')).trim(), part.slice(part.indexOf('=') + 1).trim()]));
  const timestamp = Number(fields.get('t')); const signature = fields.get('v1');
  if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/.test(signature ?? '') || Math.abs(Date.now() / 1000 - timestamp) > 3600) return false;
  return timingSafeEqual(createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest(), Buffer.from(signature, 'hex'));
}

async function j2() {
  const candidate = await choose('J2 búsqueda', { days: 14, accept: anyLater });
  const key = randomUUID(); const body = holdOf(candidate);
  const send = (step) => globalThis.fetch(`${base}/offers/hold`, { method: 'POST', headers: { ...asUser(partnerToken), 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => ({})) })).catch(() => { throw failure(step, 0, 'NETWORK_ERROR'); });
  const first = await send('J2 hold'); if (first.status !== 201) throw failure('J2 hold', first.status, first.body.code || 'UNKNOWN');
  const repeated = await send('J2 hold repetido'); if (repeated.status !== 201 || repeated.body.holdId !== first.body.holdId) throw failure('J2 hold repetido', repeated.status, 'IDEMPOTENCY_BROKEN');
  process.stdout.write('OK   J2 hold idempotente\n');
  const holdPath = `/offers/hold/${first.body.holdId}`;
  const held = await call('J2 consulta', 'GET', holdPath, 200, { token: partnerToken }); if (held.body.status !== 'HELD') throw failure('J2 consulta', 200, 'NOT_HELD');
  await call('J2 liberación', 'DELETE', holdPath, 204, { token: partnerToken });
  await call('J2 liberación repetida', 'DELETE', holdPath, 204, { token: partnerToken });
  const released = await call('J2 consulta liberado', 'GET', holdPath, 200, { token: partnerToken }); if (released.body.status !== 'RELEASED') throw failure('J2 consulta liberado', 200, 'NOT_RELEASED');

  const target = await call('J2 hold a vencer', 'POST', '/offers/hold', 201, { token: partnerToken, idempotent: true, body });
  const waitMs = Date.parse(target.body.expiresAt) - Date.now();
  if (!Number.isFinite(waitMs)) throw failure('J2 hold a vencer', 201, 'NO_EXPIRY');
  if (waitMs > j2MaxWaitMinutes * 60_000) {
    await call('J2 liberación del hold no usado', 'DELETE', `/offers/hold/${target.body.holdId}`, 204, { token: partnerToken, report: false });
    throw Object.assign(failure('J2 espera', 0, 'WAIT_TOO_LONG'), { skipped: `el hold dura ${Math.round(waitMs / 60_000)} min (ttlMinutes ${target.body.ttlMinutes}) y SMOKE_J2_MAX_WAIT_MINUTES es ${j2MaxWaitMinutes}; sube el límite si el TTL real es mayor` });
  }
  const secret = process.env.SMOKE_WEBHOOK_SECRET || `smoke-${randomUUID()}`;
  const subscription = (await call('J2 webhook hold.expired', 'POST', '/webhooks', 201, { token: partnerToken, body: { url: webhookUrl, events: ['hold.expired'], secret } })).body;
  try {
    // Cada sondeo es una petición al Gateway: lo mantiene despierto (Render suspende tras ~15 min sin tráfico) y con él el scheduler que publica hold.expired.
    const deadline = Date.parse(target.body.expiresAt) + 240_000; let status = 'HELD';
    while (status === 'HELD') {
      status = (await call('J2 espera del vencimiento', 'GET', `/offers/hold/${target.body.holdId}`, 200, { token: partnerToken, report: false })).body.status;
      if (status !== 'HELD') break;
      if (Date.now() > deadline) throw failure('J2 vencimiento', 200, 'NOT_EXPIRED');
      process.stdout.write(`...  J2 esperando el vencimiento (${Math.max(0, Math.round((Date.parse(target.body.expiresAt) - Date.now()) / 1000))} s)\n`);
      await sleep(pollSeconds * 1000);
    }
    if (status !== 'EXPIRED') throw failure('J2 vencimiento', 200, `STATUS_${status}`);
    process.stdout.write('OK   J2 hold vencido\n');
    const expired = await call('J2 reserva con hold vencido', 'POST', '/bookings', 410, { token: partnerToken, idempotent: true, body: { holdId: target.body.holdId, passengers: [passenger(randomUUID(), candidate.segment.segmentId)], payment: pay() } });
    if (expired.body.code !== 'OFFER_NO_LONGER_AVAILABLE') throw failure('J2 reserva con hold vencido', 410, expired.body.code || 'UNKNOWN');
    // El scheduler del Gateway publica hold.expired y Webhooks lo entrega; se espera hasta eventGraceSeconds. Cada vuelta toca el Gateway para mantenerlo despierto.
    const eventDeadline = Date.now() + eventGraceSeconds * 1000; let seen = await receivedExpiry(target.body.holdId, secret);
    while (seen !== 'ok') {
      if (Date.now() > eventDeadline) throw failure('J2 entrega hold.expired', 200, seen === 'firma' ? 'BAD_SIGNATURE' : 'EVENT_NOT_RECEIVED');
      process.stdout.write('...  J2 esperando la entrega de hold.expired\n');
      await sleep(pollSeconds * 1000);
      await call('J2 mantener Gateway', 'GET', holdPath, 200, { token: partnerToken, report: false });
      seen = await receivedExpiry(target.body.holdId, secret);
    }
    process.stdout.write('OK   J2 hold.expired entregado con firma válida y data.holdId\n');
  } finally {
    await call('J2 webhook eliminado', 'DELETE', `/webhooks/${subscription.id}`, 204, { token: partnerToken, report: false }).catch(() => process.stderr.write('AVISO J2: no se pudo eliminar el webhook de prueba\n'));
  }
}

async function j5() {
  const sale = await choose('J5 búsqueda', { days: 14, accept: later, flightNumber: process.env.SMOKE_POSTSALE_FLIGHT_NUMBER });
  const purchased = await purchase('J5', sale, customerToken); const auth = { token: customerToken };
  const options = await call('J5 equipaje opciones', 'GET', `${purchased.path}/baggage-options`, 200, auth);
  if (!options.body.find((item) => item.passengerId === purchased.passengerId && item.itineraryId === sale.itinerary.itineraryId && item.maxAllowed > 0)) throw failure('J5 equipaje opciones', 200, 'NO_BAGGAGE_OPTION');
  await call('J5 equipaje', 'POST', `${purchased.path}/baggage`, 200, { ...auth, idempotent: true, body: { passengerId: purchased.passengerId, itineraryId: sale.itinerary.itineraryId, quantity: 1, payment: pay() } });
  const originalDate = sale.segment.departure.at.slice(0, 10); let selected;
  for (let day = 1; day <= 14 && !selected; day++) {
    const date = new Date(Date.parse(`${originalDate}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
    const changes = await call('J5 buscar cambio', 'POST', `${purchased.path}/date-change/search`, 200, { ...auth, report: false, body: { changes: [{ itineraryId: sale.itinerary.itineraryId, newDepartureDate: date }] } });
    selected = changes.body.find((item) => item.changeOfferId && Date.parse(item.expiresAt) > Date.now());
  }
  if (!selected) throw failure('J5 buscar cambio', 200, 'NO_CHANGE_OFFER');
  process.stdout.write('OK   J5 buscar cambio\n');
  await call('J5 cambio', 'POST', `${purchased.path}/date-change`, 200, { ...auth, idempotent: true, body: { changeOfferId: selected.changeOfferId, assignedSeats: [], payment: pay() } });
  const quote = await call('J5 cotización', 'GET', `${purchased.path}/cancellation-quote`, 200, auth);
  await call('J5 cancelación', 'POST', `${purchased.path}/cancel`, 200, { ...auth, idempotent: true, body: { quoteId: quote.body.quoteId } });
  const cancelled = await call('J5 detalle cancelado', 'GET', purchased.path, 200, auth); if (cancelled.body.status !== 'CANCELLED') throw failure('J5 detalle cancelado', 200, `STATUS_${cancelled.body.status}`);
}

async function j6() {
  const day = await choose('J6 búsqueda', { days: 2, accept: window, flightNumber: process.env.SMOKE_CHECKIN_FLIGHT_NUMBER });
  const map = await call('J6 mapa', 'GET', `/offers/${encodeURIComponent(day.offer.offerId)}/seatmap?segmentId=${encodeURIComponent(day.segment.segmentId)}`, 200);
  const seat = map.body.cabins?.find((item) => item.cabinClass === day.option.cabinClass)?.rows?.flatMap((row) => row.seats || []).find((item) => item.isAvailable)?.seatNumber;
  if (!seat) throw failure('J6 mapa', 200, 'NO_AVAILABLE_SEAT');
  const booking = await purchase('J6', day, customerToken, seat); const auth = { token: customerToken };
  const checkIn = await call('J6 check-in', 'POST', `${booking.path}/check-in`, 200, auth);
  if (!checkIn.body.checkedInPassengers?.some((item) => item.passengerId === booking.passengerId && item.status === 'CHECKED_IN')) throw failure('J6 check-in', 200, 'NOT_CHECKED_IN');
  const passes = await call('J6 pases', 'GET', `${booking.path}/boarding-passes`, 200, auth);
  if (!passes.body.boardingPasses?.some((item) => item.passengerId === booking.passengerId && item.segmentId === day.segment.segmentId && item.seat === seat && item.barcode)) throw failure('J6 pases', 200, 'NO_BOARDING_PASS');
}

async function j7() {
  const ghost = randomUUID();
  await call('J7 sin token (reservas)', 'GET', '/bookings', 401);
  await call('J7 sin token (hold)', 'POST', '/offers/hold', 401, { idempotent: true, body: { offerId: ghost, itinerarySelections: [{ itineraryId: ghost, cabinClass: 'ECONOMY', fareBrand: 'BASIC' }], passengersBreakdown: { adults: 1 } } });
  await call('J7 sin token (webhooks)', 'GET', '/webhooks', 401);
  await call('J7 sin token (admin)', 'GET', '/admin/flights', 401);
  await call('J7 customer sin rol para webhooks', 'GET', '/webhooks', 403, { token: customerToken });
  await call('J7 customer sin rol admin', 'GET', '/admin/flights', 403, { token: customerToken });
  const booking = await ensureBooking();
  const foreign = await call('J7 recurso ajeno', 'GET', booking.path, 404, { token: adminToken });
  const missing = await call('J7 recurso inexistente', 'GET', `/bookings/${ghost}`, 404, { token: adminToken, report: false });
  if (foreign.body.code !== missing.body.code || foreign.body.detail !== missing.body.detail) throw failure('J7 recurso ajeno', 404, 'DISTINGUISHABLE_FROM_MISSING');
  const own = await call('J7 recurso propio', 'GET', booking.path, 200, { token: customerToken }); if (own.body.bookingId !== booking.bookingId) throw failure('J7 recurso propio', 200, 'BOOKING_MISMATCH');
  const fingerprint = randomUUID(); const searchBody = { itineraries: [{ origin, destination, departureDate: dayOffset(1) }], passengers: { adults: 1 } };
  let limited;
  for (let attempt = 0; attempt < number('SMOKE_RATE_LIMIT_MAX', 150) && !limited; attempt++) {
    const response = await globalThis.fetch(`${base}/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-fingerprint': fingerprint }, body: JSON.stringify(searchBody) }).catch(() => undefined);
    if (response?.status === 429) limited = response;
  }
  if (!limited) throw failure('J7 429 en /search', 200, 'LIMIT_NOT_REACHED');
  if (!(Number(limited.headers.get('retry-after')) > 0) || (await limited.json().catch(() => ({}))).code !== 'RATE_LIMIT_EXCEEDED') throw failure('J7 429 en /search', 429, 'BAD_RATE_LIMIT_RESPONSE');
  process.stdout.write('OK   J7 429 en /search con Retry-After\n');
  const blocked = await globalThis.fetch(`${base}/health`, { headers: { origin: 'https://origen-no-permitido.invalid' } });
  if ([...blocked.headers.keys()].some((name) => name.startsWith('access-control-'))) throw failure('J7 CORS origen no permitido', blocked.status, 'CORS_HEADERS_PRESENT');
  process.stdout.write('OK   J7 CORS origen no permitido\n');
  if (process.env.SMOKE_CORS_ALLOWED_ORIGIN) {
    const allowed = await globalThis.fetch(`${base}/health`, { headers: { origin: process.env.SMOKE_CORS_ALLOWED_ORIGIN } });
    if (allowed.headers.get('access-control-allow-origin') !== process.env.SMOKE_CORS_ALLOWED_ORIGIN) throw failure('J7 CORS origen permitido', allowed.status, 'CORS_HEADER_MISSING');
    process.stdout.write('OK   J7 CORS origen permitido\n');
  } else process.stdout.write('INFO J7 sin SMOKE_CORS_ALLOWED_ORIGIN no se comprobó un origen permitido\n');
}

const journeys = { J1: j1, J2: j2, J5: j5, J6: j6, J7: j7 };
async function main() {
  const unknown = requested.filter((name) => !journeys[name]);
  if (unknown.length) throw new Error(`SMOKE_JOURNEYS: recorrido desconocido ${unknown.join(', ')} (J3 y J4 no se ejecutan contra Render)`);
  await warmup();
  const results = {};
  for (const name of requested) {
    try { await journeys[name](); results[name] = 'OK'; process.stdout.write(`==== ${name} OK\n`); }
    catch (error) {
      if (error.skipped) { results[name] = 'OMITIDO'; process.stdout.write(`==== ${name} OMITIDO: ${error.skipped}\n`); }
      else { results[name] = 'FALLO'; process.stdout.write(`==== ${name} FALLO\n`); process.stderr.write(`${name}: ${error.message}\n`); }
    }
  }
  process.stdout.write('NOTA J3 (pago pendiente) y J4 (emisión fallida) no se ejecutan contra Render: necesitan controles de prueba que no existen en producción; los cubre la suite real local (ADR-F11-17).\n');
  process.stdout.write(`RESUMEN ${Object.entries(results).map(([name, result]) => `${name}=${result}`).join(' ')}\n`);
  const values = Object.values(results);
  process.exitCode = values.includes('FALLO') ? 1 : values.includes('OMITIDO') ? 2 : 0;
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
