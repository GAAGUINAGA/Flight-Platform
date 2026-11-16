import { validate } from '@flight-platform/shared';
import { z } from 'zod';
import { CheckInResult } from './check-in-ports';

const requestSchema = z.object({ bookingId: z.string().guid() }).strict();

/** Lectura por reserva SIN dueño (la reserva es única por `bookingId`); solo la usa el administrador (el controlador exige el rol). */
export interface CheckInStatusReader { findByBooking(bookingId: string): Promise<{ status: string; result: CheckInResult | null } | null> }

export interface AdminCheckInStatusView {
  bookingId: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | string;
  passengers: Array<{ passengerId: string; status: string; segments: Array<{ segmentId: string; status: string; seat?: string }> }>;
}

/** Estado del check-in de una reserva para el panel (F12c-4a, ADR-F12c4-01): solo identificadores, estados y asientos; sin códigos de barras ni datos personales. */
export class AdminCheckInStatus {
  constructor(private readonly reader: CheckInStatusReader) {}

  async execute(input: unknown): Promise<AdminCheckInStatusView> {
    const { bookingId } = validate(requestSchema, input);
    const row = await this.reader.findByBooking(bookingId);
    if (!row) return { bookingId, status: 'NOT_STARTED', passengers: [] };
    return {
      bookingId, status: row.status,
      passengers: (row.result?.checkedInPassengers ?? []).map((passenger) => ({
        passengerId: passenger.passengerId, status: passenger.status,
        segments: passenger.segments.map((segment) => ({ segmentId: segment.segmentId, status: segment.status, ...(segment.seat ? { seat: segment.seat } : {}) }))
      }))
    };
  }
}
