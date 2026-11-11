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
const reserveRequest = z.object({ bookingId: uuid, ownerId: z.string().trim().min(1).max(128), assignments: z.array(assignment).max(9), holdId: uuid.optional() }).strict().refine((value) => value.assignments.length > 0 || value.holdId !== undefined, { message: 'assignments' });
const bookingRequest = z.object({ bookingId: uuid, ownerId: z.string().trim().min(1).max(128), restoreHold: z.boolean().optional() }).strict();
const holdRequest = z.object({ holdId: uuid, ownerId: z.string().trim().min(1).max(128), expiresAt: z.string().max(40).refine((value) => Number.isFinite(Date.parse(value))), seats: z.array(z.object({ segmentId: uuid, seatNumber }).strict()).min(1).max(18) }).strict();
const heldRequest = z.object({ holdId: uuid, ownerId: z.string().trim().min(1).max(128) }).strict();
const checkInRequest = z.object({ bookingId: uuid, ownerId: z.string().trim().min(1).max(128), passengerId: uuid, segmentId: uuid, preferredSeat: seatNumber.optional(), passengerType, cabinClass: cabin }).strict();

export interface Assignment { bookingId: string; ownerId: string; passengerId: string; segmentId: string; flightInstanceId: string; seatNumber: string; passengerType: PassengerType; cabinClass: string; status: 'HELD' | 'PROVISIONAL' | 'CONFIRMED' | 'CHECKED_IN' | 'RELEASED'; }
export interface HeldSeatRow { segmentId: string; flightInstanceId: string; seatNumber: string; cabinClass: string }
/** Asientos apartados por un hold (ADR-F12b2fix-01). Cada método es una sola transacción; las HELD vencidas cuentan como libres. */
export interface HeldSeatStore {
  /** Aparta todos o ninguno; lanza SEAT_TAKEN si alguno está vendido o apartado por otro hold vigente. */
  holdMany(input: { holdId: string; ownerId: string; expiresAt: Date; seats: HeldSeatRow[] }): Promise<void>;
  releaseHold(holdId: string, ownerId: string): Promise<void>;
  listHeld(holdId: string, ownerId: string, now: Date): Promise<Array<{ segmentId: string; seatNumber: string }>>;
  /** Libera los asientos del hold y crea las asignaciones de la reserva en una sola transacción (SEAT_TAKEN deshace todo). */
  reserveFromHold(input: { holdId: string; bookingId: string; ownerId: string; assignments: Assignment[] }): Promise<Assignment[]>;
  /** Devuelve al hold (si sigue vigente) los asientos que la reserva tomó de él; los que ya no se pueden devolver quedan libres. */
  restoreHeld(bookingId: string, ownerId: string, now: Date): Promise<void>;
}
/** passengerId sintético de una fila apartada: el último grupo del holdId se reemplaza por el índice. Solo existe con bookingId = holdId, así que no choca con pasajeros reales. */
export const heldPassengerId = (holdId: string, index: number): string => `${holdId.slice(0, 24)}${index.toString(16).padStart(12, '0')}`;
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
  constructor(private readonly pricing: PricingGateway, private readonly layouts: SeatLayoutStore, private readonly store: AssignmentStore, private readonly ownership: BookingOwnershipStore, private readonly atomic?: AtomicSeatChanges, private readonly held?: HeldSeatStore, private readonly now: () => Date = () => new Date()) {}
  /** Aparta los asientos de un hold: todos o ninguno (SEAT_TAKEN). El vencimiento es el del hold. */
  async holdSeats(input: unknown): Promise<{ seats: Array<{ segmentId: string; seatNumber: string }> }> {
    const request = validate(holdRequest, input);
    if (!this.held) throw new DomainError('VALIDATION_FAILED');
    const expiresAt = new Date(request.expiresAt);
    if (expiresAt <= this.now() || new Set(request.seats.map((item) => `${item.segmentId}:${item.seatNumber}`)).size !== request.seats.length) throw new DomainError('VALIDATION_FAILED');
    const segments = new Map<string, { flightInstanceId: string; aircraft?: string }>(); const rows: HeldSeatRow[] = [];
    for (const item of request.seats) {
      const segment = segments.get(item.segmentId) ?? await this.pricing.resolveSegment({ segmentId: item.segmentId }); segments.set(item.segmentId, segment);
      const seat = (await this.layouts.listByAircraft(segment.aircraft ?? 'A320')).find((candidate) => candidate.seatNumber === item.seatNumber);
      if (!seat) throw new DomainError('SEAT_CABIN_MISMATCH');
      rows.push({ segmentId: item.segmentId, flightInstanceId: segment.flightInstanceId, seatNumber: item.seatNumber, cabinClass: seat.cabinClass });
    }
    await this.held.holdMany({ holdId: request.holdId, ownerId: request.ownerId, expiresAt, seats: rows });
    return { seats: request.seats };
  }
  /** Idempotente y owner-scoped: un hold ajeno o inexistente no libera nada. */
  async releaseHeld(input: unknown): Promise<void> { const request = validate(heldRequest, input); await this.held?.releaseHold(request.holdId, request.ownerId); }
  async heldSeats(input: unknown): Promise<{ seats: Array<{ segmentId: string; seatNumber: string }> }> { const request = validate(heldRequest, input); return { seats: await this.held?.listHeld(request.holdId, request.ownerId, this.now()) ?? [] }; }
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
    if (request.holdId && this.held) return this.reserveFromHold(request.holdId, request.bookingId, request.ownerId, request.assignments);
    const saved: Assignment[] = [];
    for (const item of request.assignments) saved.push(await this.reserveOne(request.bookingId, request.ownerId, item));
    return saved;
  }
  /** Los asientos del hold se liberan y se toman los pedidos en una transacción: los mismos no chocan con su propio hold; otros ocupados dan SEAT_TAKEN y el hold queda intacto. */
  private async reserveFromHold(holdId: string, bookingId: string, ownerId: string, items: Array<z.output<typeof assignment>>): Promise<Assignment[]> {
    const segments = new Map<string, { flightInstanceId: string; aircraft?: string }>(); const assignments: Assignment[] = [];
    for (const item of items) {
      const segment = segments.get(item.segmentId) ?? await this.pricing.resolveSegment({ segmentId: item.segmentId }); segments.set(item.segmentId, segment);
      const seat = (await this.layouts.listByAircraft(segment.aircraft ?? 'A320')).find((candidate) => candidate.seatNumber === item.seatNumber);
      if (!seat) throw new DomainError('SEAT_CABIN_MISMATCH');
      assertSeatEligibility({ passengerType: item.passengerType, purchasedCabin: item.cabinClass, seatCabin: seat.cabinClass, isEmergencyExit: seat.characteristics.includes('EMERGENCY_EXIT') || seat.characteristics.includes('EXIT_ROW') });
      assignments.push({ bookingId, ownerId, passengerId: item.passengerId, segmentId: item.segmentId, flightInstanceId: segment.flightInstanceId, seatNumber: item.seatNumber, passengerType: item.passengerType, cabinClass: item.cabinClass, status: 'PROVISIONAL' });
    }
    return this.held!.reserveFromHold({ holdId, bookingId, ownerId, assignments });
  }
  async assertOwnership(input: unknown): Promise<void> { const request = validate(bookingRequest, input); await this.ownership.assertOwner(request.bookingId, request.ownerId); }
  async confirm(input: unknown): Promise<Assignment[]> { const request = validate(bookingRequest, input); await this.ownership.assertOwner(request.bookingId, request.ownerId); return this.store.updateStatus(request.bookingId, request.ownerId, 'CONFIRMED'); }
  async release(input: unknown): Promise<void> {
    const request = validate(bookingRequest, input); await this.ownership.assertOwner(request.bookingId, request.ownerId);
    await this.store.updateStatus(request.bookingId, request.ownerId, 'RELEASED');
    if (request.restoreHold) await this.held?.restoreHeld(request.bookingId, request.ownerId, this.now());
  }
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
