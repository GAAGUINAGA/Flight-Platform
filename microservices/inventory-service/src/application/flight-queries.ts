import { RequestContext, validate } from '@flight-platform/shared';
import { Clock } from '@flight-platform/shared';
import { FlightInstance } from '../domain/flight-instance';
import { InventoryError } from '../domain/errors';
import { expireDue } from './expire-due';
import { EventPublisher, ExpiredHold, FlightReader, UnitOfWork } from './ports';
import { availabilityRequest, findRequest, idRequest, isValidAvailability, listRequest } from './schemas';
import { publishExpired } from './publish-expired';

export interface AvailableFlightView { flight: FlightInstance; cabinClass: string; availableSeats: number }

const dayRange = (date: string): [Date, Date] => {
  const from = new Date(`${date}T00:00:00Z`);
  return [from, new Date(from.getTime() + 86_400_000)];
};

export class FlightQueries {
  constructor(
    private readonly reader: FlightReader,
    private readonly uow: UnitOfWork,
    private readonly events: EventPublisher,
    private readonly clock: Clock
  ) {}

  async get(_ctx: RequestContext, input: unknown): Promise<FlightInstance> {
    const { flightInstanceId } = validate(idRequest, input);
    const flight = await this.reader.get(flightInstanceId);
    if (!flight) throw new InventoryError('NOT_FOUND');
    return flight;
  }

  async find(_ctx: RequestContext, input: unknown): Promise<FlightInstance> {
    const { flightNumber, departureDate } = validate(findRequest, input);
    const [from, to] = dayRange(departureDate);
    const flight = await this.reader.find(flightNumber, from, to);
    if (!flight) throw new InventoryError('NOT_FOUND');
    return flight;
  }

  async list(_ctx: RequestContext, input: unknown): Promise<{ items: FlightInstance[]; nextCursor?: string }> {
    const req = validate(listRequest, input);
    const limit = req.page?.limit || 50;
    const [from, to] = req.date ? dayRange(req.date) : [undefined, undefined];
    const rows = await this.reader.list({ from, to, cursor: req.page?.cursor, limit: limit + 1 });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : undefined };
  }

  /** Disponibilidad por cabina; libera perezosamente los holds vencidos de los vuelos consultados. */
  async queryAvailability(ctx: RequestContext, input: unknown): Promise<AvailableFlightView[]> {
    const req = validate(availabilityRequest, input);
    if (!isValidAvailability(req)) throw new InventoryError('VALIDATION_FAILED');
    const now = this.clock.now();
    const [from, to] = dayRange(req.departureDate);
    let flights = await this.reader.search(req.origin, req.destination, from, to);
    flights = flights.filter((f) => f.isSellable(now));
    if (flights.length > 0) {
      const expired: ExpiredHold[] = await this.uow.run((tx) => expireDue(tx, now, flights.map((f) => f.id)));
      if (expired.length > 0) {
        await publishExpired(this.events, expired, now, ctx.correlationId);
        flights = (await this.reader.search(req.origin, req.destination, from, to)).filter((f) => f.isSellable(now));
      }
    }
    const needed = req.passengers.adults + req.passengers.youths + req.passengers.children;
    const result: AvailableFlightView[] = [];
    for (const flight of flights) {
      for (const cap of flight.props.cabins) {
        if (req.cabinClass && cap.cabinClass !== req.cabinClass) continue;
        if (cap.available >= needed) result.push({ flight, cabinClass: cap.cabinClass, availableSeats: cap.available });
      }
    }
    return result;
  }
}
