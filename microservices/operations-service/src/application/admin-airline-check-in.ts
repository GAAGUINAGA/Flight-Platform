import { validate } from '@flight-platform/shared';
import { z } from 'zod';
import { CheckInUseCase } from './check-in';
import { ListBoardingPasses } from './boarding-passes';

/** Alfabeto real de `createPnr` (Reservation): sin I, O, 0 ni 1. */
const requestSchema = z.object({ pnr: z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/) }).strict();

/** Puerto: bookingId y DUEÑO de un PNR, resueltos por Reservation (F12c-4b). El panel nunca los envía. */
export interface BookingOwnerResolver { resolve(pnr: string): Promise<{ bookingId: string; ownerId: string }> }

/**
 * Check-in hecho por la aerolínea (F12c-4b, ADR-F12c4-01). Recibe SOLO el PNR; el dueño real lo resuelve Reservation y se ejecuta el MISMO
 * `CheckInUseCase` del cliente (ventana de 48 h a 60 min, estado CONFIRMED, boletos emitidos, vuelo no cancelado ni salido): sin forzar la ventana
 * (P5) y publicando `booking.checked_in` con el dueño real, de modo que llega al socio como siempre. El actor (el administrador) lo registra el
 * Gateway en el registro de accesos; no viaja en el evento.
 */
export class AdminCheckIn {
  constructor(private readonly owners: BookingOwnerResolver, private readonly checkIn: CheckInUseCase) {}
  async execute(input: unknown) {
    const { pnr } = validate(requestSchema, input);
    const { bookingId, ownerId } = await this.owners.resolve(pnr);
    return this.checkIn.execute({ bookingId, ownerId });
  }
}

/** Pases de abordar de una reserva por PNR para la aerolínea (mismo caso de uso que el cliente, con el dueño real). */
export class AdminListBoardingPasses {
  constructor(private readonly owners: BookingOwnerResolver, private readonly passes: ListBoardingPasses) {}
  async execute(input: unknown) {
    const { pnr } = validate(requestSchema, input);
    const { bookingId, ownerId } = await this.owners.resolve(pnr);
    return this.passes.execute({ bookingId, ownerId });
  }
}
