import { randomUUID } from 'node:crypto';
import process from 'node:process';
import type { Request } from 'express';
import type { AuthContext } from '../auth';
import type { GatewayConfig } from '../config';
import { callGatewayGrpc } from '../grpc-clients';
import { GatewayProblemError } from '../web-errors';
import { publishV2Event } from './events';
import { deterministicUuid, isUuid } from './ids';
import { z } from 'zod';
import { parseAdmin } from '../admin.schemas';
import { canTransition, FLIGHT_STATUSES, type FlightStatusName } from './flight-transitions';
import { v2Controller, v2Route } from './route';
import { ownerClient } from './v2-security';

type Json = Record<string, unknown>;
const correlation = (req: Request): string => String(req.res?.getHeader('X-Correlation-Id') ?? '');
const OPS_SCOPES = ['flights:ops', 'flights:admin'];
const MAX_BOOKING_PAGES = 20; const MAX_BOOKING_IDS = 100; const MAX_PANEL_PAGES = 10; const LOW_AVAILABILITY = 10;
const SEAT_STATES = ['AVAILABLE', 'HELD', 'BOOKED', 'TICKETED', 'CHECKED_IN', 'BOARDED'] as const;

const dateTime = z.string().datetime({ offset: true });
/** Lo que el esquema OpenAPI no acota (largos de puerta y motivo) se valida aquí, antes de tocar ningún servicio. */
const statusBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), status: z.enum(FLIGHT_STATUSES), estimatedDepartureAt: dateTime.optional(), estimatedArrivalAt: dateTime.optional(),
  departureGate: z.string().trim().min(1).max(16).optional(), reason: z.string().trim().min(1).max(200).optional()
});
type StatusBody = z.output<typeof statusBody>;
interface Endpoint { iataCode: string; scheduledAt: string; estimatedAt?: string | null; actualAt?: string | null; terminal?: string | null }
interface OpsFlight { flightNumber: string; date: string; marketingCarrier: string; operatingCarrier: string; departure: Endpoint; arrival: Endpoint; aircraft?: string; status: FlightStatusName }
interface Occupancy { flightInstanceId: string; segment: { flightNumber: string; departure: { iataCode: string; at: string }; arrival: { iataCode: string }; aircraft?: string }; closed: boolean; cabins: Array<{ cabinClass: string; sellable: number; held: number; sold: number }>; activeHolds: number; nextHoldExpiryAt?: string }
interface BookingPage { items?: Array<{ bookingId: string; status: string; ownerId: string }>; nextCursor?: string }

const delayOf = (flight: OpsFlight): number => { const scheduled = Date.parse(flight.departure.scheduledAt); const estimated = Date.parse(flight.departure.estimatedAt ?? ''); return Number.isFinite(scheduled) && Number.isFinite(estimated) ? Math.max(0, Math.round((estimated - scheduled) / 60_000)) : 0; };
const envNumber = (name: string, fallback: number): number => { const value = Number(process.env[name] ?? fallback); return Number.isFinite(value) && value > 0 ? value : fallback; };

/** Operaciones de la aerolínea: cambio de estado de un vuelo y panel de ocupación (scope `flights:ops` o `flights:admin`). */
export class V2OperationsController {
  constructor(private readonly config: GatewayConfig, private readonly clock: () => Date = () => new Date()) {}
  /** Los RPC administrativos de los servicios exigen el rol; el scope ya se verificó en la guarda. */
  private privileged(req: Request, role: 'admin' | 'system'): AuthContext { return { ownerId: req.auth!.ownerId, role, scopes: req.auth!.scopes }; }
  private call(req: Request, service: 'inventory' | 'operations' | 'reservation', method: string, input: object, role: 'admin' | 'system' = 'admin'): Promise<unknown> { return callGatewayGrpc(this.config, service, method, input, correlation(req), this.privileged(req, role)); }

  /** Reservas vivas del vuelo (id y dueño); el conteo cubre hasta MAX_BOOKING_PAGES páginas. */
  private async bookingsOf(req: Request, flightInstanceId: string): Promise<Array<{ bookingId: string; ownerId: string }>> {
    const found: Array<{ bookingId: string; ownerId: string }> = []; let cursor: string | undefined;
    for (let page = 0; page < MAX_BOOKING_PAGES; page += 1) {
      const result = await this.call(req, 'reservation', 'listReservationsByFlightInstance', { flightInstanceId, limit: 50, ...(cursor ? { cursor } : {}) }, 'system') as BookingPage;
      for (const item of result.items ?? []) if (item.status !== 'CANCELLED' && item.status !== 'FAILED') found.push({ bookingId: item.bookingId, ownerId: item.ownerId });
      cursor = result.nextCursor || undefined; if (!cursor) break;
    }
    return found;
  }

