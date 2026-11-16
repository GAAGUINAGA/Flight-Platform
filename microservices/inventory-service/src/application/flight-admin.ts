import { randomUUID } from 'node:crypto';
import { dayWindows, flightLocalDay, RequestContext, requireRole, validate, zoneOf } from '@flight-platform/shared';
import { CabinCapacity } from '../domain/cabin-capacity';
import { InventoryError } from '../domain/errors';
import { FlightInstance } from '../domain/flight-instance';
import { FlightReader, UnitOfWork } from './ports';
import { createRequest, idRequest, upsertRequest } from './schemas';

/** Rutas administrativas: solo rol `admin`. */
export class FlightAdmin {
  constructor(private readonly reader: FlightReader, private readonly uow: UnitOfWork, private readonly now: () => Date = () => new Date()) {}

  async upsert(ctx: RequestContext, input: unknown): Promise<FlightInstance> {
    requireRole(ctx, 'admin');
    const req = validate(upsertRequest, input);
    // ADR-F12b1fix-02: sin zona conocida el vuelo no podría buscarse por su fecha local.
    if (!zoneOf(req.departureIata)) throw new InventoryError('VALIDATION_FAILED');
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

  /**
   * Creación ESTRICTA de un vuelo CERRADO (F12c-4c, ADR-F12c4-01 adenda). El id lo da el llamador (UUIDv5 de la Idempotency-Key): los mismos datos con el
   * mismo id devuelven el vuelo existente (reintento); otro vuelo con el mismo número y día local de salida, o el mismo id con otros datos, es
   * `FLIGHT_ALREADY_EXISTS`. Nace cerrado: no aparece en búsquedas ni admite holds hasta `open`. Reglas duras que Inventory no delega al Gateway:
   * avión obligatorio, aeropuertos con zona conocida y distintos, llegada posterior a la salida y salida futura.
   */
  async create(ctx: RequestContext, input: unknown): Promise<FlightInstance> {
    requireRole(ctx, 'admin');
    const req = validate(createRequest, input);
    if (!zoneOf(req.departureIata) || !zoneOf(req.arrivalIata) || req.departureIata === req.arrivalIata) throw new InventoryError('VALIDATION_FAILED');
    const departureAt = new Date(req.departureAt); const arrivalAt = new Date(req.arrivalAt);
    if (arrivalAt <= departureAt) throw new InventoryError('VALIDATION_FAILED');
    const sameData = (existing: FlightInstance): boolean => {
      const p = existing.props;
      return p.flightNumber === req.flightNumber && p.departureIata === req.departureIata && p.arrivalIata === req.arrivalIata && p.departureAt.getTime() === departureAt.getTime()
        && p.arrivalAt.getTime() === arrivalAt.getTime() && p.aircraft === req.aircraft
        && p.cabins.length === req.cabins.length && req.cabins.every((cabin) => p.cabins.some((value) => value.cabinClass === cabin.cabinClass && value.sellable === cabin.capacity));
    };
    const existing = await this.reader.get(req.flightInstanceId);
    if (existing) { if (sameData(existing)) return existing; throw new InventoryError('FLIGHT_ALREADY_EXISTS'); }
    if (departureAt <= this.now()) throw new InventoryError('VALIDATION_FAILED');
    const sameDay = await this.reader.find(req.flightNumber, dayWindows(flightLocalDay(departureAt, req.departureIata, 'createFlightInstance')));
    if (sameDay) throw new InventoryError('FLIGHT_ALREADY_EXISTS');
    const flight = new FlightInstance({
      id: req.flightInstanceId, flightNumber: req.flightNumber, departureIata: req.departureIata, arrivalIata: req.arrivalIata, departureAt, arrivalAt,
      aircraft: req.aircraft, closed: true, cabins: req.cabins.map((cabin) => new CabinCapacity(cabin.cabinClass, cabin.capacity))
    });
    await this.uow.run((tx) => tx.saveFlight(flight));
    return (await this.reader.get(flight.id)) as FlightInstance;
  }

  /** Abre a la venta un vuelo cerrado (idempotente). No reabre un vuelo que ya salió. Verificar las tarifas es de quien orquesta (Gateway). */
  async open(ctx: RequestContext, input: unknown): Promise<FlightInstance> {
    requireRole(ctx, 'admin');
    const { flightInstanceId } = validate(idRequest, input);
    const flight = await this.reader.get(flightInstanceId);
    if (!flight) throw new InventoryError('NOT_FOUND');
    if (!flight.props.closed) return flight;
    if (flight.props.departureAt <= this.now()) throw new InventoryError('VALIDATION_FAILED');
    await this.uow.run((tx) => tx.setClosed(flightInstanceId, false));
    return (await this.reader.get(flightInstanceId)) as FlightInstance;
  }

  async close(ctx: RequestContext, input: unknown): Promise<FlightInstance> {
    requireRole(ctx, 'admin');
    const { flightInstanceId } = validate(idRequest, input);
    const found = await this.uow.run((tx) => tx.setClosed(flightInstanceId));
    if (!found) throw new InventoryError('NOT_FOUND');
    return (await this.reader.get(flightInstanceId)) as FlightInstance;
  }
}
