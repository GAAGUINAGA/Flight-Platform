import { randomUUID } from 'node:crypto';
import { Clock, RequestContext, requireRole, validate } from '@flight-platform/shared';
import { CabinClass } from '../domain/cabin';
import { InventoryError } from '../domain/errors';
import { InventoryHold } from '../domain/inventory-hold';
import { assertOwner } from './authz';
import { expireDue } from './expire-due';
import { EventPublisher, ExpiredHold, InventoryConfig, UnitOfWork } from './ports';
import { publishExpired } from './publish-expired';
import { consumeHoldRequest, createHoldRequest, emptyRequest, holdRefRequest, releaseReservedRequest } from './schemas';

export interface HoldView { hold: InventoryHold; status: string }

interface Line { flightInstanceId: string; cabinClass: CabinClass; seats: number }

export class HoldUseCases {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
    private readonly config: InventoryConfig
  ) {}

  private view(hold: InventoryHold, now: Date): HoldView {
    return { hold, status: hold.effectiveStatus(now) };
  }

  async create(ctx: RequestContext, input: unknown): Promise<HoldView> {
    const req = validate(createHoldRequest, input);
    assertOwner(ctx, req.ownerId);
    const now = this.clock.now();
    const maxExpiry = new Date(now.getTime() + this.config.holdTtlMinutes * 60_000);
    const requested = req.expiresAt ? new Date(req.expiresAt) : maxExpiry;
    const expiresAt = requested < maxExpiry ? requested : maxExpiry;
    if (expiresAt <= now) throw new InventoryError('VALIDATION_FAILED');

    const merged = new Map<string, Line>();
    for (const s of req.segments) {
      const key = `${s.flightInstanceId}|${s.cabinClass}`;
      const line = merged.get(key) ?? { flightInstanceId: s.flightInstanceId, cabinClass: s.cabinClass, seats: 0 };
      line.seats += s.seats;
      merged.set(key, line);
    }
    const lines = [...merged.keys()].sort().map((k) => merged.get(k) as Line);
    if (lines.some((l) => l.seats > 9)) throw new InventoryError('VALIDATION_FAILED');
    const flightIds = [...new Set(lines.map((l) => l.flightInstanceId))];

    const { hold, expired } = await this.uow.run(async (tx) => {
      const existing = await tx.findHoldByKey(req.ownerId, req.idempotencyKey);
      if (existing) return { hold: existing, expired: [] as ExpiredHold[] };
      const flights = await tx.getFlights(flightIds);
      if (flights.length !== flightIds.length) throw new InventoryError('NOT_FOUND');
      flights.forEach((f) => f.assertSellable(now));
      const expiredNow = await expireDue(tx, now, flightIds);
      for (const line of lines) {
        if (!(await tx.tryReserve(line.flightInstanceId, line.cabinClass, line.seats))) {
          throw new InventoryError('OFFER_NO_LONGER_AVAILABLE');
        }
      }
      const created = new InventoryHold({
        id: randomUUID(), ownerId: req.ownerId, status: 'HELD', expiresAt,
        idempotencyKey: req.idempotencyKey, lines
      });
      await tx.insertHold(created);
      return { hold: created, expired: expiredNow };
    });
    await publishExpired(this.events, expired, now, ctx.correlationId);
    return this.view(hold, now);
  }

  async get(ctx: RequestContext, input: unknown): Promise<HoldView> {
    const req = validate(holdRefRequest, input);
    assertOwner(ctx, req.ownerId);
    const hold = await this.uow.run((tx) => tx.findHold(req.holdId, req.ownerId));
    if (!hold) throw new InventoryError('NOT_FOUND');
    return this.view(hold, this.clock.now());
  }

  /** Idempotente para holds ya liberados o vencidos; un CONSUMED falla (GAP-011). */
  async release(ctx: RequestContext, input: unknown): Promise<HoldView> {
    const req = validate(holdRefRequest, input);
    assertOwner(ctx, req.ownerId);
    const now = this.clock.now();
    const { hold, expired } = await this.uow.run(async (tx) => {
      const found = await tx.findHold(req.holdId, req.ownerId);
      if (!found) throw new InventoryError('NOT_FOUND');
      const changed = found.release(now);
      if (changed) {
        if (!(await tx.updateHoldStatus(found, 'HELD'))) throw new InventoryError('OFFER_NO_LONGER_AVAILABLE');
        for (const line of found.lines) await tx.adjust('release', line.flightInstanceId, line.cabinClass, line.seats);
      }
      const due: ExpiredHold[] = changed && found.status === 'EXPIRED' ? [{ holdId: found.id, ownerId: found.ownerId }] : [];
      return { hold: found, expired: due };
    });
    await publishExpired(this.events, expired, now, ctx.correlationId);
    return this.view(hold, now);
  }

  /**
   * Consume un hold vigente para `reservationId`: held ? sold y registra la reserva.
   * Idempotente por reserva; un hold vencido se expira y falla.
   */
  async consume(ctx: RequestContext, input: unknown): Promise<HoldView> {
    const req = validate(consumeHoldRequest, input);
    assertOwner(ctx, req.ownerId);
    const now = this.clock.now();
    const outcome = await this.uow.run(async (tx) => {
      const hold = await tx.findHold(req.holdId, req.ownerId);
      if (!hold) throw new InventoryError('NOT_FOUND');
      if (hold.isConsumedBy(req.reservationId)) return { hold, expired: [] as ExpiredHold[] };
      if (hold.isDue(now)) {
        hold.expire(now);
        await tx.updateHoldStatus(hold, 'HELD');
        for (const line of hold.lines) await tx.adjust('release', line.flightInstanceId, line.cabinClass, line.seats);
        return { hold, expired: [{ holdId: hold.id, ownerId: hold.ownerId }] };
      }
      hold.consume(now, req.reservationId);
      if (!(await tx.updateHoldStatus(hold, 'HELD', now))) throw new InventoryError('OFFER_NO_LONGER_AVAILABLE');
      for (const line of hold.lines) await tx.adjust('consume', line.flightInstanceId, line.cabinClass, line.seats);
      await tx.insertReserved(hold);
      return { hold, expired: [] as ExpiredHold[] };
    });
    await publishExpired(this.events, outcome.expired, now, ctx.correlationId);
    if (outcome.hold.status !== 'CONSUMED') throw new InventoryError('OFFER_NO_LONGER_AVAILABLE');
    return this.view(outcome.hold, now);
  }

  /** Restituye el inventario vendido de un hold consumido. Idempotente. */
  async releaseReserved(ctx: RequestContext, input: unknown): Promise<void> {
    const req = validate(releaseReservedRequest, input);
    assertOwner(ctx, req.ownerId);
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      const rows = await tx.lockReserved(req.bookingId, req.ownerId);
      const sorted = [...rows].sort((a, b) =>
        `${a.flightInstanceId}|${a.cabinClass}`.localeCompare(`${b.flightInstanceId}|${b.cabinClass}`)
      );
      for (const row of sorted) await tx.adjust('releaseSold', row.flightInstanceId, row.cabinClass, row.seats);
      await tx.markReservedReleased(rows.map((r) => r.id), now);
    });
  }

  /** Mantenimiento (rol `system`): barrido de holds vencidos. */
  async expireHolds(ctx: RequestContext, input: unknown): Promise<number> {
    requireRole(ctx, 'system');
    validate(emptyRequest, input);
    const now = this.clock.now();
    const expired = await this.uow.run((tx) => expireDue(tx, now));
    await publishExpired(this.events, expired, now, ctx.correlationId);
    return expired.length;
  }
}
