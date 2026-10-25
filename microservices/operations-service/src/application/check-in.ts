import { randomUUID } from 'node:crypto';
import { DomainError, validate } from '@flight-platform/shared';
import { z } from 'zod';
import { completedStatus } from '../domain/check-in';
import { EventPublisher, FlightStore } from './ports';
import { CheckInReservationGateway, CheckInResult, CheckInSeatGateway, CheckInStore, CheckInTicketingGateway } from './check-in-ports';
import { assertCheckInWindow } from './check-in-window';

const requestSchema = z.object({ bookingId: z.string().uuid(), ownerId: z.string().trim().min(1).max(128) }).strict();

export class CheckInUseCase {
  constructor(
    private readonly reservations: CheckInReservationGateway,
    private readonly tickets: CheckInTicketingGateway,
    private readonly seats: CheckInSeatGateway,
    private readonly flights: FlightStore,
    private readonly store: CheckInStore,
    private readonly events: EventPublisher,
    private readonly now: () => Date,
    private readonly openHours: number,
    private readonly closeMinutes: number
  ) {}

  async execute(input: unknown): Promise<CheckInResult> {
    const request = validate(requestSchema, input);
    const snapshot = await this.reservations.getSnapshot(request.ownerId, request.bookingId);
    if (snapshot.bookingId !== request.bookingId) throw new DomainError('NOT_FOUND');
    if (snapshot.status !== 'CONFIRMED') throw new DomainError('BOOKING_NOT_CONFIRMED');
    const prior = await this.store.find(request.ownerId, request.bookingId);
    if (prior && !prior.result) throw new DomainError('CHECK_IN_NOT_AVAILABLE');
    const hasCheckedIn = (result: CheckInResult) => result.checkedInPassengers.some((passenger) => passenger.segments.some((segment) => segment.status === 'CHECKED_IN'));
    if (prior?.result && !prior.result.checkedInPassengers.some((passenger) => passenger.segments.some((segment) => segment.status === 'NOT_CHECKED_IN'))) {
      if (hasCheckedIn(prior.result) && !prior.eventPublished) {
        await this.events.publish({ ownerId: request.ownerId, bookingId: request.bookingId, pnr: snapshot.pnr, eventType: 'booking.checked_in', occurredAt: this.now().toISOString() });
        await this.store.markEventPublished(request.ownerId, request.bookingId);
      }
      return prior.result;
    }
    const segments = snapshot.itineraries.flatMap((itinerary) => itinerary.segments.map((segment) => ({ segment, pricingOptions: itinerary.pricingOptions })));
    if (!segments.length || !snapshot.passengers.length) throw new DomainError('CHECK_IN_NOT_AVAILABLE');
    const eligible = new Set<string>();
    let unavailable: DomainError | undefined;
    for (const { segment } of segments) {
      const flight = await this.flights.findByInstance(segment.flightInstanceId);
      const status = flight?.props.status ?? segment.status;
      if (status === 'CANCELLED') { unavailable ??= new DomainError('CHECK_IN_NOT_AVAILABLE'); continue; }
      if (status === 'DEPARTED' || status === 'ARRIVED' || status === 'DIVERTED') { unavailable ??= new DomainError('FLIGHT_ALREADY_DEPARTED'); continue; }
      try { assertCheckInWindow(new Date(segment.departure.at), this.now(), this.openHours, this.closeMinutes); eligible.add(segment.segmentId); }
      catch (error) { if (!(error instanceof DomainError)) throw error; unavailable ??= error; }
    }
    const hasNewEligible = prior?.result?.checkedInPassengers.some((passenger) => passenger.segments.some((segment) => segment.status === 'NOT_CHECKED_IN' && eligible.has(segment.segmentId))) ?? false;
    if (prior?.result && !hasNewEligible) return prior.result;
    if (!eligible.size) throw unavailable ?? new DomainError('CHECK_IN_NOT_AVAILABLE');
    const coupons = await this.tickets.getCoupons(request.ownerId, request.bookingId);
    const acquired = prior?.result ? await this.store.resume(request.ownerId, request.bookingId) : await this.store.begin(request.ownerId, request.bookingId);
    if (!acquired) throw new DomainError('CHECK_IN_NOT_AVAILABLE');
    let completed = false;
    try {
    const passengers: CheckInResult['checkedInPassengers'] = [];
    let newSuccess = false;
    const orderedPassengers = [...snapshot.passengers.filter((passenger) => passenger.passengerType !== 'INFANT'), ...snapshot.passengers.filter((passenger) => passenger.passengerType === 'INFANT')];
    for (const passenger of orderedPassengers) {
      const results: CheckInResult['checkedInPassengers'][number]['segments'] = [];
      for (const { segment, pricingOptions } of segments) {
        const previous = prior?.result?.checkedInPassengers.find((value) => value.passengerId === passenger.passengerId)?.segments.find((value) => value.segmentId === segment.segmentId);
        if (previous && previous.status !== 'NOT_CHECKED_IN') { results.push(previous); continue; }
        if (!eligible.has(segment.segmentId)) { results.push({ segmentId: segment.segmentId, status: 'NOT_CHECKED_IN' }); continue; }
        const coupon = coupons.find((value) => value.passengerId === passenger.passengerId && value.segmentId === segment.segmentId && value.status === 'ISSUED');
        const expiryInvalid = passenger.documentType === 'PASSPORT' && (!passenger.documentExpiryDate || passenger.documentExpiryDate < segment.departure.at.slice(0, 10));
        const cabin = pricingOptions.length === 1 ? pricingOptions.find(() => true)?.cabinClass : undefined;
        if (!coupon || expiryInvalid || !cabin) { results.push({ segmentId: segment.segmentId, status: 'FAILED' }); continue; }
        if (passenger.passengerType === 'INFANT') {
          const adult = passengers.find((value) => value.passengerId === passenger.associatedAdultId);
          const adultSegment = adult?.segments.find((value) => value.segmentId === segment.segmentId && value.status === 'CHECKED_IN');
          if (!adultSegment?.seat) { results.push({ segmentId: segment.segmentId, status: 'FAILED' }); continue; }
          await this.store.savePass(request.ownerId, request.bookingId, { passengerId: passenger.passengerId, segmentId: segment.segmentId, seat: adultSegment.seat, barcode: `M1/${randomUUID()}/${adultSegment.seat}`, barcodeType: 'QR' });
          newSuccess = true;
          results.push({ segmentId: segment.segmentId, seat: adultSegment.seat, status: 'CHECKED_IN' });
          continue;
        }
        try {
          const seat = await this.seats.assign({ ...request, passengerId: passenger.passengerId, segmentId: segment.segmentId, passengerType: passenger.passengerType, cabinClass: cabin });
          if (seat.status !== 'CHECKED_IN') throw new DomainError('CHECK_IN_FAILED');
          await this.store.savePass(request.ownerId, request.bookingId, { passengerId: passenger.passengerId, segmentId: segment.segmentId, seat: seat.seatNumber, barcode: `M1/${randomUUID()}/${seat.seatNumber}`, barcodeType: 'QR' });
          newSuccess = true;
          results.push({ segmentId: segment.segmentId, seat: seat.seatNumber, status: 'CHECKED_IN' });
        } catch (error) {
          if (!(error instanceof DomainError) || !['SEAT_CABIN_MISMATCH', 'SEAT_TAKEN', 'INFANT_SEAT_NOT_ALLOWED', 'CHECK_IN_FAILED'].includes(error.code)) throw error;
          results.push({ segmentId: segment.segmentId, status: 'FAILED' });
        }
      }
      passengers.push({ passengerId: passenger.passengerId, status: results.some((value) => value.status === 'CHECKED_IN') ? 'CHECKED_IN' : results.some((value) => value.status === 'FAILED') ? 'FAILED' : 'NOT_CHECKED_IN', segments: results });
    }
    const result: CheckInResult = { bookingId: request.bookingId, status: completedStatus(passengers.flatMap((passenger) => passenger.segments.filter((segment) => segment.status !== 'NOT_CHECKED_IN').map((segment) => segment.status))), checkedInPassengers: passengers };
    await this.store.complete(request.ownerId, result);
    completed = true;
    if (newSuccess) {
      await this.events.publish({ ownerId: request.ownerId, bookingId: request.bookingId, pnr: snapshot.pnr, eventType: 'booking.checked_in', occurredAt: this.now().toISOString() });
      await this.store.markEventPublished(request.ownerId, request.bookingId);
    }
    return result;
    } catch (error) {
      if (!completed && prior?.result) await this.store.restore(request.ownerId, prior.result);
      else if (!completed) await this.store.abort(request.ownerId, request.bookingId);
      throw error;
    }
  }
}