  async updateStatus(req: Request, flightNumber: string, raw: unknown): Promise<Json> {
    const body: StatusBody = parseAdmin(statusBody, raw);
    const instance = await this.call(req, 'inventory', 'findFlightInstance', { flightNumber, departureDate: body.date }) as { flightInstanceId: string; segment: { arrival: { iataCode: string } } };
    const previous = await this.call(req, 'operations', 'getFlightStatus', { flightNumber, date: body.date }) as OpsFlight;
    if (!canTransition(previous.status, body.status)) throw new GatewayProblemError(409, 'INVALID_STATUS_TRANSITION', `No se puede pasar de ${previous.status} a ${body.status}`);
    const flight = await this.call(req, 'operations', 'recordOperationalUpdate', { flightInstanceId: instance.flightInstanceId, status: body.status, ...(body.estimatedDepartureAt ? { estimatedDepartureAt: body.estimatedDepartureAt } : {}), ...(body.estimatedArrivalAt ? { estimatedArrivalAt: body.estimatedArrivalAt } : {}), ...(body.departureGate ? { departureGate: body.departureGate } : {}), ...(body.reason ? { reason: body.reason } : {}) }) as OpsFlight;
    const affected = await this.bookingsOf(req, instance.flightInstanceId).catch(() => []);

    // Cada socio recibe solo los ids de sus propias reservas; quien opera el cambio recibe siempre el evento (queda en su feed).
    const callerClient = req.auth!.clientId ?? req.auth!.ownerId;
    const byClient = new Map<string, string[]>([[callerClient, []]]);
    for (const booking of affected) { const client = ownerClient(booking.ownerId); byClient.set(client, [...(byClient.get(client) ?? []), booking.bookingId]); }
    const base = req.header('idempotency-key') ?? randomUUID(); const delayMinutes = delayOf(flight);
    const eventIds = new Map<string, string>();
    for (const [client, ids] of byClient) {
      const eventId = deterministicUuid(`${base}:flight.status_changed:${client}`); eventIds.set(client, eventId);
      await publishV2Event(this.config, client, { eventType: 'flight.status_changed', eventId, correlationId: correlation(req), extra: {
        flightNumber, date: body.date, previousStatus: previous.status, newStatus: flight.status, destination: instance.segment.arrival.iataCode, delayMinutes,
        ...(flight.departure.estimatedAt ? { estimatedDepartureAt: flight.departure.estimatedAt } : {}), ...(flight.arrival.estimatedAt ? { estimatedArrivalAt: flight.arrival.estimatedAt } : {}),
        ...(body.departureGate ? { departureGate: body.departureGate } : {}), ...(body.reason ? { reason: body.reason } : {}), affectedBookingIds: ids.filter(isUuid).slice(0, MAX_BOOKING_IDS)
      } });
    }
    return { previousStatus: previous.status, flight: { ...flight, delayMinutes, updatedAt: this.clock().toISOString() }, affectedBookings: affected.length, eventId: eventIds.get(callerClient) };
  }

