import { randomUUID } from 'node:crypto';
import { RequestContext, requireRole, validate } from '@flight-platform/shared';
import { CabinCapacity } from '../domain/cabin-capacity';
import { InventoryError } from '../domain/errors';
import { FlightInstance } from '../domain/flight-instance';
import { FlightReader, UnitOfWork } from './ports';
import { idRequest, upsertRequest } from './schemas';

/** Rutas administrativas: solo rol `admin`. */
export class FlightAdmin {
  constructor(private readonly reader: FlightReader, private readonly uow: UnitOfWork) {}

  async upsert(ctx: RequestContext, input: unknown): Promise<FlightInstance> {
    requireRole(ctx, 'admin');
    const req = validate(upsertRequest, input);
    const departureAt = new Date(req.departureAt);
    // Falla r?pido, antes de tocar la base, si el vuelo es incoherente.
    if (new Date(req.arrivalAt) <= departureAt || req.departureIata === req.arrivalIata) {
      throw new InventoryError('VALIDATION_FAILED');
    }
    const existing = req.flightInstanceId
      ? await this.reader.get(req.flightInstanceId)
      : await this.reader.findByNumberAndDeparture(req.flightNumber, departureAt);
    const id = existing?.id ?? req.flightInstanceId ?? randomUUID();
    // Las cabinas no listadas conservan su estado; las listadas cambian solo `sellable`.
    const byCabin = new Map((existing?.props.cabins ?? []).map((c) => [c.cabinClass, c]));
    for (const requested of req.cabins) {
      const current = byCabin.get(requested.cabinClass);
      byCabin.set(
        requested.cabinClass,
        current ? current.withSellable(requested.capacity) : new CabinCapacity(requested.cabinClass, requested.capacity)
      );
    }
    const flight = new FlightInstance({
      id,
      flightNumber: req.flightNumber,
      departureIata: req.departureIata,
      arrivalIata: req.arrivalIata,
      departureAt,
      arrivalAt: new Date(req.arrivalAt),
      aircraft: req.aircraft ?? null,
      closed: existing?.props.closed ?? false,
      cabins: [...byCabin.values()]
    });
    await this.uow.run((tx) => tx.saveFlight(flight));
    return (await this.reader.get(id)) as FlightInstance;
  }

  async close(ctx: RequestContext, input: unknown): Promise<FlightInstance> {
    requireRole(ctx, 'admin');
    const { flightInstanceId } = validate(idRequest, input);
    const found = await this.uow.run((tx) => tx.setClosed(flightInstanceId));
    if (!found) throw new InventoryError('NOT_FOUND');
    return (await this.reader.get(flightInstanceId)) as FlightInstance;
  }
}
