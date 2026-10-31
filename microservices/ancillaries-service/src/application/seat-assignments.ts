import { DomainError, validate } from '@flight-platform/shared';
import { z } from 'zod';
import { PricingGateway } from './ports';
import { SeatLayoutRow, SeatLayoutStore } from './seat-map';
import { assertSeatEligibility, PassengerType } from '../domain/seat-eligibility';
import { BookingOwnershipStore } from './booking-ownership';

const uuid = z.string().guid();
const seatNumber = z.string().regex(/^[0-9]{1,2}[A-K]$/);
const passengerType = z.enum(['ADULT', 'YOUTH', 'CHILD', 'INFANT']);
const cabin = z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']);
const assignment = z.object({ passengerId: uuid, segmentId: uuid, seatNumber, passengerType, cabinClass: cabin }).strict();
const reserveRequest = z.object({ bookingId: uuid, ownerId: z.string().trim().min(1).max(128), assignments: z.array(assignment).min(1).max(9) }).strict();
const bookingRequest = z.object({ bookingId: uuid, ownerId: z.string().trim().min(1).max(128) }).strict();
const checkInRequest = z.object({ bookingId: uuid, ownerId: z.string().trim().min(1).max(128), passengerId: uuid, segmentId: uuid, preferredSeat: seatNumber.optional(), passengerType, cabinClass: cabin }).strict();

export interface Assignment { bookingId: string; ownerId: string; passengerId: string; segmentId: string; flightInstanceId: string; seatNumber: string; passengerType: PassengerType; cabinClass: string; status: 'PROVISIONAL' | 'CONFIRMED' | 'CHECKED_IN' | 'RELEASED'; }
export interface AssignmentStore {
  create(value: Assignment): Promise<Assignment>;
  find(bookingId: string, ownerId: string, passengerId: string, segmentId: string): Promise<Assignment | null>;
  list(bookingId: string, ownerId: string): Promise<Assignment[]>;
  updateStatus(bookingId: string, ownerId: string, status: 'CONFIRMED' | 'RELEASED'): Promise<Assignment[]>;
  markCheckedIn(bookingId: string, ownerId: string, passengerId: string, segmentId: string): Promise<Assignment>;
  activeSeatNumbers(flightInstanceId: string): Promise<string[]>;
}

const changeRequest = z.object({ bookingId: uuid, ownerId: z.string().trim().min(1).max(128), newAssignmentStatus: z.enum(['PROVISIONAL', 'CONFIRMED']), changes: z.array(z.object({ passengerId: uuid, segmentId: uuid, seatNumber, passengerType, cabinClass: cabin }).strict()).min(1).max(18) }).strict();
export interface SeatChangePlan { bookingId: string; ownerId: string; passengerId: string; segmentId: string; flightInstanceId: string; seatNumber: string; passengerType: PassengerType; cabinClass: string; newStatus: 'PROVISIONAL' | 'CONFIRMED' }
export interface SeatChangeOutcome { passengerId: string; segmentId: string; previousSeatNumber?: string; seatNumber: string; status: Assignment['status'] }
/** Aplica todos los cambios en una sola transacción: si uno falla (p. ej. asiento ocupado) no se cambia ninguno. */
export interface AtomicSeatChanges { changeMany(plan: SeatChangePlan[]): Promise<SeatChangeOutcome[]> }

