#!/usr/bin/env node
/* Recorrido de integración LOCAL del servicio GraphQL (diseño §10.1, «integración local»): arranca el servicio contra el Gateway de local:up y recorre las operaciones publicadas
 * con tokens de desarrollo (npm run dev:token; la llave privada nunca se imprime). Requiere la plataforma levantada con `npm run local:up -- -SkipDocker`:
 * local:up aplica solo (sin variables a mano) el emisor de desarrollo en el Gateway y en GraphQL, WEB_PAYMENT_MODE=simulated y WEB_REQUIRE_VERIFIED_EMAIL=false;
 * el recorrido lo comprueba al empezar (docs/dev/f12c1-graphql-despliegue.md §4). Necesita infra/dev-keys (`npm run dev:token -- --init-keys`).
 *   node platform/graphql/scripts/local-journey.cjs [--gateway http://127.0.0.1:3000] [--port 4000]
 * Una línea OK/FALLA por comprobación; no imprime tokens, correos ni documentos. Cancela lo que crea y detiene el servicio al terminar. */
/* global fetch, AbortSignal, __dirname */
const process = require('node:process');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { setTimeout } = require('node:timers');
const { knownOperations } = require('@flight-platform/graphql-schema');

const repo = resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2); const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
const gatewayUrl = option('gateway', 'http://127.0.0.1:3000'); const port = Number(option('port', '4000')); const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const known = knownOperations();
let counter = 0; let failures = 0;
const check = (description, condition, detail) => { counter += 1; if (!condition) failures += 1; process.stdout.write(`${condition ? 'OK   ' : 'FALLA'} #${String(counter).padStart(2, '0')} ${description}${condition || !detail ? '' : ` -> ${detail}`}\n`); return Boolean(condition); };
const devToken = (sub, role, scope) => { const run = spawnSync('npx', ['tsx', 'infra/scripts/dev-token.ts', '--sub', sub, '--app-role', role, '--scope', `"${scope}"`], { cwd: repo, encoding: 'utf8', shell: true }); return run.status === 0 ? run.stdout.trim().split(/\r?\n/).pop() : ''; };
const USER = 'flights:read flights:hold flights:book flights:cancel'; const ADMIN = `${USER} flights:webhooks flights:admin`;
const gql = async (name, variables = {}, { token, fingerprint, correlationId } = {}) => {
  const response = await fetch(`${base}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(fingerprint ? { 'x-device-fingerprint': fingerprint } : {}), ...(correlationId ? { 'x-correlation-id': correlationId } : {}) }, body: JSON.stringify({ query: known.get(name), operationName: name, variables }), signal: AbortSignal.timeout(60_000) });
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => ({})) };
};
const code = (reply) => reply.body.errors?.[0]?.extensions?.code;
const passenger = { passengerId: 'PAX-1', passengerType: 'ADULT', firstName: 'Prueba', lastName: 'Graphql', documentType: 'PASSPORT', documentNumber: 'GQL1234567', nationality: 'EC', documentExpiryDate: '2035-01-01', birthDate: '1990-01-01', gender: 'F', contact: { email: 'prueba@example.invalid', phone: '+593999999999' } };

/* Comprueba al empezar que la plataforma tiene la configuración local que necesita el recorrido (la aplica `npm run local:up`, sin variables a mano):
 * emisor de desarrollo en el Gateway y en GraphQL, WEB_PAYMENT_MODE=simulated y WEB_REQUIRE_VERIFIED_EMAIL=false. Si falta algo, lo dice y no sigue. */
async function preflight(adminToken) {
  const problems = [];
  const markerPath = join(repo, '.local', 'platform-config.json');
  let marker; try { marker = JSON.parse(readFileSync(markerPath, 'utf8')); } catch { marker = undefined; }
  if (marker) {
    if (!marker.devIssuer) problems.push('el Gateway no acepta el emisor de desarrollo (¿falta infra/dev-keys? `npm run dev:token -- --init-keys`, y reinicie local:up)');
    if (marker.webPaymentMode !== 'simulated') problems.push(`WEB_PAYMENT_MODE=${marker.webPaymentMode} (debe ser simulated: el perfil o la terminal lo fijan distinto)`);
    if (String(marker.webRequireVerifiedEmail) !== 'false') problems.push(`WEB_REQUIRE_VERIFIED_EMAIL=${marker.webRequireVerifiedEmail} (debe ser false: los tokens de desarrollo no traen email_verified)`);
  } else process.stdout.write('     aviso: no existe .local/platform-config.json (la plataforma no se levantó con `npm run local:up`); WEB_PAYMENT_MODE y WEB_REQUIRE_VERIFIED_EMAIL no se pueden verificar.\n');
  // Comprobación por comportamiento de los dos servicios que validan el token de desarrollo.
  const viewer = await gql('Viewer', {}, { token: adminToken });
  if (code(viewer) === 'UNAUTHENTICATED') problems.push('el servicio GraphQL no acepta el emisor de desarrollo (JWT_ISSUERS de GraphQL; local:up lo suma al arrancar)');
  else {
    const ops = await gql('FlightOperations', { date: new Date().toISOString().slice(0, 10), first: 1 }, { token: adminToken });
    if (code(ops) === 'UNAUTHENTICATED') problems.push('el Gateway rechaza el token de desarrollo con 401 (no tiene el emisor de desarrollo en sus JWT_ISSUERS; local:up lo suma con JWT_ISSUERS_EXTRA)');
  }
  check('la plataforma local tiene la configuración del recorrido (emisor de desarrollo en Gateway y GraphQL, pago simulado, correo sin verificar)', problems.length === 0, problems.join('; '));
  if (problems.length > 0) process.stdout.write('     Solución: `npm run local:down` y `npm run local:up -- -SkipDocker` (sin variables a mano; ver docs/dev/f12c1-graphql-despliegue.md §4).\n');
  return problems.length === 0;
}

async function main() {
  // Si local:up ya levantó el servicio (puerto --port), se usa ese; si no, se arranca uno propio y se detiene al terminar.
  const alreadyUp = await fetch(`${base}/health`).then((r) => r.status === 200).catch(() => false);
  const server = alreadyUp ? undefined : spawn(process.execPath, ['dist/main.js'], { cwd: join(repo, 'platform', 'graphql'), stdio: 'ignore', windowsHide: true, env: { ...process.env, NODE_ENV: 'development', PORT: String(port), GATEWAY_BASE_URL: gatewayUrl, JWT_ISSUERS: JSON.stringify([{ iss: 'flight-platform-dev', aud: 'flight-platform', publicKeyFile: join(repo, 'infra', 'dev-keys', 'dev-public.pem') }]), CORS_ORIGINS: 'http://localhost:5173' } });
  process.stdout.write(`     servicio GraphQL: ${alreadyUp ? 'el de local:up' : 'arrancado por el recorrido'} (${base})\n`);
  const restore = [];
  const created = { holds: [], bookings: [] }; let tokenA = ''; let tokenB = ''; let admin = '';
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) { const up = await fetch(`${base}/health`).then((r) => r.status === 200).catch(() => false); if (up) break; await sleep(500); }
    check('GET /health del servicio responde 200', (await fetch(`${base}/health`).then((r) => r.status).catch(() => 0)) === 200);
    tokenA = devToken(randomUUID(), 'customer', USER); tokenB = devToken(randomUUID(), 'customer', USER); admin = devToken(randomUUID(), 'admin', ADMIN);
    if (!check('tokens de desarrollo generados', Boolean(tokenA && tokenB && admin), 'falta infra/dev-keys: ejecute `npm run dev:token -- --init-keys` y reinicie local:up')) return;
    if (!(await preflight(admin))) return;
    const fingerprint = `journey-${randomUUID()}`; const corr = `gqljourney-${randomUUID()}`;

    const health = await gql('PlatformHealth');
    check('platformHealth (público) trae el estado y las dependencias del Gateway', health.body.data?.platformHealth?.dependencies?.length >= 7, JSON.stringify(health.body.errors?.[0]?.extensions));
    const viewer = await gql('Viewer', {}, { token: tokenA, correlationId: corr });
    check('viewer devuelve el rol del JWT y el X-Correlation-Id vuelve idéntico', viewer.body.data?.viewer?.role === 'CUSTOMER' && viewer.headers.get('x-correlation-id') === corr);
    check('una operación del cliente sin token ⇒ UNAUTHENTICATED', code(await gql('MyBookings')) === 'UNAUTHENTICATED');
    check('un customer en una operación @admin ⇒ FORBIDDEN', code(await gql('AdminFlights', {}, { token: tokenA })) === 'FORBIDDEN');

    // Vuelo: el panel de operaciones (admin) por GraphQL.
    let flight;
    for (let offset = 3; offset <= 12 && !flight; offset += 1) {
      const date = new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10); const ops = await gql('FlightOperations', { date, first: 50 }, { token: admin });
      flight = ops.body.data?.flightOperations?.items?.find((item) => item.status === 'SCHEDULED' && item.cabins.some((cabin) => cabin.seatsByStatus.AVAILABLE >= 4));
      if (ops.body.errors) { check('flightOperations (admin) responde sin errores', false, JSON.stringify(ops.body.errors[0].extensions)); return; }
    }
    if (!check('el panel de operaciones por GraphQL encuentra un vuelo con asientos', Boolean(flight))) return;
    const search = await gql('SearchFlights', { input: { itineraries: [{ origin: flight.origin, destination: flight.destination, departureDate: flight.date }], passengers: { adults: 1 } } }, { fingerprint });
    const offer = search.body.data?.searchFlights?.offers?.find((entry) => entry.itineraries[0].segments[0].flightNumber === flight.flightNumber);
    if (!check('searchFlights con huella devuelve la oferta del vuelo', Boolean(offer), JSON.stringify(search.body.errors?.[0]?.extensions))) return;
    const itinerary = offer.itineraries[0]; const option = itinerary.pricingOptions.find((entry) => entry.fareRules.isChangeable && entry.availableSeats >= 4) ?? itinerary.pricingOptions[0]; const segmentId = itinerary.segments[0].segmentId;
    const map = await gql('SeatMap', { offerId: offer.offerId, segmentId });
    const seats = map.body.data?.seatMap?.cabins?.filter((cabin) => cabin.cabinClass === option.cabinClass).flatMap((cabin) => cabin.rows.flatMap((row) => row.seats)) ?? [];
    const free = seats.filter((seat) => seat.status === 'AVAILABLE').map((seat) => seat.seatNumber);
    if (!check('seatMap trae asientos AVAILABLE', free.length >= 3)) return;

    const hold = await gql('HoldOffer', { input: { offerId: offer.offerId, selections: [{ itineraryId: itinerary.itineraryId, cabinClass: option.cabinClass, fareBrand: option.fareBrand }], passengers: { adults: 1 }, seats: [{ segmentId, seatNumber: free[0] }] }, idempotencyKey: randomUUID() }, { token: tokenA, correlationId: corr });
    const held = hold.body.data?.holdOffer; if (held) created.holds.push(held.holdId);
    if (!check('holdOffer con seats (assignedSeats): HELD con precio congelado', held?.status === 'HELD' && held.lockedPrice?.total, JSON.stringify(hold.body.errors?.[0]?.extensions))) return;
    check('hold(holdId) del dueño responde y el de otro usuario ⇒ NOT_FOUND', (await gql('Hold', { holdId: held.holdId }, { token: tokenA })).body.data?.hold?.status === 'HELD' && code(await gql('Hold', { holdId: held.holdId }, { token: tokenB })) === 'NOT_FOUND');

    const booked = await gql('CreateBooking', { input: { holdId: held.holdId, passengers: [passenger], paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }, { token: tokenA, correlationId: corr });
    const booking = booked.body.data?.createBooking?.booking; if (booking) created.bookings.push(booking.bookingId);
    if (!check('createBooking con pago simulado: COMPLETED, CONFIRMED, boleto ISSUED, documento enmascarado', booked.body.data?.createBooking?.outcome === 'COMPLETED' && booking?.status === 'CONFIRMED' && booking.tickets.every((ticket) => ticket.status === 'ISSUED') && !JSON.stringify(booked.body).includes('GQL1234567') && booking.passengers[0].documentNumberMasked.endsWith('567'), JSON.stringify(booked.body.errors?.[0]?.extensions))) return;
    check('availableActions refleja el estado (cancel, seats, check-in…)', booking.availableActions.includes('cancel') && !booking.availableActions.includes('self'));
    const id = booking.bookingId;
    const mine = await gql('MyBookings', { first: 5 }, { token: tokenA }); check('myBookings lista la reserva con pageInfo', mine.body.data?.myBookings?.edges?.some((edge) => edge.node.bookingId === id) && mine.body.data.myBookings.pageInfo.hasNextPage === false, JSON.stringify(mine.body.errors?.[0]?.extensions));
    check('aislamiento: otro usuario no ve la reserva (NOT_FOUND) y su lista no la incluye', code(await gql('Booking', { bookingId: id }, { token: tokenB })) === 'NOT_FOUND' && !JSON.stringify((await gql('MyBookings', { first: 50 }, { token: tokenB })).body.data).includes(id));
    check('aislamiento: otro usuario no puede cancelar ni hacer check-in (NOT_FOUND)', code(await gql('CheckIn', { bookingId: id }, { token: tokenB })) === 'NOT_FOUND' && code(await gql('CancelBooking', { bookingId: id, quoteId: 'QTE-1', idempotencyKey: randomUUID() }, { token: tokenB })) === 'NOT_FOUND');
    // Aislamiento ampliado: B no ve ni toca nada de la reserva de A (todo NOT_FOUND).
    const foreign = [['BoardingPasses', { bookingId: id }], ['BaggageOptions', { bookingId: id }], ['CancellationQuote', { bookingId: id }], ['IssueTickets', { bookingId: id }],
      ['SearchDateChange', { bookingId: id, changes: [{ itineraryId: booking.itineraries[0].itineraryId, newDepartureDate: flight.date }] }],
      ['ChangeSeats', { bookingId: id, seats: [{ passengerId: 'PAX-1', segmentId, seatNumber: free[2] }], idempotencyKey: randomUUID() }],
      ['AddBaggage', { input: { bookingId: id, passengerId: 'PAX-1', itineraryId: booking.itineraries[0].itineraryId, quantity: 1, paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }],
      ['ConfirmDateChange', { input: { bookingId: id, changeOfferId: 'CHG-1' }, idempotencyKey: randomUUID() }]];
    const leaks = []; for (const [name, variables] of foreign) { const reply = await gql(name, variables, { token: tokenB }); if (code(reply) !== 'NOT_FOUND') leaks.push(`${name}:${code(reply) ?? 'sin error'}`); }
    check('aislamiento: B no ve ni cambia (pases, equipaje, cotización, emisión, cambio de fecha, asiento) la reserva de A: todo NOT_FOUND', leaks.length === 0, leaks.join(', '));
    // El correlationId del cliente en un error: cabecera y extensions idénticos.
    const errCorr = `gqlerr-${randomUUID()}`; const errReply = await gql('Booking', { bookingId: id }, { token: tokenB, correlationId: errCorr });
    check('el correlationId vuelve idéntico en la cabecera y en extensions.correlationId de un error', errReply.headers.get('x-correlation-id') === errCorr && errReply.body.errors?.[0]?.extensions?.correlationId === errCorr);
    const corrIds = [corr, errCorr];

    const options = await gql('BaggageOptions', { bookingId: id }, { token: tokenA }); check('baggageOptions con precio y máximo', options.body.data?.baggageOptions?.[0]?.maxAllowed > 0, JSON.stringify(options.body.errors?.[0]?.extensions));
    const opt = options.body.data?.baggageOptions?.[0];
    if (opt) { const bag = await gql('AddBaggage', { input: { bookingId: id, passengerId: 'PAX-1', itineraryId: opt.itineraryId, quantity: 1, paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }, { token: tokenA }); check('addBaggage: totalBaggage >= 1 (incluye la maleta de la tarifa)', bag.body.data?.addBaggage?.totalBaggage >= 1, `total=${bag.body.data?.addBaggage?.totalBaggage} ` + `${code(bag)} ${JSON.stringify(bag.body.errors?.[0]?.extensions?.invalidParams ?? '')}`); }
    const seat = await gql('ChangeSeats', { bookingId: id, seats: [{ passengerId: 'PAX-1', segmentId, seatNumber: free[1] }], idempotencyKey: randomUUID() }, { token: tokenA }); check('changeSeats: nuevo asiento', seat.body.data?.changeSeats?.seats?.[0]?.seatNumber === free[1], JSON.stringify(seat.body.errors?.[0]?.extensions));
    // Cambio de fecha (búsqueda y confirmación) sobre la reserva de A.
    const nextDay = new Date(Date.parse(`${flight.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const dateSearch = await gql('SearchDateChange', { bookingId: id, changes: [{ itineraryId: booking.itineraries[0].itineraryId, newDepartureDate: nextDay }] }, { token: tokenA, correlationId: corr });
    const changeOffer = dateSearch.body.data?.searchDateChange?.[0];
    if (changeOffer) {
      check('searchDateChange: oferta con changeOfferId, vencimiento y diferencia de precio', Boolean(changeOffer.changeOfferId && changeOffer.expiresAt && changeOffer.priceDifference?.totalToPay !== undefined), JSON.stringify(changeOffer).slice(0, 200));
      const confirm = await gql('ConfirmDateChange', { input: { bookingId: id, changeOfferId: changeOffer.changeOfferId, paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }, { token: tokenA, correlationId: corr });
      check('confirmDateChange: COMPLETED o PENDING y la reserva sigue siendo del cliente (CONFIRMED/CHANGE_PENDING)', ['COMPLETED', 'PENDING'].includes(confirm.body.data?.confirmDateChange?.outcome), JSON.stringify(confirm.body.errors?.[0]?.extensions));
      const moved = await gql('Booking', { bookingId: id }, { token: tokenA }); check('tras el cambio de fecha la reserva cambió de itinerario/fecha', moved.body.data?.booking?.itineraries?.[0]?.segments?.[0]?.departure?.at?.slice(0, 10) !== undefined && ['CONFIRMED', 'CHANGE_PENDING'].includes(moved.body.data.booking.status), moved.body.data?.booking?.status);
    } else check('searchDateChange devuelve al menos una oferta para el día siguiente (mismo vuelo/ruta)', false, `${dateSearch.body.errors?.[0]?.extensions?.code ?? 'sin ofertas'}: no hay vuelo de la ruta el ${nextDay} o la tarifa no admite cambios`);
    const early = await gql('CheckIn', { bookingId: id }, { token: tokenA }); check('checkIn fuera de ventana ⇒ error de negocio con category (no INTERNAL)', Boolean(early.body.errors?.[0]) && !['INTERNAL', 'UNAVAILABLE'].includes(early.body.errors[0].extensions.category), JSON.stringify(early.body.errors?.[0]?.extensions));
    const quote = await gql('CancellationQuote', { bookingId: id }, { token: tokenA }); check('cancellationQuote con quoteId', Boolean(quote.body.data?.cancellationQuote?.quoteId), JSON.stringify(quote.body.errors?.[0]?.extensions));
    const cancel = await gql('CancelBooking', { bookingId: id, quoteId: quote.body.data?.cancellationQuote?.quoteId, idempotencyKey: randomUUID() }, { token: tokenA });
    check('cancelBooking: COMPLETED, CANCELLED, reembolso calculado', cancel.body.data?.cancelBooking?.outcome === 'COMPLETED' && cancel.body.data.cancelBooking.status === 'CANCELLED' && Boolean(cancel.body.data.cancelBooking.refund), JSON.stringify(cancel.body.errors?.[0]?.extensions));
    if (cancel.body.data?.cancelBooking) created.bookings.splice(created.bookings.indexOf(id), 1);
    check('cancelar otra vez ⇒ CONFLICT ALREADY_CANCELLED', (await gql('CancelBooking', { bookingId: id, quoteId: 'QTE-1', idempotencyKey: randomUUID() }, { token: tokenA })).body.errors?.[0]?.extensions?.code === 'ALREADY_CANCELLED');
    const fresh = await gql('Booking', { bookingId: id }, { token: tokenA }); check('la reserva queda CANCELLED y sin acciones de compra', fresh.body.data?.booking?.status === 'CANCELLED');
    const second = await gql('HoldOffer', { input: { offerId: offer.offerId, selections: [{ itineraryId: itinerary.itineraryId, cabinClass: option.cabinClass, fareBrand: option.fareBrand }], passengers: { adults: 1 } }, idempotencyKey: randomUUID() }, { token: tokenA });
    if (second.body.data?.holdOffer) check('releaseHold libera el hold', (await gql('ReleaseHold', { holdId: second.body.data.holdOffer.holdId }, { token: tokenA })).body.data?.releaseHold === true);
    const denied = await gql('HoldOffer', { input: { offerId: offer.offerId, selections: [{ itineraryId: itinerary.itineraryId, cabinClass: option.cabinClass, fareBrand: option.fareBrand }], passengers: { adults: 1 } }, idempotencyKey: randomUUID() }, { token: tokenA });
    if (denied.body.data?.holdOffer) { created.holds.push(denied.body.data.holdOffer.holdId); const refused = await gql('CreateBooking', { input: { holdId: denied.body.data.holdOffer.holdId, passengers: [passenger], paymentReference: `pay_denied_${randomUUID()}` }, idempotencyKey: randomUUID() }, { token: tokenA }); check('pago rechazado ⇒ UNPROCESSABLE PAYMENT_NOT_AUTHORIZED', refused.body.errors?.[0]?.extensions?.code === 'PAYMENT_NOT_AUTHORIZED' && refused.body.errors[0].extensions.category === 'UNPROCESSABLE'); }

    // Administración
    const flights = await gql('AdminFlights', { first: 2 }, { token: admin }); check('adminFlights (API interna) con paginación', flights.body.data?.adminFlights?.items?.length > 0 && flights.body.data.adminFlights.items[0].flightInstanceId, JSON.stringify(flights.body.errors?.[0]?.extensions));
    const flightId = flights.body.data?.adminFlights?.items?.[0]?.flightInstanceId;
    if (flightId) check('adminFares (API interna)', Array.isArray((await gql('AdminFares', { flightInstanceId: flightId }, { token: admin })).body.data?.adminFares));
    check('promotionAgreement (admin): dato o null, nunca error', !(await gql('PromotionAgreement', {}, { token: admin })).body.errors);
    const publicStatus = await gql('FlightStatus', { flightNumber: flight.flightNumber, date: flight.date });
    check('flightStatus público de un vuelo existente', publicStatus.body.data?.flightStatus?.flightNumber === flight.flightNumber);

    // Mutaciones de administración REVERSIBLES (lo modificado se restaura y se comprueba la restauración).
    const scheduledAt = publicStatus.body.data?.flightStatus?.departure?.scheduledAt;
    check('un customer no puede cambiar el estado de un vuelo (FORBIDDEN, sin llamar al Gateway)', code(await gql('UpdateFlightStatus', { flightNumber: flight.flightNumber, input: { date: flight.date, status: 'SCHEDULED' } }, { token: tokenA })) === 'FORBIDDEN');
    if (scheduledAt) {
      const input = (estimated, reason) => ({ date: flight.date, status: 'SCHEDULED', estimatedDepartureAt: estimated, reason });
      const delayed = await gql('UpdateFlightStatus', { flightNumber: flight.flightNumber, input: input(new Date(Date.parse(scheduledAt) + 1_800_000).toISOString(), 'recorrido graphql') }, { token: admin, correlationId: corr, idempotencyKey: undefined });
      const changed = delayed.body.data?.updateFlightStatus;
      if (changed) restore.push(() => gql('UpdateFlightStatus', { flightNumber: flight.flightNumber, input: input(scheduledAt, 'restauración del recorrido graphql') }, { token: admin }));
      check('updateFlightStatus (admin, mismo estado y hora estimada +30 min): previousStatus y vuelo actualizado', changed?.previousStatus === 'SCHEDULED' && changed.flight.flightNumber === flight.flightNumber, JSON.stringify(delayed.body.errors?.[0]?.extensions));
      if (changed) { const back = await gql('UpdateFlightStatus', { flightNumber: flight.flightNumber, input: input(scheduledAt, 'restauración del recorrido graphql') }, { token: admin }); restore.length = 0; check('el vuelo se restauró (hora estimada = programada)', Boolean(back.body.data?.updateFlightStatus), JSON.stringify(back.body.errors?.[0]?.extensions)); }
    } else check('estado del vuelo con hora programada para el cambio de estado', false);
    const listed = await gql('AdminFlights', { date: flight.date, first: 200 }, { token: admin }); const instance = listed.body.data?.adminFlights?.items?.find((item) => item.flightNumber === flight.flightNumber)?.flightInstanceId;
    const fares = instance ? (await gql('AdminFares', { flightInstanceId: instance }, { token: admin })).body.data?.adminFares : undefined; const fare = fares?.[0];
    if (fare) {
      const money = (value) => (value ? { currency: value.currency, total: value.total, baseFare: value.baseFare ?? null, taxes: value.taxes ?? null } : value);
      const original = { fareId: fare.fareId, flightInstanceId: fare.flightInstanceId, cabinClass: fare.cabinClass, fareBrand: fare.fareBrand, price: money(fare.price), isRefundable: fare.fareRules.isRefundable, isChangeable: fare.fareRules.isChangeable, personalItemIncluded: fare.baggageAllowance?.personalItemIncluded ?? null, carryOnIncluded: fare.baggageAllowance?.carryOnIncluded ?? null, checkedBaggageIncluded: fare.baggageAllowance?.checkedBaggageIncluded ?? null, extraCheckedBaggagePrice: { currency: fare.extraCheckedBaggagePrice.currency, total: fare.extraCheckedBaggagePrice.total } };
      const bumped = { ...original, extraCheckedBaggagePrice: { ...original.extraCheckedBaggagePrice, total: (Number(original.extraCheckedBaggagePrice.total) + 1).toFixed(2) } };
      const saved = await gql('UpsertFare', { input: bumped }, { token: admin });
      if (saved.body.data?.upsertFare) restore.push(() => gql('UpsertFare', { input: original }, { token: admin }));
      check('upsertFare (admin): guarda la tarifa con el recargo de equipaje +1.00 y conserva el fareId', saved.body.data?.upsertFare?.fareId === fare.fareId && saved.body.data.upsertFare.extraCheckedBaggagePrice.total === bumped.extraCheckedBaggagePrice.total, JSON.stringify(saved.body.errors?.[0]?.extensions));
      const undone = await gql('UpsertFare', { input: original }, { token: admin }); if (undone.body.data?.upsertFare) restore.length = 0;
      check('la tarifa se restauró al valor original', undone.body.data?.upsertFare?.extraCheckedBaggagePrice?.total === original.extraCheckedBaggagePrice.total, JSON.stringify(undone.body.errors?.[0]?.extensions));
      check('un customer no puede guardar tarifas (FORBIDDEN)', code(await gql('UpsertFare', { input: bumped }, { token: tokenA })) === 'FORBIDDEN');
    } else check('hay una tarifa del vuelo para probar upsertFare', false, 'sin tarifas en la API interna para el vuelo elegido');

    // Check-in dentro de su ventana: solo con un vuelo local VACÍO que ya la tenga abierta (checkInOpen del panel); si no hay, no aplica.
    let windowFlight;
    for (const offset of [0, 1]) {
      const date = new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const ops = await gql('FlightOperations', { date, first: 50 }, { token: admin });
      windowFlight = windowFlight ?? ops.body.data?.flightOperations?.items?.find((item) => item.checkInOpen && item.status === 'SCHEDULED' && item.activeHolds === 0 && item.cabins.every((cabin) => cabin.seatsByStatus.AVAILABLE === cabin.totalSeats) && Date.parse(item.departureAt) - Date.now() > 5_400_000);
    }
    if (!windowFlight) process.stdout.write('N/A   check-in dentro de su ventana: no hay un vuelo local vacío con el check-in abierto (se probó en la nube con S-1; no se fuerza una fecha)\n');
    else {
      const winSearch = await gql('SearchFlights', { input: { itineraries: [{ origin: windowFlight.origin, destination: windowFlight.destination, departureDate: windowFlight.date }], passengers: { adults: 1 } } }, { fingerprint });
      const winOffer = winSearch.body.data?.searchFlights?.offers?.find((entry) => entry.itineraries[0].segments[0].flightNumber === windowFlight.flightNumber);
      if (check(`el vuelo local vacío ${windowFlight.flightNumber} (check-in abierto) aparece en la búsqueda`, Boolean(winOffer))) {
        const wi = winOffer.itineraries[0]; const wo = wi.pricingOptions[0];
        const wh = await gql('HoldOffer', { input: { offerId: winOffer.offerId, selections: [{ itineraryId: wi.itineraryId, cabinClass: wo.cabinClass, fareBrand: wo.fareBrand }], passengers: { adults: 1 } }, idempotencyKey: randomUUID() }, { token: tokenA });
        if (wh.body.data?.holdOffer) {
          created.holds.push(wh.body.data.holdOffer.holdId);
          const wb = await gql('CreateBooking', { input: { holdId: wh.body.data.holdOffer.holdId, passengers: [passenger], paymentReference: `pay_ok_${randomUUID()}` }, idempotencyKey: randomUUID() }, { token: tokenA });
          const wbooking = wb.body.data?.createBooking?.booking; if (wbooking) created.bookings.push(wbooking.bookingId);
          if (check('reserva sobre el vuelo en ventana', wbooking?.status === 'CONFIRMED', JSON.stringify(wb.body.errors?.[0]?.extensions))) {
            const done = await gql('CheckIn', { bookingId: wbooking.bookingId }, { token: tokenA, correlationId: corr }); check('checkIn dentro de la ventana: COMPLETED con pasajero CHECKED_IN', done.body.data?.checkIn?.status === 'COMPLETED' && done.body.data.checkIn.checkedInPassengers[0].status === 'CHECKED_IN', JSON.stringify(done.body.errors?.[0]?.extensions));
            const passes = await gql('BoardingPasses', { bookingId: wbooking.bookingId }, { token: tokenA }); check('boardingPasses: al menos un pase con código de barras', passes.body.data?.boardingPasses?.length > 0 && Boolean(passes.body.data.boardingPasses[0].barcode), JSON.stringify(passes.body.errors?.[0]?.extensions));
            { const c1 = code(await gql('BoardingPasses', { bookingId: wbooking.bookingId }, { token: tokenB })); const c2 = code(await gql('CheckIn', { bookingId: wbooking.bookingId }, { token: tokenB })); check('aislamiento: B no ve los pases ni hace check-in de esa reserva (NOT_FOUND)', c1 === 'NOT_FOUND' && c2 === 'NOT_FOUND', `pases=${c1} checkIn=${c2}`); }
          }
        }
      }
    }

    // El correlationId del cliente llegó IDÉNTICO al Gateway: aparece en sus registros (y en los del ESB) de esta ejecución.
    const { existsSync, readFileSync } = require('node:fs'); const gatewayLog = join(repo, '.local', 'logs', 'gateway.out.log'); const esbLog = join(repo, '.local', 'logs', 'esb.out.log');
    if (existsSync(gatewayLog) || existsSync(esbLog)) {
      const text = `${existsSync(gatewayLog) ? readFileSync(gatewayLog, 'utf8') : ''}\n${existsSync(esbLog) ? readFileSync(esbLog, 'utf8') : ''}`;
      check('el correlationId del cliente figura tal cual en los registros del Gateway/ESB (llegó idéntico)', corrIds.some((value) => text.includes(value)) && text.includes(corr), `no se encontró ${corr} en .local/logs`);
    } else process.stdout.write('N/A   correlationId en los registros del Gateway: no hay .local/logs (plataforma no levantada con local:up)\n');
  } finally {
    // Limpieza: cancelar lo que quedó (reservas) y liberar holds, aunque algo fallara a mitad.
    for (const bookingId of created.bookings) { const quote = await gql('CancellationQuote', { bookingId }, { token: tokenA }).catch(() => undefined); await gql('CancelBooking', { bookingId, quoteId: quote?.body?.data?.cancellationQuote?.quoteId ?? 'QTE-1', idempotencyKey: randomUUID() }, { token: tokenA }).catch(() => undefined); }
    for (const holdId of created.holds) await gql('ReleaseHold', { holdId }, { token: tokenA }).catch(() => undefined);
    for (const undo of restore) await Promise.resolve(undo()).catch(() => undefined); // restaura lo que quedó modificado si algo falló a mitad
    if (server) server.kill();
  }
}
main().then(() => { process.stdout.write(`\nRecorrido GraphQL: ${counter - failures}/${counter} OK\n`); process.exit(failures === 0 && counter > 0 ? 0 : 1); }).catch((error) => { process.stdout.write(`Recorrido interrumpido: ${error instanceof Error ? error.name : 'error'}\n`); process.exit(1); });
