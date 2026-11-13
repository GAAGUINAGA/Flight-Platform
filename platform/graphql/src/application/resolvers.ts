import { randomUUID } from 'node:crypto';
import { fromGatewayFailure, validationError } from '../domain/errors';
import { maskDocument } from '../domain/privacy';
import type { GatewayRequest, GatewayResponse, RequestContext } from './ports';
import * as v from './validation';

type Json = Record<string, unknown>;
type Args = Record<string, unknown>;
const V2 = '/api/v2/vuelos';
const ADMIN_API = '/api/admin/v1';

interface CallOptions { auth?: boolean; idempotencyKey?: string; accept?: readonly number[] }
/**
 * Llamada al Gateway con los encabezados que viajan (diseño §6.5): Authorization (solo un token válido), X-Correlation-Id idéntico al entrante,
 * X-Request-Id nuevo por salto, X-Device-Fingerprint e Idempotency-Key. NUNCA se envían `X-User-Id`, `paymentChannel` ni `provider`: los decide el Gateway.
 * Un estado de error (o fuera de `accept`) se traduce a un error público; el cuerpo del Gateway no se reenvía.
 */
async function call(ctx: RequestContext, request: Omit<GatewayRequest, 'headers'>, options: CallOptions = {}): Promise<GatewayResponse> {
  ctx.gatewayCalls += 1;
  const response = await ctx.gateway.send({
    ...request,
    headers: { 'X-Correlation-Id': ctx.correlationId, 'X-Request-Id': randomUUID(), ...(options.auth && ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}), ...(ctx.fingerprint ? { 'X-Device-Fingerprint': ctx.fingerprint } : {}), ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}) }
  });
  const accepted = options.accept ? options.accept.includes(response.status) : response.status < 400;
  if (!accepted || (response.invalidBody && response.status < 400 && response.status !== 204)) throw fromGatewayFailure({ status: response.status < 400 ? 502 : response.status, body: response.body, retryAfter: response.retryAfter, invalidBody: response.invalidBody });
  return response;
}
const asJson = (value: unknown): Json => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : {});
const asList = (value: unknown): Json[] => (Array.isArray(value) ? value.filter((entry) => typeof entry === 'object' && entry !== null) as Json[] : []);
/** Claves de `_links` (salvo `self`): reflejan el estado; no la ventana de check-in. */
const actionsOf = (links: unknown): string[] => Object.keys(asJson(links)).filter((key) => key !== 'self');
const bookingView = (raw: unknown): Json => { const booking = asJson(raw); return { ...booking, availableActions: actionsOf(booking._links) }; };
const outcomeOf = (status: number): 'COMPLETED' | 'PENDING' => (status === 202 ? 'PENDING' : 'COMPLETED');
const pageSize = (value: unknown, fallback: number, max: number): number => {
  const size = value === undefined || value === null ? fallback : value;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > max) throw validationError('first', `entre 1 y ${max}`);
  return size;
};
const withAfter = (after: unknown, name = 'after'): string | undefined => (after === undefined || after === null ? undefined : v.check(v.cursorText, after, name));
const bookingId = (value: unknown): string => v.check(v.uuid, value, 'bookingId');
const key = (value: unknown, required = true): string | undefined => (value === undefined || value === null ? (required ? v.check(v.idempotencyKey, value, 'idempotencyKey') : undefined) : v.check(v.idempotencyKey, value, 'idempotencyKey'));
const connection = (response: Json, items: Json[], extra: Json = {}): Json => ({ ...extra, items, pageInfo: { endCursor: typeof response.nextCursor === 'string' ? response.nextCursor : null, hasNextPage: typeof response.nextCursor === 'string' } });

/** Pasajeros de la reserva: se reenvían solo los campos del esquema (el SDL y `check` descartan lo demás). */
const passengerBody = (passenger: Json): Json => v.compact({
  passengerId: passenger.passengerId, passengerType: passenger.passengerType, associatedAdultId: passenger.associatedAdultId, firstName: passenger.firstName, lastName: passenger.lastName,
  documentType: passenger.documentType, documentNumber: passenger.documentNumber, nationality: passenger.nationality, documentExpiryDate: passenger.documentExpiryDate,
  birthDate: passenger.birthDate, gender: passenger.gender, contact: passenger.contact, assignedSeats: passenger.assignedSeats ?? [], extraBaggage: passenger.extraBaggage ?? []
});

