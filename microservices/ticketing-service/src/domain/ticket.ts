import { DomainError } from '@flight-platform/shared';

export const TICKET_STATUSES = ['PENDING', 'ISSUING', 'ISSUED', 'FAILED', 'VOIDED', 'REFUNDED'] as const;
export const COUPON_STATUSES = ['PENDING', 'ISSUED', 'FAILED'] as const;
export type TicketStatus = typeof TICKET_STATUSES[number];
export type CouponStatus = typeof COUPON_STATUSES[number];

export interface CouponProps { segmentId: string; couponNumber?: string; status: CouponStatus }
export interface TicketProps {
  id: string; bookingId: string; ownerId: string; passengerId: string; status: TicketStatus;
  eTicketNumber?: string; issuedAt?: Date; failureReason?: string; coupons: CouponProps[];
}

export class Ticket {
  constructor(private state: TicketProps) {}
  get props(): Readonly<TicketProps> { return this.state; }
  start(): void { if (this.state.status !== 'PENDING') throw new DomainError('TICKET_ALREADY_ISSUED'); this.state = { ...this.state, status: 'ISSUING' }; }
  issue(number: string, now: Date): void {
    if (this.state.status !== 'ISSUING') throw new DomainError('TICKET_ALREADY_ISSUED');
    this.state = { ...this.state, status: 'ISSUED', eTicketNumber: number, issuedAt: now, failureReason: undefined,
      coupons: this.state.coupons.map((c, i) => ({ ...c, status: 'ISSUED', couponNumber: `${number}-${i + 1}` })) };
  }
  fail(reason: string): void { if (this.state.status !== 'ISSUING') throw new DomainError('TICKET_ALREADY_ISSUED'); this.state = { ...this.state, status: 'FAILED', failureReason: reason, coupons: this.state.coupons.map((c) => ({ ...c, status: 'FAILED' })) }; }
  retryFailed(number: string, now: Date): void { if (this.state.status !== 'FAILED') throw new DomainError('TICKET_ALREADY_ISSUED'); this.state = { ...this.state, status: 'ISSUING' }; this.issue(number, now); }
  void(): void { if (this.state.status !== 'ISSUED') throw new DomainError('TICKET_ALREADY_ISSUED'); this.state = { ...this.state, status: 'VOIDED' }; }
  refund(): void { if (this.state.status !== 'ISSUED' || this.state.coupons.some((c) => c.status !== 'ISSUED')) throw new DomainError('TICKET_ALREADY_ISSUED'); this.state = { ...this.state, status: 'REFUNDED' }; }
}