  async panel(req: Request, query: { date: string; origin?: string; destination?: string; status?: FlightStatusName; limit?: string | number; cursor?: string }): Promise<Json> {
    const limit = query.limit === undefined ? 10 : Number(query.limit);
    const all: Occupancy[] = []; let cursor: string | undefined;
    for (let page = 0; page < MAX_PANEL_PAGES; page += 1) {
      const result = await this.call(req, 'inventory', 'listCabinOccupancy', { date: query.date, page: { limit: 200, ...(cursor ? { cursor } : {}) } }) as { items?: Occupancy[]; page?: { nextCursor?: string } };
      all.push(...(result.items ?? [])); cursor = result.page?.nextCursor || undefined; if (!cursor) break;
    }
    let flights = all.filter((item) => (!query.origin || item.segment.departure.iataCode === query.origin) && (!query.destination || item.segment.arrival.iataCode === query.destination));
    const statusOf = async (item: Occupancy): Promise<OpsFlight | undefined> => this.call(req, 'operations', 'getFlightStatus', { flightNumber: item.segment.flightNumber, date: item.segment.departure.at.slice(0, 10) }).catch(() => undefined) as Promise<OpsFlight | undefined>;
    const known = new Map<string, OpsFlight | undefined>();
    if (query.status) { await Promise.all(flights.map(async (item) => known.set(item.flightInstanceId, await statusOf(item)))); flights = flights.filter((item) => known.get(item.flightInstanceId)?.status === query.status); }

    let start = 0;
    if (query.cursor) { const index = flights.findIndex((item) => item.flightInstanceId === query.cursor); if (index < 0) throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'cursor inválido'); start = index + 1; }
    const slice = flights.slice(start, start + limit);
    await Promise.all(slice.filter((item) => !known.has(item.flightInstanceId)).map(async (item) => known.set(item.flightInstanceId, await statusOf(item))));
    const now = this.clock(); const openHours = envNumber('CHECKIN_OPEN_HOURS', 48); const closeMinutes = envNumber('CHECKIN_CLOSE_MINUTES', 60);
    const items = slice.map((item) => {
      const operational = known.get(item.flightInstanceId); const status = operational?.status ?? 'SCHEDULED';
      const totalSeats = item.cabins.reduce((sum, cabin) => sum + cabin.sellable, 0); const taken = item.cabins.reduce((sum, cabin) => sum + cabin.held + cabin.sold, 0);
      // Las ventas v2 emiten el boleto en la misma operación (ADR-F12-04): lo vendido cuenta como TICKETED. CHECKED_IN y BOARDED no tienen conteo por vuelo todavía.
      const cabins = item.cabins.map((cabin) => ({ cabinClass: cabin.cabinClass, totalSeats: cabin.sellable, seatsByStatus: Object.fromEntries(SEAT_STATES.map((state) => [state, state === 'AVAILABLE' ? cabin.sellable - cabin.held - cabin.sold : state === 'HELD' ? cabin.held : state === 'TICKETED' ? cabin.sold : 0])) }));
      const departure = Date.parse(item.segment.departure.at); const remaining = departure - now.getTime();
      const checkInOpen = status !== 'CANCELLED' && !item.closed && remaining > closeMinutes * 60_000 && remaining <= openHours * 3_600_000;
      const alerts: Array<{ code: string; severity: string; message: string }> = [];
      if (status === 'CANCELLED') alerts.push({ code: 'CANCELLED', severity: 'CRITICAL', message: 'El vuelo está cancelado.' });
      if (status === 'DELAYED') alerts.push({ code: 'DELAYED', severity: 'WARNING', message: `Vuelo demorado ${operational ? delayOf(operational) : 0} minutos.` });
      if (checkInOpen) alerts.push({ code: 'CHECKIN_OPEN', severity: 'INFO', message: 'El check-in está abierto.' });
      for (const cabin of cabins) { const free = cabin.seatsByStatus.AVAILABLE as number; if (cabin.totalSeats > 0 && free < LOW_AVAILABILITY) alerts.push({ code: 'LOW_AVAILABILITY', severity: free === 0 ? 'CRITICAL' : 'WARNING', message: `Quedan ${free} asientos en ${cabin.cabinClass}.` }); }
      return { flightNumber: item.segment.flightNumber, date: item.segment.departure.at.slice(0, 10), origin: item.segment.departure.iataCode, destination: item.segment.arrival.iataCode, departureAt: item.segment.departure.at, status, ...(item.segment.aircraft ? { aircraft: item.segment.aircraft } : {}), totalSeats, loadFactor: totalSeats > 0 ? Math.round((taken / totalSeats) * 1000) / 10 : 0, cabins, activeHolds: item.activeHolds, nextHoldExpiryAt: item.nextHoldExpiryAt ?? null, checkInOpen, alerts };
    });
    return { date: query.date, totalFlights: flights.length, nextCursor: start + limit < flights.length && slice.length > 0 ? slice[slice.length - 1].flightInstanceId : null, items };
  }
}
v2Controller(V2OperationsController, 'vuelos', ['GATEWAY_CONFIG']);
v2Route(V2OperationsController.prototype, 'updateStatus', 'patch', 'flights/:flightNumber/status', ['req', 'param:flightNumber', 'body'], { anyScope: OPS_SCOPES, status: 200 });
v2Route(V2OperationsController.prototype, 'panel', 'get', 'operaciones/vuelos', ['req', 'query'], { anyScope: OPS_SCOPES });