export const queryResolvers = {
  async searchFlights(_: unknown, args: Args, ctx: RequestContext): Promise<Json> {
    const input = v.check(v.searchInput, args.input, 'input');
    if (!ctx.fingerprint) throw validationError('X-Device-Fingerprint', 'es obligatoria');
    const response = await call(ctx, { method: 'POST', path: `${V2}/search`, body: { itineraries: input.itineraries, passengers: v.compact(input.passengers) } });
    const body = asJson(response.body); return { totalOffers: body.totalOffers ?? asList(body.offers).length, offers: asList(body.offers) };
  },
  async seatMap(_: unknown, args: Args, ctx: RequestContext): Promise<unknown> {
    const offerId = v.check(v.idText, args.offerId, 'offerId'); const segmentId = v.check(v.idText, args.segmentId, 'segmentId');
    return (await call(ctx, { method: 'GET', path: `${V2}/offers/${encodeURIComponent(offerId)}/seatmap`, query: { segmentId } })).body;
  },
  async flightStatus(_: unknown, args: Args, ctx: RequestContext): Promise<unknown> {
    const number = v.check(v.flightNumber, args.flightNumber, 'flightNumber'); const date = v.check(v.dateText, args.date, 'date');
    return (await call(ctx, { method: 'GET', path: `${V2}/flights/${number}/status`, query: { date } })).body;
  },
  async platformHealth(_: unknown, _args: Args, ctx: RequestContext): Promise<Json> {
    // El health responde 503 con cuerpo cuando el nodo está DOWN: es un dato, no un error.
    const body = asJson((await call(ctx, { method: 'GET', path: `${V2}/health` }, { accept: [200, 503] })).body);
    return { status: body.status ?? 'DOWN', nodeId: body.nodo_id ?? '', version: body.version ?? '', uptimeSeconds: body.uptime_seconds ?? null, latencyMs: body.latencia_ms ?? null, timestamp: body.timestamp ?? new Date().toISOString(), dependencies: asList(body.dependencias).map((entry) => ({ name: entry.nombre ?? '', status: entry.status ?? 'DOWN', latencyMs: entry.latencia_ms ?? null })) };
  },
  viewer(_: unknown, _args: Args, ctx: RequestContext): unknown { return ctx.viewer ?? null; },
  async hold(_: unknown, args: Args, ctx: RequestContext): Promise<unknown> {
    return (await call(ctx, { method: 'GET', path: `${V2}/offers/hold/${v.check(v.uuid, args.holdId, 'holdId')}` }, { auth: true })).body;
  },
  async myBookings(_: unknown, args: Args, ctx: RequestContext): Promise<Json> {
    const filter = asJson(args.filter); const limit = pageSize(args.first, 10, 50);
    const query = { limit, cursor: withAfter(args.after), pnr: filter.pnr === undefined || filter.pnr === null ? undefined : v.check(v.idText, filter.pnr, 'filter.pnr'), status: filter.status as string | undefined ?? undefined, createdFrom: filter.createdFrom as string | undefined ?? undefined, createdTo: filter.createdTo as string | undefined ?? undefined };
    const body = asJson((await call(ctx, { method: 'GET', path: `${V2}/bookings`, query }, { auth: true })).body);
    // Cursor opaco hacia delante: `endCursor` es el `nextCursor` del Gateway, sin modificar. El `cursor` de cada arista es el bookingId (solo identifica la fila; para paginar se usa `pageInfo.endCursor`).
    const edges = asList(body.items).map((item) => ({ cursor: String(item.bookingId ?? ''), node: { ...item, availableActions: actionsOf(item._links) } }));
    return { edges, pageInfo: { endCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null, hasNextPage: typeof body.nextCursor === 'string' } };
  },
  async booking(_: unknown, args: Args, ctx: RequestContext): Promise<Json> {
    return bookingView((await call(ctx, { method: 'GET', path: `${V2}/bookings/${bookingId(args.bookingId)}` }, { auth: true })).body);
  },
  async boardingPasses(_: unknown, args: Args, ctx: RequestContext): Promise<Json[]> {
    return asList(asJson((await call(ctx, { method: 'GET', path: `${V2}/bookings/${bookingId(args.bookingId)}/boarding-passes` }, { auth: true })).body).boardingPasses);
  },
  async baggageOptions(_: unknown, args: Args, ctx: RequestContext): Promise<Json[]> {
    return asList((await call(ctx, { method: 'GET', path: `${V2}/bookings/${bookingId(args.bookingId)}/baggage-options` }, { auth: true })).body);
  },
  async searchDateChange(_: unknown, args: Args, ctx: RequestContext): Promise<Json[]> {
    const changes = v.check(v.dateChanges, args.changes, 'changes');
    return asList((await call(ctx, { method: 'POST', path: `${V2}/bookings/${bookingId(args.bookingId)}/date-change/search`, body: { changes } }, { auth: true })).body);
  },
  async cancellationQuote(_: unknown, args: Args, ctx: RequestContext): Promise<unknown> {
    return (await call(ctx, { method: 'GET', path: `${V2}/bookings/${bookingId(args.bookingId)}/cancellation-quote` }, { auth: true })).body;
  },

  // ───────── Administrador ─────────
  async adminFlights(_: unknown, args: Args, ctx: RequestContext): Promise<Json> {
    const limit = pageSize(args.first, 50, 200); const after = args.after === undefined || args.after === null ? undefined : v.check(v.uuid, args.after, 'after');
    const date = args.date === undefined || args.date === null ? undefined : v.check(v.dateText, args.date, 'date');
    const body = asJson((await call(ctx, { method: 'GET', path: `${ADMIN_API}/flights`, query: { limit, cursor: after, date } }, { auth: true })).body);
    const next = asJson(body.page).nextCursor;
    const items = asList(body.items).map((flight) => { const segment = asJson(flight.segment); const departure = asJson(segment.departure); const arrival = asJson(segment.arrival); return { flightInstanceId: flight.flightInstanceId, flightNumber: segment.flightNumber, departureIata: departure.iataCode, arrivalIata: arrival.iataCode, departureAt: departure.at, arrivalAt: arrival.at, aircraft: segment.aircraft ?? null, closed: flight.closed === true, cabins: asList(flight.cabins) }; });
    return connection({ nextCursor: next }, items);
  },
  async adminFares(_: unknown, args: Args, ctx: RequestContext): Promise<Json[]> {
    const flightInstanceId = args.flightInstanceId === undefined || args.flightInstanceId === null ? undefined : v.check(v.uuid, args.flightInstanceId, 'flightInstanceId');
    return asList(asJson((await call(ctx, { method: 'GET', path: `${ADMIN_API}/fares`, query: { flightInstanceId } }, { auth: true })).body).fares).map((entry) => asJson(entry.fare ?? entry));
  },
  async flightOperations(_: unknown, args: Args, ctx: RequestContext): Promise<Json> {
    const limit = pageSize(args.first, 50, 50);
    const query = { date: v.check(v.dateText, args.date, 'date'), origin: args.origin === undefined || args.origin === null ? undefined : v.check(v.iataCode, args.origin, 'origin'), destination: args.destination === undefined || args.destination === null ? undefined : v.check(v.iataCode, args.destination, 'destination'), status: args.status as string | undefined ?? undefined, limit, cursor: withAfter(args.after) };
    const body = asJson((await call(ctx, { method: 'GET', path: `${V2}/operaciones/vuelos`, query }, { auth: true })).body);
    return { ...connection(body, asList(body.items)), totalFlights: body.totalFlights ?? asList(body.items).length };
  },
  async promotionAgreement(_: unknown, _args: Args, ctx: RequestContext): Promise<Json | null> {
    const response = await call(ctx, { method: 'GET', path: `${V2}/promociones/contrato` }, { auth: true, accept: [200, 404] });
    return response.status === 404 ? null : promotionView(asJson(response.body));
  }
};
const promotionView = (body: Json): Json => ({ allowsPromotions: body.permite_promociones === true, maxDiscountPercent: body.porcentaje_descuento_maximo ?? 0, destinations: body.destinos_habilitados ?? null, routes: body.rutas_habilitadas ?? null, cabins: body.cabinas_habilitadas ?? null, validUntil: body.vigencia_hasta ?? null, conditions: body.condiciones_combo ?? null, updatedAt: body.actualizado_en ?? null });
const fareBody = (input: Json): Json => ({
  ...v.compact({ fareId: input.fareId }), flightInstanceId: input.flightInstanceId, cabinClass: input.cabinClass, fareBrand: input.fareBrand, price: v.compact(asJson(input.price)),
  fareRules: { isRefundable: input.isRefundable, isChangeable: input.isChangeable }, baggageAllowance: v.compact({ personalItemIncluded: input.personalItemIncluded, carryOnIncluded: input.carryOnIncluded, checkedBaggageIncluded: input.checkedBaggageIncluded }),
  extraCheckedBaggagePrice: v.compact(asJson(input.extraCheckedBaggagePrice))
});

