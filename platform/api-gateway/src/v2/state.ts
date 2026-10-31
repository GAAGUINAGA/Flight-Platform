import type { PrismaClient } from '../../generated/prisma-client';

export interface V2BookingRecord { bookingId: string; clientId: string; ownerId: string; holdId: string; paymentReference: string; salesChannel?: Record<string, unknown>; passengerMap: Record<string, string> }

/** Estado propio de la fachada v2: lo que el contrato expone de una reserva y Reservation no guarda, y los eventos de Booking ya procesados. */
export interface V2StateStore {
  saveBooking(record: V2BookingRecord): Promise<void>;
  findBooking(bookingId: string): Promise<V2BookingRecord | null>;
  findBookingByPayment(clientId: string, paymentReference: string): Promise<V2BookingRecord | null>;
  /** Las referencias de pago son únicas en toda la plataforma: sirve para localizar la reserva de un evento sin bookingId. */
  findBookingByPaymentReference(paymentReference: string): Promise<V2BookingRecord | null>;
  /** true si es la primera vez que se ve el evento de este cliente; false si ya estaba registrado. */
  claimEvent(clientId: string, eventId: string, eventType: string): Promise<boolean>;
  completeEvent(clientId: string, eventId: string, outcome: string): Promise<void>;
  eventOutcome(clientId: string, eventId: string): Promise<string | null>;
  releaseEvent(clientId: string, eventId: string): Promise<void>;
}

export class InMemoryV2StateStore implements V2StateStore {
  readonly bookings = new Map<string, V2BookingRecord>(); readonly events = new Map<string, { type: string; outcome: string }>();
  async saveBooking(record: V2BookingRecord): Promise<void> { this.bookings.set(record.bookingId, { ...record }); }
  async findBooking(bookingId: string): Promise<V2BookingRecord | null> { return this.bookings.get(bookingId) ?? null; }
  async findBookingByPayment(clientId: string, paymentReference: string): Promise<V2BookingRecord | null> { return [...this.bookings.values()].find((r) => r.clientId === clientId && r.paymentReference === paymentReference) ?? null; }
  async findBookingByPaymentReference(paymentReference: string): Promise<V2BookingRecord | null> { return [...this.bookings.values()].find((r) => r.paymentReference === paymentReference) ?? null; }
  async claimEvent(clientId: string, eventId: string, eventType: string): Promise<boolean> { const key = `${clientId}:${eventId}`; if (this.events.has(key)) return false; this.events.set(key, { type: eventType, outcome: '' }); return true; }
  async completeEvent(clientId: string, eventId: string, outcome: string): Promise<void> { const found = this.events.get(`${clientId}:${eventId}`); if (found) found.outcome = outcome; }
  async eventOutcome(clientId: string, eventId: string): Promise<string | null> { const found = this.events.get(`${clientId}:${eventId}`); return found?.outcome ? found.outcome : null; }
  async releaseEvent(clientId: string, eventId: string): Promise<void> { this.events.delete(`${clientId}:${eventId}`); }
}

const isUniqueViolation = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

export class PrismaV2StateStore implements V2StateStore {
  constructor(private readonly prisma: PrismaClient) {}
  async saveBooking(r: V2BookingRecord): Promise<void> {
    const data = { clientId: r.clientId, ownerId: r.ownerId, holdId: r.holdId, paymentReference: r.paymentReference, salesChannel: (r.salesChannel ?? undefined) as never, passengerMap: r.passengerMap as never };
    await this.prisma.v2Booking.upsert({ where: { bookingId: r.bookingId }, create: { bookingId: r.bookingId, ...data }, update: data });
  }
  private toRecord(row: { bookingId: string; clientId: string; ownerId: string; holdId: string; paymentReference: string; salesChannel: unknown; passengerMap: unknown }): V2BookingRecord { return { bookingId: row.bookingId, clientId: row.clientId, ownerId: row.ownerId, holdId: row.holdId, paymentReference: row.paymentReference, ...(row.salesChannel ? { salesChannel: row.salesChannel as Record<string, unknown> } : {}), passengerMap: (row.passengerMap ?? {}) as Record<string, string> }; }
  async findBooking(bookingId: string): Promise<V2BookingRecord | null> { const row = await this.prisma.v2Booking.findUnique({ where: { bookingId } }); return row ? this.toRecord(row) : null; }
  async findBookingByPayment(clientId: string, paymentReference: string): Promise<V2BookingRecord | null> { const row = await this.prisma.v2Booking.findFirst({ where: { clientId, paymentReference }, orderBy: { createdAt: 'desc' } }); return row ? this.toRecord(row) : null; }
  async findBookingByPaymentReference(paymentReference: string): Promise<V2BookingRecord | null> { const row = await this.prisma.v2Booking.findFirst({ where: { paymentReference }, orderBy: { createdAt: 'desc' } }); return row ? this.toRecord(row) : null; }
  async claimEvent(clientId: string, eventId: string, eventType: string): Promise<boolean> {
    try { await this.prisma.v2ProcessedEvent.create({ data: { clientId, eventId, eventType, outcome: '' } }); return true; }
    catch (error) { if (isUniqueViolation(error)) return false; throw error; }
  }
  async completeEvent(clientId: string, eventId: string, outcome: string): Promise<void> { await this.prisma.v2ProcessedEvent.update({ where: { clientId_eventId: { clientId, eventId } }, data: { outcome } }); }
  async eventOutcome(clientId: string, eventId: string): Promise<string | null> { const row = await this.prisma.v2ProcessedEvent.findUnique({ where: { clientId_eventId: { clientId, eventId } } }); return row?.outcome ? row.outcome : null; }
  async releaseEvent(clientId: string, eventId: string): Promise<void> { await this.prisma.v2ProcessedEvent.deleteMany({ where: { clientId, eventId, outcome: '' } }); }
}
