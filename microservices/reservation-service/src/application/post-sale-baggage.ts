import { createHash, randomUUID } from 'node:crypto';
import { Clock, decimalToMinor, DomainError, minorToDecimal } from '@flight-platform/shared';
import { assertPostSaleEligible, PostSaleItinerary } from '../domain/post-sale-eligibility';
import { AncillariesPort, EventPublisher, PaymentVerifier } from './ports';
import { BaggageOperation, BaggageOperations, BaggageResult } from './baggage-operations';
import { eventExtra } from './allocation';
import { ReservationStore, StoredReservation } from './reservation-store';

type Itinerary = PostSaleItinerary & { itineraryId: string; pricingOptions: Array<{ extraCheckedBaggagePrice?: { currency: string; total: string } }> };
type Option = { passengerId: string; itineraryId: string; maxAllowed: number; alreadyPurchased: number; checkedBaggageIncluded: number };
type Input = { bookingId: string; ownerId: string; passengerId: string; itineraryId: string; quantity: number; payment: { paymentReference: string }; idempotencyKey: string; paymentChannel?: string };
export type ResponseValidator = (schema: 'BaggageOptionsResponse' | 'BaggageAddedResponse' | 'DateChangeSearchResponse' | 'CancellationQuoteResponse' | 'BookingDetail', value: unknown) => void;

export class PostSaleBaggage {
  constructor(private readonly reservations: ReservationStore, private readonly ancillaries: AncillariesPort, private readonly payments: PaymentVerifier, private readonly operations: BaggageOperations, private readonly events: EventPublisher, private readonly clock: Clock, private readonly cutoffHours: number, private readonly validateResponse: ResponseValidator) {}

  private async owned(input: { bookingId: string; ownerId: string }): Promise<StoredReservation> {
    const booking = await this.reservations.findById(input.ownerId, input.bookingId);
    if (!booking) throw new DomainError('NOT_FOUND');
    return booking;
  }
  private eligible(booking: StoredReservation): Itinerary[] {
    const itineraries = booking.itineraries as Itinerary[];
    assertPostSaleEligible(booking.status, itineraries, this.clock.now());
    return itineraries;
  }
  private price(itinerary: Itinerary): { currency: string; total: string } {
    if (itinerary.pricingOptions.length !== 1 || !itinerary.pricingOptions[0].extraCheckedBaggagePrice) throw new DomainError('VALIDATION_FAILED');
    return itinerary.pricingOptions[0].extraCheckedBaggagePrice;
  }
  async options(input: { bookingId: string; ownerId: string }) {
    const booking = await this.owned(input); const itineraries = this.eligible(booking);
    const rows = await this.ancillaries.getBaggageOptions(input) as Option[];
    const result = rows.map((row) => {
      const itinerary = itineraries.find((value) => value.itineraryId === row.itineraryId);
      const passenger = booking.passengers.find((value) => (value as { passengerId?: string }).passengerId === row.passengerId) as { passengerType?: string } | undefined;
      if (!itinerary || !passenger) throw new DomainError('VALIDATION_FAILED');
      return { passengerId: row.passengerId, itineraryId: row.itineraryId, price: this.price(itinerary), maxAllowed: passenger.passengerType === 'INFANT' ? 0 : row.maxAllowed, alreadyPurchased: row.alreadyPurchased };
    });
    this.validateResponse('BaggageOptionsResponse', result);
    return result;
  }
  async add(input: Input): Promise<BaggageResult> {
    const booking = await this.owned(input);
    const hash = createHash('sha256').update(JSON.stringify([input.bookingId, input.passengerId, input.itineraryId, input.quantity, input.payment.paymentReference])).digest('hex');
    let operation = await this.operations.find(input.ownerId, input.idempotencyKey);
    if (operation && operation.requestHash !== hash) throw new DomainError('VALIDATION_FAILED');
    if (!operation) {
      const itineraries = this.eligible(booking);
      const itinerary = itineraries.find((value) => value.itineraryId === input.itineraryId);
      if (!itinerary) throw new DomainError('VALIDATION_FAILED');
      const departure = Math.min(...itinerary.segments.map((segment) => Date.parse(segment.departure.at)));
      if (departure - this.clock.now().getTime() <= this.cutoffHours * 3600000) throw new DomainError('CUTOFF_PASSED');
      const option = (await this.options(input)).find((value) => value.passengerId === input.passengerId && value.itineraryId === input.itineraryId);
      if (!option) throw new DomainError('NOT_FOUND');
      if (input.quantity > option.maxAllowed) throw new DomainError('BAGGAGE_LIMIT_EXCEEDED');
      const amountMinor = decimalToMinor(option.price.total) * input.quantity;
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > 2147483647) throw new DomainError('VALIDATION_FAILED');
      const payment = await this.payments.verify({ paymentReference: input.payment.paymentReference, currency: option.price.currency, total: minorToDecimal(amountMinor), ...(input.paymentChannel ? { channel: input.paymentChannel } : {}) });
      if (payment !== 'AUTHORIZED') throw new DomainError('PAYMENT_NOT_AUTHORIZED');
      operation = await this.operations.claim({ id: randomUUID(), bookingId: input.bookingId, ownerId: input.ownerId, idempotencyKey: input.idempotencyKey, requestHash: hash, paymentReference: input.payment.paymentReference, amountMinor, status: 'PENDING' });
    }
    const saved: BaggageOperation = operation;
    const result = await this.operations.complete(saved, this.clock.now(), async () => {
      const purchased = await this.ancillaries.purchaseBaggage({ bookingId: input.bookingId, ownerId: input.ownerId, passengerId: input.passengerId, itineraryId: input.itineraryId, quantity: input.quantity, operationId: saved.id });
      this.validateResponse('BaggageAddedResponse', purchased);
      await this.events.publish({ ownerId: input.ownerId, bookingId: input.bookingId, pnr: booking.pnr, status: booking.status, eventType: 'booking.baggage_added', eventId: saved.id, extra: eventExtra(booking, { changeType: 'BAGGAGE', amountCharged: { currency: booking.grandTotal.currency, total: minorToDecimal(saved.amountMinor) }, paymentReference: saved.paymentReference }) });
      return purchased;
    });
    this.validateResponse('BaggageAddedResponse', result);
    return result;
  }
}
