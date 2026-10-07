import { setTimeout } from 'node:timers';
import { Prisma, PrismaClient } from '@prisma/client';
import { CabinClass } from '../../domain/cabin';
import { CabinCapacity } from '../../domain/cabin-capacity';
import { InventoryError } from '../../domain/errors';
import { FlightInstance } from '../../domain/flight-instance';
import { HoldStatus, InventoryHold } from '../../domain/inventory-hold';
import {
  FlightReader, InventoryTx, ListFlightsQuery, ReservedRow, UnitOfWork
} from '../../application/ports';

// D-03: el esquema es fijo por servicio; las consultas crudas lo califican expl?citamente.
const T = {
  flights: Prisma.raw('"inventory"."flight_instances"'),
  cabins: Prisma.raw('"inventory"."cabin_inventory"'),
  holds: Prisma.raw('"inventory"."holds"'),
  lines: Prisma.raw('"inventory"."hold_lines"'),
  reserved: Prisma.raw('"inventory"."reserved_inventory"')
};

type FlightRow = Prisma.FlightInstanceGetPayload<{ include: { cabins: true } }>;
type HoldRow = Prisma.HoldGetPayload<{ include: { lines: true } }>;
type Db = PrismaClient | Prisma.TransactionClient;

const CABIN_ORDER: CabinClass[] = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];

export function toFlight(row: FlightRow): FlightInstance {
  const cabins = [...row.cabins]
    .sort((a, b) => CABIN_ORDER.indexOf(a.cabinClass as CabinClass) - CABIN_ORDER.indexOf(b.cabinClass as CabinClass))
    .map((c) => new CabinCapacity(c.cabinClass as CabinClass, c.sellable, c.held, c.sold));
  return new FlightInstance({
    id: row.id, flightNumber: row.flightNumber, departureIata: row.departureIata, arrivalIata: row.arrivalIata,
    departureAt: row.departureAt, arrivalAt: row.arrivalAt, aircraft: row.aircraft, closed: row.closed, cabins
  });
}

function toHold(row: HoldRow): InventoryHold {
  return new InventoryHold({
    id: row.id, ownerId: row.ownerId, status: row.status as HoldStatus, expiresAt: row.expiresAt,
    idempotencyKey: row.idempotencyKey, reservationId: row.reservationId,
    lines: row.lines.map((l) => ({ flightInstanceId: l.flightInstanceId, cabinClass: l.cabinClass as CabinClass, seats: l.seats }))
  });
}

export class PrismaFlightReader implements FlightReader {
  constructor(private readonly db: Db) {}

  private async one(where: Prisma.FlightInstanceWhereInput): Promise<FlightInstance | null> {
    const row = await this.db.flightInstance.findFirst({ where, include: { cabins: true } });
    return row ? toFlight(row) : null;
  }

  get(id: string): Promise<FlightInstance | null> {
    return this.one({ id });
  }

  find(flightNumber: string, from: Date, to: Date): Promise<FlightInstance | null> {
    return this.one({ flightNumber, departureAt: { gte: from, lt: to } });
  }

  findByNumberAndDeparture(flightNumber: string, departureAt: Date): Promise<FlightInstance | null> {
    return this.one({ flightNumber, departureAt });
  }

  async list(q: ListFlightsQuery): Promise<FlightInstance[]> {
    const rows = await this.db.flightInstance.findMany({
      where: q.from && q.to ? { departureAt: { gte: q.from, lt: q.to } } : undefined,
      include: { cabins: true },
      orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
      take: q.limit,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {})
    });
    return rows.map(toFlight);
  }

  async search(origin: string, destination: string, from: Date, to: Date): Promise<FlightInstance[]> {
    const rows = await this.db.flightInstance.findMany({
      where: { departureIata: origin, arrivalIata: destination, closed: false, departureAt: { gte: from, lt: to } },
      include: { cabins: true },
      orderBy: [{ departureAt: 'asc' }, { id: 'asc' }]
    });
    return rows.map(toFlight);
  }
}

