import { Prisma, PrismaClient } from './prisma-client/client';
import { DomainError } from '@flight-platform/shared';
import { decodeListCursor, encodeListCursor, ReservationStore, StoredReservation, TERMINAL_STATUSES, utcDayStart, WEB_CHANNEL, WebLimits } from '../../application/reservation-store';

const toStored = (value: { id: string; ownerId: string; pnr: string; status: string; holdId: string; paymentReference: string | null; idempotencyKey: string; passengers: Array<{ data: unknown }>; itineraries: unknown; grandTotal: unknown; changes: Array<{ changedAt: Date; description: string }>; attempts: number; pendingOperation: unknown; paymentChannel?: string | null }): StoredReservation => ({ id: value.id, ownerId: value.ownerId, pnr: value.pnr, status: value.status, holdId: value.holdId, paymentReference: value.paymentReference ?? '', idempotencyKey: value.idempotencyKey, passengers: value.passengers.map((passenger) => passenger.data), itineraries: value.itineraries as unknown[], grandTotal: value.grandTotal as { currency: string; total: string }, changes: value.changes.map((change) => ({ changedAt: change.changedAt.toISOString(), description: change.description })), attempts: value.attempts, ...(value.paymentChannel ? { paymentChannel: value.paymentChannel } : {}), ...(value.pendingOperation ? { pendingOperation: value.pendingOperation as StoredReservation['pendingOperation'] } : {}) });
export class PrismaReservationStore implements ReservationStore {
  constructor(private readonly prisma: PrismaClient) {}
  private include = { passengers: true, changes: { orderBy: { changedAt: 'asc' as const } } };
  async findByIdempotency(ownerId: string, key: string) { const row = await this.prisma.reservation.findUnique({ where: { ownerId_idempotencyKey: { ownerId, idempotencyKey: key } }, include: this.include }); return row ? toStored(row) : undefined; }
  async findByPaymentReference(reference: string) { const usage = await this.prisma.paymentUsage.findUnique({ where: { paymentReference: reference }, include: { reservation: { include: this.include } } }); return usage ? toStored(usage.reservation) : undefined; }
  async claimPaymentReference(reference: string, reservationId: string) { try { await this.prisma.paymentUsage.create({ data: { paymentReference: reference, reservationId } }); } catch (error) { if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') throw new DomainError('PAYMENT_REFERENCE_INVALID'); throw error; } }
  async findByPnr(pnr: string) { const row = await this.prisma.reservation.findUnique({ where: { pnr }, include: this.include }); return row ? toStored(row) : undefined; }
  async findById(ownerId: string, id: string) { const row = await this.prisma.reservation.findFirst({ where: { id, ownerId }, include: this.include }); return row ? toStored(row) : undefined; }
  async findPending(limit: number) { const rows = await this.prisma.reservation.findMany({ where: { status: { in: ['PENDING_PAYMENT', 'TICKET_ISSUING', 'CHANGE_PENDING', 'CANCEL_PENDING'] } }, orderBy: { createdAt: 'asc' }, take: limit, include: this.include }); return rows.map(toStored); }
  /** Más reciente primero; empate por id descendente; cursor compuesto (createdAt, id) — ver `encodeListCursor`. */
  async list(input: { ownerId: string; pnr?: string; status?: string; createdFrom?: string; createdTo?: string; cursor?: string; limit: number }) {
    const after = input.cursor ? decodeListCursor(input.cursor) : undefined;
    if (after && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(after.id)) throw new DomainError('VALIDATION_FAILED'); // la columna es uuid: un id con otra forma es un cursor inventado
    const rows = await this.prisma.reservation.findMany({ where: { ownerId: input.ownerId, ...(input.pnr ? { pnr: input.pnr } : {}), ...(input.status ? { status: input.status } : {}), AND: [...(input.createdFrom || input.createdTo ? [{ createdAt: { ...(input.createdFrom ? { gte: new Date(input.createdFrom) } : {}), ...(input.createdTo ? { lte: new Date(input.createdTo) } : {}) } }] : []), ...(after ? [{ OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }] : [])] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: input.limit + 1, include: this.include });
    const more = rows.length > input.limit; const items = rows.slice(0, input.limit); const last = items.at(-1);
    return { items: items.map(toStored), nextCursor: more && last ? encodeListCursor(last.createdAt, last.id) : undefined };
  }
  async listByFlightInstance(input: { flightInstanceId: string; cursor?: string; limit: number }) { const candidates = await this.prisma.reservation.findMany({ select: { id: true, itineraries: true } }); const ids = candidates.filter((row) => JSON.stringify(row.itineraries).includes(input.flightInstanceId)).map((row) => row.id).sort((left, right) => left < right ? -1 : left > right ? 1 : 0).filter((id) => !input.cursor || id > input.cursor); const pageIds = ids.slice(0, input.limit); const rows = await this.prisma.reservation.findMany({ where: { id: { in: pageIds } }, include: this.include }); const byId = new Map(rows.map((row) => [row.id, row])); return { items: pageIds.map((id) => toStored(byId.get(id)!)), nextCursor: ids.length > input.limit ? pageIds.at(-1) : undefined }; }
  /**
   * Con `limits` (canal WEB, ADR-F12c-03): transacción CORTA con candado transaccional por dueño (`pg_advisory_xact_lock` sobre un hash estable del ownerId; se libera solo
   * al terminar y es compatible con el pooler de Supabase en modo transacción), conteo desde las reservas reales y inserción solo si cabe. Dueños distintos no se bloquean.
   * El candado cubre únicamente el conteo y la inserción, nunca la saga (que ocurre después, sin candado).
   */
  async create(value: StoredReservation, limits?: WebLimits) {
    if (!limits || value.paymentChannel !== WEB_CHANNEL) return this.insert(this.prisma, value);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reservation-web-limits:${value.ownerId}`}, 0))`);
      const mine = { ownerId: value.ownerId, paymentChannel: WEB_CHANNEL };
      const active = await tx.reservation.count({ where: { ...mine, status: { notIn: [...TERMINAL_STATUSES] } } });
      if (active >= limits.maxActiveBookings) throw new DomainError('WEB_ACTIVE_LIMIT_EXCEEDED');
      const today = await tx.reservationPassenger.count({ where: { reservation: { ...mine, status: { not: 'FAILED' }, createdAt: { gte: utcDayStart(new Date()) } } } });
      if (today + value.passengers.length > limits.maxPassengersPerDay) throw new DomainError('WEB_PASSENGERS_LIMIT_EXCEEDED');
      return this.insert(tx, value);
    }, { maxWait: 10_000, timeout: 15_000 });
  }
  private async insert(client: Pick<PrismaClient, 'reservation'>, value: StoredReservation) { const row = await client.reservation.create({ data: { id: value.id, ownerId: value.ownerId, pnr: value.pnr, status: value.status, holdId: value.holdId, paymentReference: value.paymentReference, idempotencyKey: value.idempotencyKey, sagaStep: value.status, attempts: value.attempts, itineraries: value.itineraries as never, grandTotal: value.grandTotal as never, pendingOperation: value.pendingOperation as never, ...(value.paymentChannel ? { paymentChannel: value.paymentChannel } : {}), passengers: { create: value.passengers.map((data, index) => ({ passengerId: (data as { passengerId?: string }).passengerId ?? `p-${index}`, data: data as never })) }, changes: { create: value.changes.map((change) => ({ changedAt: new Date(change.changedAt), description: change.description })) }, paymentUsages: { create: { paymentReference: value.paymentReference } } }, include: this.include }); return toStored(row); }
  async update(value: StoredReservation) { const row = await this.prisma.reservation.update({ where: { id: value.id }, data: { status: value.status, holdId: value.holdId, itineraries: value.itineraries as never, grandTotal: value.grandTotal as never, attempts: value.attempts, sagaStep: value.status, pendingOperation: value.pendingOperation as never, changes: { deleteMany: {}, create: value.changes.map((change) => ({ changedAt: new Date(change.changedAt), description: change.description })) } }, include: this.include }); return toStored(row); }
}
