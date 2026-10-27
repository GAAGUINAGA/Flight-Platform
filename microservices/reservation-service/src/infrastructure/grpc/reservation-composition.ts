import { Clock } from '@flight-platform/shared';
import { AncillariesPort, EventPublisher, InventoryPort, PaymentVerifier, PricingPort, TicketingPort } from '../../application/ports';
import { BaggageOperations } from '../../application/baggage-operations';
import { PostSaleBaggage, ResponseValidator } from '../../application/post-sale-baggage';
import { CreateReservation } from '../../application/create-reservation';
import { ReservationQueries } from '../../application/queries';
import { ResumePending } from '../../application/resume-pending';
import { FailReservation } from '../../application/fail-reservation';
import { ReservationStore } from '../../application/reservation-store';
import { ReservationHandlers } from './reservation.controller';
import { SearchDateChange } from '../../application/post-sale-date-change';
import { ConfirmDateChange } from '../../application/confirm-date-change';
import { CancellationQuotes } from '../../application/cancellation-quotes';
import { PostSaleCancellation } from '../../application/post-sale-cancellation';

export function composeReservation(input: { store: ReservationStore; pricing: PricingPort; payment: PaymentVerifier; ancillaries: AncillariesPort; inventory: InventoryPort; ticketing: TicketingPort; events: EventPublisher; operations: BaggageOperations; quotes: CancellationQuotes; clock: Clock; cutoffHours: number; holdTtlMinutes: number; validateResponse: ResponseValidator }): ReservationHandlers {
  const { store, pricing, payment, ancillaries, inventory, ticketing, events } = input;
  const create = new CreateReservation(store, pricing, payment, ancillaries, inventory, ticketing, events);
  const queries = new ReservationQueries(store, ancillaries, ticketing);
  const resume = new ResumePending(store, payment, events, ancillaries, inventory, ticketing, pricing);
  const fail = new FailReservation(store, payment, events, ancillaries, inventory, ticketing, pricing);
  const baggage = new PostSaleBaggage(store, ancillaries, payment, input.operations, events, input.clock, input.cutoffHours, input.validateResponse);
  const dateChange = new SearchDateChange(store, pricing, () => input.clock.now(), input.validateResponse);
  const confirmChange = new ConfirmDateChange(store, pricing, payment, inventory, ancillaries, ticketing, events, input.clock, input.holdTtlMinutes);
  const cancellation = new PostSaleCancellation(store, pricing, input.quotes, payment, inventory, ancillaries, ticketing, events, input.clock, input.validateResponse);
  return { createReservation: (value) => create.execute(value as never), getReservation: (value) => queries.get(value as never), listReservations: (value) => queries.list(value as never), getReservationSnapshot: (value) => queries.get(value as never), listReservationsByFlightInstance: (value) => queries.byFlightInstance(value as never), getBaggageOptions: (value) => baggage.options(value as never), addBaggage: (value) => baggage.add(value as never), searchDateChange: (value) => dateChange.execute(value as never), confirmDateChange: async (value) => { const inputValue = value as { ownerId: string; bookingId: string }; await confirmChange.execute(value as never); const result = await queries.get(inputValue); input.validateResponse('BookingDetail', result); return result; }, getCancellationQuote: (value) => cancellation.quote(value as never), cancelReservation: async (value) => { const inputValue = value as { ownerId: string; bookingId: string }; await cancellation.cancel(value as never); const result = await queries.get(inputValue); input.validateResponse('BookingDetail', result); return result; }, resumePending: (value) => resume.execute(value as never), failReservation: async (value) => { const inputValue = value as { ownerId: string; bookingId: string }; await fail.execute(value as never); const result = await queries.get(inputValue); input.validateResponse('BookingDetail', result); return result; }, resumeReservation: async (value) => { const inputValue = value as { ownerId: string; bookingId: string }; await resume.resumeOne(inputValue); const result = await queries.get(inputValue); input.validateResponse('BookingDetail', result); return result; } };
}
