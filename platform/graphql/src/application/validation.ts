import { z } from 'zod';
import { validationError } from '../domain/errors';

/** Validación por esquema en la frontera (formato IATA, UUID, longitudes) ANTES de llamar al Gateway; el Gateway y los servicios vuelven a validar. */
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const opaqueId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const iata = z.string().regex(/^[A-Z]{3}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const seatNumber = z.string().regex(/^\d{1,3}[A-Z]$/);
const paymentReference = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().min(1).max(max);
const quantity = z.number().int().min(0).max(3);

const counts = z.object({ adults: z.number().int().min(1).max(9), youths: z.number().int().min(0).max(9).optional().nullable(), children: z.number().int().min(0).max(9).optional().nullable(), infants: z.number().int().min(0).max(9).optional().nullable() })
  .refine((value) => (value.adults + (value.youths ?? 0) + (value.children ?? 0)) <= 9 && (value.infants ?? 0) <= value.adults, { message: 'passengers' });
const seatAssignment = z.object({ segmentId: opaqueId, seatNumber });

export const searchInput = z.object({
  itineraries: z.array(z.object({ origin: iata, destination: iata, departureDate: date })).min(1).max(6),
  passengers: counts
});
export const holdInput = z.object({
  offerId: opaqueId,
  selections: z.array(z.object({ itineraryId: opaqueId, cabinClass: z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']), fareBrand: text(32) })).min(1).max(6),
  passengers: counts,
  seats: z.array(seatAssignment).max(18).optional().nullable(),
  ttlMinutes: z.number().int().min(5).max(30).optional().nullable()
});
const passengerInput = z.object({
  passengerId: opaqueId, passengerType: z.enum(['ADULT', 'YOUTH', 'CHILD', 'INFANT']), associatedAdultId: opaqueId.optional().nullable(),
  firstName: text(60), lastName: text(60), documentType: z.enum(['PASSPORT', 'NATIONAL_ID']), documentNumber: z.string().regex(/^[A-Za-z0-9-]{4,20}$/),
  nationality: z.string().regex(/^[A-Z]{2,3}$/), documentExpiryDate: date.optional().nullable(), birthDate: date, gender: z.enum(['M', 'F', 'X']),
  contact: z.object({ email: z.string().max(120).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/), phone: z.string().regex(/^\+?[0-9 ()-]{6,20}$/) }),
  assignedSeats: z.array(seatAssignment).max(18).optional().nullable(), extraBaggage: z.array(z.object({ itineraryId: opaqueId, quantity })).max(6).optional().nullable()
});
export const createBookingInput = z.object({ holdId: uuid, passengers: z.array(passengerInput).min(1).max(9), paymentReference });
export const addBaggageInput = z.object({ bookingId: uuid, passengerId: opaqueId, itineraryId: opaqueId, quantity: z.number().int().min(1).max(3), paymentReference });
export const dateChanges = z.array(z.object({ itineraryId: opaqueId, newDepartureDate: date })).min(1).max(6);
export const confirmDateChangeInput = z.object({ bookingId: uuid, changeOfferId: opaqueId, paymentReference: paymentReference.optional().nullable(), assignedSeats: z.array(z.object({ passengerId: opaqueId, segmentId: opaqueId, seatNumber })).max(18).optional().nullable() });
export const seatChanges = z.array(z.object({ passengerId: opaqueId, segmentId: opaqueId, seatNumber })).min(1).max(18);
export const idempotencyKey = uuid;
export const flightNumber = z.string().regex(/^[A-Z0-9]{2,3}\d{1,4}$/);
export const flightStatusUpdate = z.object({
  date, status: z.enum(['SCHEDULED', 'BOARDING', 'DEPARTED', 'DELAYED', 'ARRIVED', 'CANCELLED', 'DIVERTED']),
  estimatedDepartureAt: z.string().max(40).optional().nullable(), estimatedArrivalAt: z.string().max(40).optional().nullable(), departureGate: text(8).optional().nullable(), reason: text(200).optional().nullable()
});
const money = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), total: z.string().regex(/^\d+\.\d{2}$/), baseFare: z.string().regex(/^\d+\.\d{2}$/).optional().nullable(), taxes: z.string().regex(/^\d+\.\d{2}$/).optional().nullable() });
export const upsertFareInput = z.object({
  fareId: uuid.optional().nullable(), flightInstanceId: uuid, cabinClass: z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']), fareBrand: text(32), price: money,
  isRefundable: z.boolean(), isChangeable: z.boolean(), personalItemIncluded: z.boolean().optional().nullable(),
  carryOnIncluded: z.number().int().min(0).max(9).optional().nullable(), checkedBaggageIncluded: z.number().int().min(0).max(9).optional().nullable(), extraCheckedBaggagePrice: money
});
export const promotionInput = z.object({
  allowsPromotions: z.boolean(), maxDiscountPercent: z.number().min(0).max(100), destinations: z.array(text(60)).max(50).optional().nullable(),
  routes: z.array(z.string().regex(/^[A-Z]{3}-[A-Z]{3}$/)).max(100).optional().nullable(), cabins: z.array(z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'])).max(4).optional().nullable(),
  validUntil: date.optional().nullable(), conditions: z.string().max(500).optional().nullable()
});
export const cursorText = z.string().regex(/^[A-Za-z0-9._~-]{1,200}$/);
export const idText = opaqueId;
export const iataCode = iata;
export const dateText = date;
export const reasonText = z.string().trim().max(255);

/** Valida y devuelve el valor; un fallo es un error público de validación (400) que solo nombra el campo. */
export function check<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const path = parsed.error.issues[0]?.path.map(String).join('.');
  throw validationError(path ? `${field}.${path}` : field, 'valor no válido');
}

/** Quita claves nulas/indefinidas (los nulos de GraphQL no van al Gateway). */
export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined)) as Partial<T>;
}
