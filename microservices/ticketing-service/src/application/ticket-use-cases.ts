import { RequestContext, requireRole, validate } from '@flight-platform/shared';
import { TicketStore } from './ports';
import { bookingOwner, getTicket, issueTickets, reissueTickets } from './schemas';
import { Ticket } from '../domain/ticket';

export interface TicketingConfig { prefix: string; failMode: 'none' | 'always' | 'first_attempt' }
export class TicketUseCases {
  constructor(private readonly store: TicketStore, private readonly config: TicketingConfig, private readonly now = () => new Date()) {}
  async issue(ctx: RequestContext, input: unknown): Promise<Ticket[]> {
    requireRole(ctx, 'system', 'admin'); const r = validate(issueTickets, input);
    const segments = r.itineraries.flatMap((i) => i.segments.map((s) => s.segmentId));
    return this.store.issue(r.bookingId, r.requestId, r.ownerId, r.passengers, segments, this.config.prefix, this.config.failMode, this.now());
  }
  async list(_ctx: RequestContext, input: unknown): Promise<Ticket[]> { const r = validate(bookingOwner, input); return (await this.store.forBooking(r.bookingId, r.ownerId)) ?? []; }
  async get(_ctx: RequestContext, input: unknown): Promise<Ticket> { const r = validate(getTicket, input); const t = await this.store.get(r.bookingId, r.ticketId, r.ownerId); if (!t) { const { DomainError } = await import('@flight-platform/shared'); throw new DomainError('NOT_FOUND'); } return t; }
  async coupons(ctx: RequestContext, input: unknown): Promise<Ticket[]> { return this.list(ctx, input); }
  async void(ctx: RequestContext, input: unknown): Promise<Ticket[]> { requireRole(ctx, 'system', 'admin'); const r = validate(bookingOwner, input); return this.store.updateAll(r.bookingId, r.ownerId, 'void'); }
  async refund(ctx: RequestContext, input: unknown): Promise<Ticket[]> { requireRole(ctx, 'system', 'admin'); const r = validate(bookingOwner, input); return this.store.updateAll(r.bookingId, r.ownerId, 'refund'); }
  async reissue(ctx: RequestContext, input: unknown): Promise<Ticket[]> { requireRole(ctx, 'system', 'admin'); const r = validate(reissueTickets, input); return this.store.updateAll(r.bookingId, r.ownerId, 'reissue', r.newItineraries.flatMap((i) => i.segments.map((s) => s.segmentId)), this.config.prefix, this.now()); }
}
