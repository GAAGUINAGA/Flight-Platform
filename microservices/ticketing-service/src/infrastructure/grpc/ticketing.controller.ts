import { Controller, Inject } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { Metadata } from '@grpc/grpc-js';
import { requestContextFromMetadata, RequestContext } from '@flight-platform/shared';
import { TicketUseCases } from '../../application/ticket-use-cases';
import { Ticket } from '../../domain/ticket';
export const TICKETING_DEPS = Symbol('TICKETING_DEPS');
const ctx = (m: Metadata) => requestContextFromMetadata(m) as RequestContext;
export const dto = (ticket: Ticket) => { const p = ticket.props; return { ticketId: p.id, bookingId: p.bookingId, passengerId: p.passengerId, ...(p.eTicketNumber ? { eTicketNumber: p.eTicketNumber } : {}), status: p.status, ...(p.issuedAt ? { issuedAt: p.issuedAt.toISOString() } : {}), segments: p.coupons.map((c) => ({ segmentId: c.segmentId, status: c.status, ...(c.couponNumber ? { couponNumber: c.couponNumber } : {}) })), ...(p.failureReason ? { failureReason: p.failureReason } : {}) }; };
@Controller()
export class TicketingController {
  constructor(private readonly useCases: TicketUseCases) {}
  async issueTickets(data: unknown, metadata: Metadata) { const tickets = await this.useCases.issue(ctx(metadata), data); const bookingId = (data as { bookingId: string }).bookingId; return { bookingId, tickets: tickets.map(dto) }; }
  async voidTickets(data: unknown, metadata: Metadata) { const tickets = await this.useCases.void(ctx(metadata), data); return { bookingId: (data as { bookingId: string }).bookingId, tickets: tickets.map(dto) }; }
  async refundTickets(data: unknown, metadata: Metadata) { const tickets = await this.useCases.refund(ctx(metadata), data); return { bookingId: (data as { bookingId: string }).bookingId, tickets: tickets.map(dto) }; }
  async reissueTickets(data: unknown, metadata: Metadata) { const tickets = await this.useCases.reissue(ctx(metadata), data); return { bookingId: (data as { bookingId: string }).bookingId, tickets: tickets.map(dto) }; }
  async listTickets(data: unknown, metadata: Metadata) { const tickets = await this.useCases.list(ctx(metadata), data); return { bookingId: (data as { bookingId: string }).bookingId, tickets: tickets.map(dto) }; }
  async getTicket(data: unknown, metadata: Metadata) { return dto(await this.useCases.get(ctx(metadata), data)); }
  async getCouponsForBooking(data: unknown, metadata: Metadata) { const tickets = await this.useCases.coupons(ctx(metadata), data); return { coupons: tickets.flatMap((t) => t.props.coupons.map((c) => ({ ticketId: t.props.id, passengerId: t.props.passengerId, segmentId: c.segmentId, couponNumber: c.couponNumber ?? '', status: c.status }))) }; }
}
for (const [rpc, key] of Object.entries({ IssueTickets: 'issueTickets', VoidTickets: 'voidTickets', RefundTickets: 'refundTickets', ReissueTickets: 'reissueTickets', ListTickets: 'listTickets', GetTicket: 'getTicket', GetCouponsForBooking: 'getCouponsForBooking' } as const)) {
  const d = Object.getOwnPropertyDescriptor(TicketingController.prototype, key)!; GrpcMethod('TicketingService', rpc)(TicketingController.prototype, key, d);
}
Inject(TICKETING_DEPS)(TicketingController, undefined as unknown as string, 0);
