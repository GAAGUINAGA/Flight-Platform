import { Ticket } from '../../src/domain/ticket';
import { DomainError } from '@flight-platform/shared';
const make = () => new Ticket({ id: 't', bookingId: 'b', ownerId: 'o', passengerId: 'p', status: 'PENDING', coupons: [{ segmentId: 's', status: 'PENDING' }] });
describe('Ticket state machine (TKT-03)', () => {
  it('issues exactly once and assigns its coupon', () => { const t = make(); t.start(); t.issue('9990000000001', new Date('2026-01-01Z')); expect(t.props.status).toBe('ISSUED'); expect(t.props.coupons[0]).toMatchObject({ status: 'ISSUED', couponNumber: '9990000000001-1' }); expect(() => t.start()).toThrow(DomainError); });
  it('allows only issued tickets to void or refund', () => { const t = make(); expect(() => t.void()).toThrow(DomainError); t.start(); t.issue('9990000000001', new Date()); t.void(); expect(t.props.status).toBe('VOIDED'); expect(() => t.refund()).toThrow(DomainError); });
  it('marks failed issuance and permits a controlled retry', () => { const t = make(); t.start(); t.fail('TICKET_ISSUANCE_FAILED'); expect(t.props.coupons[0].status).toBe('FAILED'); t.retryFailed('9990000000002', new Date()); expect(t.props.status).toBe('ISSUED'); });
});
