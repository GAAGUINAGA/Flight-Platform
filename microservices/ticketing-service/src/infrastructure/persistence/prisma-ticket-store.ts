import { Prisma, PrismaClient } from './prisma-client/client';
import { DomainError } from '@flight-platform/shared';
import { Ticket, TicketProps } from '../../domain/ticket';
import { TicketStore } from '../../application/ports';

type Db = PrismaClient | Prisma.TransactionClient;
type Row = Prisma.TicketGetPayload<{ include: { coupons: true } }>;
const asTicket = (r: Row): Ticket => new Ticket({ id: r.id, bookingId: r.bookingId, ownerId: r.ownerId, passengerId: r.passengerId, status: r.status as TicketProps['status'], eTicketNumber: r.eTicketNumber ?? undefined, issuedAt: r.issuedAt ?? undefined, failureReason: r.failureReason ?? undefined, coupons: r.coupons.map((c) => ({ segmentId: c.segmentId, couponNumber: c.couponNumber ?? undefined, status: c.status as TicketProps['coupons'][number]['status'] })) });
const rows = (db: Db, bookingId: string, ownerId: string) => db.ticket.findMany({ where: { bookingId, ownerId }, include: { coupons: { orderBy: { segmentId: 'asc' } } }, orderBy: { passengerId: 'asc' } });

export class PrismaTicketStore implements TicketStore {
  constructor(private readonly prisma: PrismaClient) {}
  async issue(bookingId: string, requestId: string, ownerId: string, passengers: Array<{ passengerId: string }>, segmentIds: string[], prefix: string, failMode: string, now: Date): Promise<Ticket[]> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.issuanceRequest.findUnique({ where: { bookingId_requestId: { bookingId, requestId } } });
        if (existing) return (await rows(tx, bookingId, ownerId)).map(asTicket);
        await tx.issuanceRequest.create({ data: { bookingId, requestId } });
        const prior = await rows(tx, bookingId, ownerId);
        if (prior.some((t) => t.status === 'ISSUED')) throw new DomainError('TICKET_ALREADY_ISSUED');
        const failed = failMode === 'always' || (failMode === 'first_attempt' && prior.length === 0);
        for (const p of passengers) {
          let ticket = await tx.ticket.findFirst({ where: { bookingId, passengerId: p.passengerId }, orderBy: { createdAt: 'desc' } });
          if (ticket?.status === 'VOIDED' || ticket?.status === 'REFUNDED') ticket = null;
          if (!ticket) ticket = await tx.ticket.create({ data: { bookingId, ownerId, passengerId: p.passengerId, status: 'PENDING', coupons: { create: segmentIds.map((segmentId) => ({ segmentId, status: 'PENDING' })) } } });
          if (ticket.status === 'ISSUED') throw new DomainError('TICKET_ALREADY_ISSUED');
          if (failed) { await tx.ticket.update({ where: { id: ticket.id }, data: { status: 'FAILED', failureReason: 'TICKET_ISSUANCE_FAILED', coupons: { updateMany: { where: {}, data: { status: 'FAILED' } } } } }); continue; }
          const sequence = await tx.$queryRaw<{ value: bigint }[]>`INSERT INTO ticketing.ticket_sequences (prefix, value) VALUES (${prefix}, 1) ON CONFLICT (prefix) DO UPDATE SET value = ticketing.ticket_sequences.value + 1 RETURNING value`;
          const number = `${prefix}${String(sequence[0].value).padStart(10, '0')}`;
          await tx.ticket.update({ where: { id: ticket.id }, data: { status: 'ISSUED', eTicketNumber: number, issuedAt: now, failureReason: null, coupons: { updateMany: { where: {}, data: { status: 'ISSUED' } } } } });
          const coupons = await tx.ticketCoupon.findMany({ where: { ticketId: ticket.id }, orderBy: { segmentId: 'asc' } });
          await Promise.all(coupons.map((c, i) => tx.ticketCoupon.update({ where: { id: c.id }, data: { couponNumber: `${number}-${i + 1}` } })));
        }
        return (await rows(tx, bookingId, ownerId)).map(asTicket);
      }, { maxWait: 10_000, timeout: 30_000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return ((await rows(this.prisma, bookingId, ownerId)).map(asTicket));
      throw e;
    }
  }
  async forBooking(bookingId: string, ownerId: string): Promise<Ticket[] | null> { return (await rows(this.prisma, bookingId, ownerId)).map(asTicket); }
  async get(bookingId: string, ticketId: string, ownerId: string): Promise<Ticket | null> { const r = await this.prisma.ticket.findFirst({ where: { id: ticketId, bookingId, ownerId }, include: { coupons: true } }); return r ? asTicket(r) : null; }
  async updateAll(bookingId: string, ownerId: string, action: 'void' | 'refund' | 'reissue', segmentIds?: string[], prefix = '999', now = new Date()): Promise<Ticket[]> {
    return this.prisma.$transaction(async (tx) => {
      const all = await rows(tx, bookingId, ownerId); if (!all.length) throw new DomainError('NOT_FOUND');
      const current = all.filter((r) => r.status === 'ISSUED'); if (!current.length) throw new DomainError('TICKET_ALREADY_ISSUED');
      for (const r of current) { const t = asTicket(r); if (action === 'void' || action === 'reissue') t.void(); else t.refund(); await tx.ticket.update({ where: { id: r.id }, data: { status: t.props.status } }); }
      if (action === 'reissue') {
        if (!segmentIds?.length) throw new DomainError('VALIDATION_FAILED');
        for (const old of current) {
          const sequence = await tx.$queryRaw<{ value: bigint }[]>`INSERT INTO ticketing.ticket_sequences (prefix, value) VALUES (${prefix}, 1) ON CONFLICT (prefix) DO UPDATE SET value = ticketing.ticket_sequences.value + 1 RETURNING value`;
          const number = `${prefix}${String(sequence[0].value).padStart(10, '0')}`;
          await tx.ticket.create({ data: { bookingId, ownerId, passengerId: old.passengerId, status: 'ISSUED', eTicketNumber: number, issuedAt: now, coupons: { create: segmentIds.map((segmentId, index) => ({ segmentId, status: 'ISSUED', couponNumber: `${number}-${index + 1}` })) } } });
        }
      }
      return (await rows(tx, bookingId, ownerId)).map(asTicket);
    });
  }
}
