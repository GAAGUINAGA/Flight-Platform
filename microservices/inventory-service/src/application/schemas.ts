import { rpcString } from '@flight-platform/shared';
import { z } from 'zod';
import { CABIN_CLASSES } from '../domain/cabin';

/** proto-loader entrega '' / null para campos ausentes. */
const opt = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

export const iata = z.string().regex(/^[A-Z]{3}$/);
export const uuid = z.string().uuid();
export const cabin = z.enum(CABIN_CLASSES);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s));
const isoDateTime = z.string().datetime({ offset: true });
const flightNumber = z.string().regex(/^[A-Z0-9]{2}[0-9]{1,4}$/);
const ownerId = rpcString(128);
const seats = z.number().int().min(1).max(9);

export const idRequest = z.object({ flightInstanceId: uuid });
export const findRequest = z.object({ flightNumber, departureDate: isoDate });
export const listRequest = z.object({
  page: opt(z.object({ cursor: opt(uuid), limit: z.number().int().min(0).max(200) }).strict()),
  date: opt(isoDate)
});

const mixCount = z.number().int().min(0).max(9);
export const availabilityRequest = z.object({
  origin: iata,
  destination: iata,
  departureDate: isoDate,
  passengers: z.object({ adults: mixCount, youths: mixCount, children: mixCount, infants: mixCount }).strict(),
  cabinClass: opt(cabin)
});

/** Regla de mezcla: 1?9 pasajeros con asiento (Q-011) y un infante por adulto como m?ximo. */
export function isValidAvailability(r: z.output<typeof availabilityRequest>): boolean {
  const p = r.passengers;
  const seated = p.adults + p.youths + p.children;
  return r.origin !== r.destination && seated >= 1 && seated <= 9 && p.infants <= p.adults;
}

export const upsertRequest = z.object({
  flightInstanceId: opt(uuid),
  flightNumber,
  departureIata: iata,
  arrivalIata: iata,
  departureAt: isoDateTime,
  arrivalAt: isoDateTime,
  cabins: z
    .array(z.object({ cabinClass: cabin, capacity: z.number().int().min(0).max(1000) }).strict())
    .min(1)
    .max(4),
  aircraft: opt(rpcString(32))
});

export const createHoldRequest = z.object({
  ownerId,
  segments: z
    .array(z.object({ flightInstanceId: uuid, cabinClass: cabin, seats }).strict())
    .min(1)
    .max(6),
  expiresAt: opt(isoDateTime),
  idempotencyKey: rpcString(128)
});

export const holdRefRequest = z.object({ holdId: uuid, ownerId });
export const consumeHoldRequest = z.object({ holdId: uuid, ownerId, reservationId: uuid });
export const releaseReservedRequest = z.object({ bookingId: uuid, ownerId });
export const emptyRequest = z.object({});
