import { DomainError } from '@flight-platform/shared';
import { AncillariesPort, EventPublisher, HoldDetails, InventoryPort, PaymentResult, PaymentVerifier, PricingPort, TicketingPort } from '../../application/ports';

export class FakePaymentVerifier implements PaymentVerifier {
  readonly voided: string[] = [];
  async verify(input: { paymentReference: string }): Promise<PaymentResult> {
    if (input.paymentReference.startsWith('pay_ok_')) return 'AUTHORIZED';
    if (input.paymentReference.startsWith('pay_pending_')) return 'PENDING';
    if (input.paymentReference.startsWith('pay_invalid_')) throw new DomainError('PAYMENT_REFERENCE_INVALID');
    if (input.paymentReference.startsWith('pay_denied_')) throw new DomainError('PAYMENT_NOT_AUTHORIZED');
    if (input.paymentReference.startsWith('pay_mismatch_')) throw new DomainError('AMOUNT_MISMATCH');
    throw new DomainError('PAYMENT_REFERENCE_INVALID');
  }
  async void(input: { paymentReference: string }): Promise<void> { this.voided.push(input.paymentReference); }
}
export class FakePricingPort implements PricingPort {
  readonly holds = new Map<string, HoldDetails>();
  async getHold(input: { holdId: string; ownerId: string }): Promise<HoldDetails> {
    const hold = this.holds.get(input.holdId);
    if (!hold || hold.ownerId !== input.ownerId) throw new DomainError('NOT_FOUND');
    return hold;
  }
}
export class FakeInventoryPort implements InventoryPort { async consumeHold(): Promise<void> {} async releaseReservedInventory(): Promise<void> {} }
export class FakeAncillariesPort implements AncillariesPort {
  readonly released: Array<{ bookingId: string; ownerId: string }> = [];
  async reserveSeats(): Promise<void> {} async reserveBaggage(): Promise<void> {} async confirmSeats(): Promise<void> {} async releaseAll(input: { bookingId: string; ownerId: string }): Promise<void> { this.released.push(input); }
  async getAssignments(): Promise<unknown[]> { return []; } async getBaggageOptions(): Promise<unknown[]> { return []; }
}
export class FakeTicketingPort implements TicketingPort { failAlways = false; readonly voided: Array<{ bookingId: string; ownerId: string }> = []; tickets: Array<{ status: string }> = []; async issueTickets(): Promise<unknown[]> { if (this.failAlways) throw new Error('ticketing failed'); return this.tickets; } async voidTickets(input: { bookingId: string; ownerId: string }): Promise<void> { this.voided.push(input); this.tickets = this.tickets.map((ticket) => ({ ...ticket, status: 'VOIDED' })); } async listTickets(): Promise<unknown[]> { return this.tickets; } }
export class FakeEventPublisher implements EventPublisher { readonly events: unknown[] = []; async publish(input: unknown): Promise<void> { this.events.push(input); } }