const isCapacityViolation = (e: unknown): boolean =>
  e instanceof Error && e.message.includes('cabin_inventory_capacity_chk');

class PrismaTx implements InventoryTx {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async getFlights(ids: string[]): Promise<FlightInstance[]> {
    const rows = await this.tx.flightInstance.findMany({ where: { id: { in: ids } }, include: { cabins: true } });
    return rows.map(toFlight);
  }

  async saveFlight(f: FlightInstance): Promise<void> {
    const p = f.props;
    const data = {
      flightNumber: p.flightNumber, departureIata: p.departureIata, arrivalIata: p.arrivalIata,
      departureAt: p.departureAt, arrivalAt: p.arrivalAt, aircraft: p.aircraft ?? null, closed: p.closed
    };
    await this.tx.flightInstance.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
    for (const c of p.cabins) {
      try {
        await this.tx.$executeRaw`INSERT INTO ${T.cabins} (flight_instance_id, cabin_class, sellable, held, sold)
          VALUES (${p.id}::uuid, ${c.cabinClass}, ${c.sellable}, 0, 0)
          ON CONFLICT (flight_instance_id, cabin_class) DO UPDATE SET sellable = EXCLUDED.sellable`;
      } catch (e) {
        if (isCapacityViolation(e)) throw new InventoryError('VALIDATION_FAILED');
        throw e;
      }
    }
  }

  async setClosed(id: string): Promise<boolean> {
    const n = await this.tx.$executeRaw`UPDATE ${T.flights} SET closed = true, updated_at = now() WHERE id = ${id}::uuid`;
    return n > 0;
  }

  async tryReserve(flightInstanceId: string, cabin: CabinClass, seats: number): Promise<boolean> {
    const n = await this.tx.$executeRaw`UPDATE ${T.cabins} ci SET held = ci.held + ${seats}
      FROM ${T.flights} fi
      WHERE ci.flight_instance_id = ${flightInstanceId}::uuid AND ci.cabin_class = ${cabin}
        AND fi.id = ci.flight_instance_id AND fi.closed = false
        AND ci.sellable - ci.held - ci.sold >= ${seats}`;
    return n === 1;
  }

  async adjust(change: 'release' | 'consume' | 'releaseSold', flightInstanceId: string, cabin: CabinClass, seats: number): Promise<void> {
    const id = flightInstanceId;
    const n =
      change === 'release'
        ? await this.tx.$executeRaw`UPDATE ${T.cabins} SET held = held - ${seats}
            WHERE flight_instance_id = ${id}::uuid AND cabin_class = ${cabin} AND held >= ${seats}`
        : change === 'consume'
          ? await this.tx.$executeRaw`UPDATE ${T.cabins} SET held = held - ${seats}, sold = sold + ${seats}
            WHERE flight_instance_id = ${id}::uuid AND cabin_class = ${cabin} AND held >= ${seats}`
          : await this.tx.$executeRaw`UPDATE ${T.cabins} SET sold = sold - ${seats}
            WHERE flight_instance_id = ${id}::uuid AND cabin_class = ${cabin} AND sold >= ${seats}`;
    if (n !== 1) throw new Error('capacity invariant violated');
  }