export class SeatAssignments {
  constructor(private readonly pricing: PricingGateway, private readonly layouts: SeatLayoutStore, private readonly store: AssignmentStore, private readonly ownership: BookingOwnershipStore, private readonly atomic?: AtomicSeatChanges) {}
  /** Cambio de asientos: misma cabina, sin infantes, sin check-in hecho, todo o nada. */
  async change(input: unknown): Promise<SeatChangeOutcome[]> {
    const request = validate(changeRequest, input);
    if (!this.atomic) throw new DomainError('VALIDATION_FAILED');
    await this.ownership.assertOwner(request.bookingId, request.ownerId);
    if (new Set(request.changes.map((item) => `${item.passengerId}:${item.segmentId}`)).size !== request.changes.length) throw new DomainError('VALIDATION_FAILED');
    const segments = new Map<string, { flightInstanceId: string; aircraft?: string }>(); const plan: SeatChangePlan[] = [];
    for (const item of request.changes) {
      const segment = segments.get(item.segmentId) ?? await this.pricing.resolveSegment({ segmentId: item.segmentId }); segments.set(item.segmentId, segment);
      const seat = (await this.layouts.listByAircraft(segment.aircraft ?? 'A320')).find((candidate) => candidate.seatNumber === item.seatNumber);
      if (!seat) throw new DomainError('SEAT_CABIN_MISMATCH');
      assertSeatEligibility({ passengerType: item.passengerType, purchasedCabin: item.cabinClass, seatCabin: seat.cabinClass, isEmergencyExit: seat.characteristics.includes('EMERGENCY_EXIT') || seat.characteristics.includes('EXIT_ROW') });
      const current = await this.store.find(request.bookingId, request.ownerId, item.passengerId, item.segmentId);
      if (current?.status === 'CHECKED_IN') throw new DomainError('CUTOFF_PASSED');
      plan.push({ bookingId: request.bookingId, ownerId: request.ownerId, passengerId: item.passengerId, segmentId: item.segmentId, flightInstanceId: segment.flightInstanceId, seatNumber: item.seatNumber, passengerType: item.passengerType, cabinClass: item.cabinClass, newStatus: request.newAssignmentStatus });
    }
    return this.atomic.changeMany(plan);
  }
  async reserve(input: unknown): Promise<Assignment[]> {
    const request = validate(reserveRequest, input);
    await this.ownership.claimOrAssertOwner(request.bookingId, request.ownerId);
    const saved: Assignment[] = [];
    for (const item of request.assignments) saved.push(await this.reserveOne(request.bookingId, request.ownerId, item));
    return saved;
  }
  async assertOwnership(input: unknown): Promise<void> { const request = validate(bookingRequest, input); await this.ownership.assertOwner(request.bookingId, request.ownerId); }
  async confirm(input: unknown): Promise<Assignment[]> { const request = validate(bookingRequest, input); await this.ownership.assertOwner(request.bookingId, request.ownerId); return this.store.updateStatus(request.bookingId, request.ownerId, 'CONFIRMED'); }
  async release(input: unknown): Promise<void> { const request = validate(bookingRequest, input); await this.ownership.assertOwner(request.bookingId, request.ownerId); await this.store.updateStatus(request.bookingId, request.ownerId, 'RELEASED'); }
  async assignments(input: unknown): Promise<Assignment[]> { const request = validate(bookingRequest, input); await this.ownership.assertOwner(request.bookingId, request.ownerId); return this.store.list(request.bookingId, request.ownerId); }
  async assignAtCheckIn(input: unknown): Promise<Assignment> {
    const request = validate(checkInRequest, input);
    await this.ownership.assertOwner(request.bookingId, request.ownerId);
    const existing = await this.store.find(request.bookingId, request.ownerId, request.passengerId, request.segmentId);
    if (existing) {
      if (existing.status === 'RELEASED') throw new DomainError('CHECK_IN_NOT_AVAILABLE');
      return this.store.markCheckedIn(request.bookingId, request.ownerId, request.passengerId, request.segmentId);
    }
    const segment = await this.pricing.resolveSegment({ segmentId: request.segmentId });
    const layout = await this.layouts.listByAircraft(segment.aircraft ?? 'A320');
    const occupied = new Set(await this.store.activeSeatNumbers(segment.flightInstanceId));
    const candidate = request.preferredSeat ? layout.find((seat) => seat.seatNumber === request.preferredSeat) : layout.find((seat) => seat.cabinClass === request.cabinClass && !occupied.has(seat.seatNumber));
    if (!candidate) throw new DomainError('SEAT_CABIN_MISMATCH');
    return this.reserveOne(request.bookingId, request.ownerId, { passengerId: request.passengerId, segmentId: request.segmentId, seatNumber: candidate.seatNumber, passengerType: request.passengerType, cabinClass: request.cabinClass }, segment, candidate, 'CHECKED_IN');
  }
  private async reserveOne(bookingId: string, ownerId: string, input: z.output<typeof assignment>, existingSegment?: { flightInstanceId: string; aircraft?: string }, existingSeat?: SeatLayoutRow, status: 'PROVISIONAL' | 'CHECKED_IN' = 'PROVISIONAL'): Promise<Assignment> {
    const segment = existingSegment ?? await this.pricing.resolveSegment({ segmentId: input.segmentId });
    const seat = existingSeat ?? (await this.layouts.listByAircraft(segment.aircraft ?? 'A320')).find((item) => item.seatNumber === input.seatNumber);
    if (!seat) throw new DomainError('SEAT_CABIN_MISMATCH');
    assertSeatEligibility({ passengerType: input.passengerType, purchasedCabin: input.cabinClass, seatCabin: seat.cabinClass, isEmergencyExit: seat.characteristics.includes('EMERGENCY_EXIT') || seat.characteristics.includes('EXIT_ROW') });
    return this.store.create({ bookingId, ownerId, passengerId: input.passengerId, segmentId: input.segmentId, flightInstanceId: segment.flightInstanceId, seatNumber: input.seatNumber, passengerType: input.passengerType, cabinClass: input.cabinClass, status });
  }
}