export const mutationResolvers = {
  async holdOffer(_: unknown, args: Args, ctx: RequestContext): Promise<unknown> {
    const input = v.check(v.holdInput, args.input, 'input'); const idempotency = key(args.idempotencyKey);
    const body = { offerId: input.offerId, itinerarySelections: input.selections, passengersBreakdown: v.compact(input.passengers), ...(input.ttlMinutes ? { ttlMinutes: input.ttlMinutes } : {}), ...(input.seats?.length ? { assignedSeats: input.seats } : {}) };
    return (await call(ctx, { method: 'POST', path: `${V2}/offers/hold`, body }, { auth: true, idempotencyKey: idempotency })).body;
  },
  async releaseHold(_: unknown, args: Args, ctx: RequestContext): Promise<boolean> {
    await call(ctx, { method: 'DELETE', path: `${V2}/offers/hold/${v.check(v.uuid, args.holdId, 'holdId')}` }, { auth: true }); return true;
  },
  async createBooking(_: unknown, args: Args, ctx: RequestContext): Promise<Json> {
    const input = v.check(v.createBookingInput, args.input, 'input'); const idempotency = key(args.idempotencyKey);
    // Sin `amount`, `paymentChannel`, `provider` ni `salesChannel`: el canal lo decide el Gateway por el rol del token.
    const response = await call(ctx, { method: 'POST', path: `${V2}/bookings`, body: { holdId: input.holdId, passengers: input.passengers.map((p) => passengerBody(p as Json)), payment: { paymentReference: input.paymentReference } } }, { auth: true, idempotencyKey: idempotency });
    return { outcome: outcomeOf(response.status), booking: bookingView(response.body) };
  },
  async addBaggage(_: unknown, args: Args, ctx: RequestContext): Promise<unknown> {
    const input = v.check(v.addBaggageInput, args.input, 'input'); const idempotency = key(args.idempotencyKey);
    return (await call(ctx, { method: 'POST', path: `${V2}/bookings/${input.bookingId}/baggage`, body: { passengerId: input.passengerId, itineraryId: input.itineraryId, quantity: input.quantity, payment: { paymentReference: input.paymentReference } } }, { auth: true, idempotencyKey: idempotency })).body;
  },
  async confirmDateChange(_: unknown, args: Args, ctx: RequestContext): Promise<Json> {
    const input = v.check(v.confirmDateChangeInput, args.input, 'input'); const idempotency = key(args.idempotencyKey);
    const seats = input.assignedSeats?.map((seat) => ({ segmentId: seat.segmentId, seatNumber: seat.seatNumber }));
    const response = await call(ctx, { method: 'POST', path: `${V2}/bookings/${input.bookingId}/date-change`, body: { changeOfferId: input.changeOfferId, ...(input.paymentReference ? { payment: { paymentReference: input.paymentReference } } : {}), ...(seats?.length ? { assignedSeats: seats } : {}) } }, { auth: true, idempotencyKey: idempotency });
    const body = asJson(response.body);
    return { outcome: outcomeOf(response.status), booking: body.bookingId && body.grandTotal ? bookingView(body) : null };
  },
  async cancelBooking(_: unknown, args: Args, ctx: RequestContext): Promise<Json> {
    const id = bookingId(args.bookingId); const quoteId = v.check(v.idText, args.quoteId, 'quoteId'); const idempotency = key(args.idempotencyKey);
    const reason = args.reason === undefined || args.reason === null ? undefined : v.check(v.reasonText, args.reason, 'reason');
    const reasonCode = args.reasonCode === 'OTHER' ? 'OTHER' : 'CUSTOMER_REQUEST';
    const body = asJson((await call(ctx, { method: 'POST', path: `${V2}/bookings/${id}/cancel`, body: { quoteId, reasonCode, ...(reason ? { reason } : {}) } }, { auth: true, idempotencyKey: idempotency })).body);
    return { ...body, outcome: body.status === 'CANCELLED' ? 'COMPLETED' : 'PENDING', status: body.status };
  },
  async changeSeats(_: unknown, args: Args, ctx: RequestContext): Promise<Json> {
    const seats = v.check(v.seatChanges, args.seats, 'seats'); const idempotency = key(args.idempotencyKey);
    const body = asJson((await call(ctx, { method: 'PUT', path: `${V2}/bookings/${bookingId(args.bookingId)}/seats`, body: { seats } }, { auth: true, idempotencyKey: idempotency })).body);
    return { seats: asList(body.seats) };
  },
  async issueTickets(_: unknown, args: Args, ctx: RequestContext): Promise<Json> {
    const id = bookingId(args.bookingId);
    const issued = asJson((await call(ctx, { method: 'POST', path: `${V2}/bookings/${id}/tickets` }, { auth: true })).body);
    const detail = await call(ctx, { method: 'GET', path: `${V2}/bookings/${id}` }, { auth: true });
    return { issued: typeof issued.issued === 'number' ? issued.issued : 0, booking: bookingView(detail.body) };
  },
  async checkIn(_: unknown, args: Args, ctx: RequestContext): Promise<unknown> {
    return (await call(ctx, { method: 'POST', path: `${V2}/bookings/${bookingId(args.bookingId)}/check-in` }, { auth: true })).body;
  },

  // ───────── Administrador ─────────
  async updateFlightStatus(_: unknown, args: Args, ctx: RequestContext): Promise<unknown> {
    const number = v.check(v.flightNumber, args.flightNumber, 'flightNumber'); const input = v.check(v.flightStatusUpdate, args.input, 'input'); const idempotency = key(args.idempotencyKey, false);
    return (await call(ctx, { method: 'PATCH', path: `${V2}/flights/${number}/status`, body: v.compact(input) }, { auth: true, ...(idempotency ? { idempotencyKey: idempotency } : {}) })).body;
  },
  async upsertFare(_: unknown, args: Args, ctx: RequestContext): Promise<Json> {
    const input = v.check(v.upsertFareInput, args.input, 'input');
    const body = asJson((await call(ctx, { method: 'PUT', path: `${ADMIN_API}/fares`, body: fareBody(input as Json) }, { auth: true })).body); return asJson(body.fare ?? body);
  },
  async setPromotionAgreement(_: unknown, args: Args, ctx: RequestContext): Promise<Json> {
    const input = v.check(v.promotionInput, args.input, 'input'); const idempotency = key(args.idempotencyKey);
    const body = v.compact({ permite_promociones: input.allowsPromotions, porcentaje_descuento_maximo: input.maxDiscountPercent, destinos_habilitados: input.destinations, rutas_habilitadas: input.routes, cabinas_habilitadas: input.cabins, vigencia_hasta: input.validUntil, condiciones_combo: input.conditions });
    return promotionView(asJson((await call(ctx, { method: 'PUT', path: `${V2}/promociones/contrato`, body }, { auth: true, idempotencyKey: idempotency })).body));
  }
};

/** Resolutores de campos con lógica propia (el resto lee la propiedad con el mismo nombre del cuerpo del Gateway). */
export const typeResolvers: Record<string, Record<string, (parent: Json) => unknown>> = {
  BookingPassenger: { documentNumberMasked: (parent) => maskDocument(parent.documentNumber) },
  Hold: { lockedPrice: (parent) => parent.lockedPrice ?? null },
  CancelBookingPayload: { ticketsVoided: (parent) => parent.ticketsVoided ?? [] }
};