  private async loadHold(ids: string[]): Promise<InventoryHold[]> {
    if (ids.length === 0) return [];
    const rows = await this.tx.hold.findMany({ where: { id: { in: ids } }, include: { lines: true }, orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }] });
    return rows.map(toHold);
  }

  async findHold(id: string, ownerId: string): Promise<InventoryHold | null> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`SELECT id FROM ${T.holds}
      WHERE id = ${id}::uuid AND owner_id = ${ownerId} FOR UPDATE`;
    return (await this.loadHold(locked.map((r) => r.id)))[0] ?? null;
  }

  async findHoldByKey(ownerId: string, key: string): Promise<InventoryHold | null> {
    const row = await this.tx.hold.findUnique({
      where: { ownerId_idempotencyKey: { ownerId, idempotencyKey: key } }, include: { lines: true }
    });
    return row ? toHold(row) : null;
  }

  async insertHold(h: InventoryHold): Promise<void> {
    await this.tx.hold.create({
      data: {
        id: h.id, ownerId: h.ownerId, status: h.status, expiresAt: h.expiresAt, idempotencyKey: h.idempotencyKey,
        lines: { create: h.lines.map((l) => ({ flightInstanceId: l.flightInstanceId, cabinClass: l.cabinClass, seats: l.seats })) }
      }
    });
  }

  async updateHoldStatus(h: InventoryHold, from: HoldStatus, notExpiredAt?: Date): Promise<boolean> {
    const n = notExpiredAt
      ? await this.tx.$executeRaw`UPDATE ${T.holds} SET status = ${h.status}, reservation_id = ${h.reservationId}, updated_at = now()
          WHERE id = ${h.id}::uuid AND status = ${from} AND expires_at > ${notExpiredAt}`
      : await this.tx.$executeRaw`UPDATE ${T.holds} SET status = ${h.status}, updated_at = now()
          WHERE id = ${h.id}::uuid AND status = ${from}`;
    return n === 1;
  }

  async lockDueHolds(now: Date, flightInstanceIds: string[] | undefined, limit: number): Promise<InventoryHold[]> {
    const ids = flightInstanceIds
      ? await this.tx.$queryRaw<{ id: string }[]>`SELECT h.id FROM ${T.holds} h
          WHERE h.status = 'HELD' AND h.expires_at <= ${now}
            AND EXISTS (SELECT 1 FROM ${T.lines} l WHERE l.hold_id = h.id AND l.flight_instance_id = ANY(${flightInstanceIds}::uuid[]))
          ORDER BY h.expires_at, h.id LIMIT ${limit} FOR UPDATE OF h SKIP LOCKED`
      : await this.tx.$queryRaw<{ id: string }[]>`SELECT h.id FROM ${T.holds} h
          WHERE h.status = 'HELD' AND h.expires_at <= ${now}
          ORDER BY h.expires_at, h.id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    return this.loadHold(ids.map((r) => r.id));
  }

  async insertReserved(h: InventoryHold): Promise<void> {
    await this.tx.reservedInventory.createMany({
      data: h.lines.map((l) => ({
        holdId: h.id, ownerId: h.ownerId, reservationId: h.reservationId, flightInstanceId: l.flightInstanceId, cabinClass: l.cabinClass, seats: l.seats
      }))
    });
  }

  async lockReserved(ref: string, ownerId: string): Promise<ReservedRow[]> {
    const rows = await this.tx.$queryRaw<{ id: string; flight_instance_id: string; cabin_class: string; seats: number }[]>`
      SELECT id, flight_instance_id, cabin_class, seats FROM ${T.reserved}
      WHERE reservation_id = ${ref} AND owner_id = ${ownerId} AND released_at IS NULL
      ORDER BY id FOR UPDATE`;
    return rows.map((r) => ({ id: r.id, flightInstanceId: r.flight_instance_id, cabinClass: r.cabin_class as CabinClass, seats: r.seats }));
  }

  async markReservedReleased(ids: string[], now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.tx.reservedInventory.updateMany({ where: { id: { in: ids }, releasedAt: null }, data: { releasedAt: now } });
  }
}

const RETRYABLE = new Set(['P2002', 'P2034']);
const isRetryable = (e: unknown): boolean => {
  if (e instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE.has(e.code)) return true;
  return e instanceof Error && /deadlock|40P01|could not serialize/i.test(e.message);
};

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaClient, private readonly maxAttempts = 5) {}

  async run<T>(fn: (tx: InventoryTx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction((px) => fn(new PrismaTx(px)), { maxWait: 10_000, timeout: 20_000 });
      } catch (e) {
        if (attempt >= this.maxAttempts || !isRetryable(e)) throw e;
        await new Promise((r) => setTimeout(r, 10 * attempt + Math.random() * 20));
      }
    }
  }
}
