import { z } from 'zod';
import { GatewayProblemError } from './web-errors';

const uuid = z.string().guid();
const iata = z.string().regex(/^[A-Z]{3}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => new Date(`${value}T00:00:00Z`).toISOString().startsWith(value));
const dateTime = z.string().datetime({ offset: true });
const cabin = z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']);
const amount = z.string().regex(/^\d+\.\d{2}$/);
const money = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), baseFare: amount.optional(), taxes: amount.optional(), total: amount }).strict();

export const adminFlightBody = z.object({
  flightInstanceId: uuid.optional(),
  flightNumber: z.string().regex(/^[A-Z0-9]{2}[0-9]{1,4}$/),
  departureIata: iata, arrivalIata: iata, departureAt: dateTime, arrivalAt: dateTime,
  cabins: z.array(z.object({ cabinClass: cabin, capacity: z.number().int().min(0).max(1000) }).strict()).min(1).max(4),
  aircraft: z.string().min(1).max(32).optional()
}).strict();

export const adminFlightListQuery = z.object({
  date: isoDate.optional(),
  limit: z.string().regex(/^\d{1,3}$/).refine((value) => Number(value) <= 200).optional(),
  cursor: uuid.optional()
}).strict();

export const adminFlightId = z.object({ flightInstanceId: uuid }).strict();

export const adminFareBody = z.object({
  fareId: uuid.optional(),
  flightInstanceId: uuid, cabinClass: cabin, fareBrand: z.string().min(1).max(32),
  price: money,
  fareRules: z.object({ isRefundable: z.boolean(), isChangeable: z.boolean() }).strict(),
  baggageAllowance: z.object({ personalItemIncluded: z.boolean().optional(), carryOnIncluded: z.number().int().min(0).max(9).optional(), checkedBaggageIncluded: z.number().int().min(0).max(9).optional() }).strict(),
  extraCheckedBaggagePrice: money
}).strict();

export const adminFareListQuery = z.object({ flightInstanceId: uuid.optional() }).strict();

export const adminOperationalUpdateBody = z.object({
  status: z.enum(['SCHEDULED', 'BOARDING', 'DELAYED', 'DEPARTED', 'ARRIVED', 'CANCELLED', 'DIVERTED']),
  estimatedDepartureAt: dateTime.optional(), actualDepartureAt: dateTime.optional(),
  estimatedArrivalAt: dateTime.optional(), actualArrivalAt: dateTime.optional(),
  departureTerminal: z.string().trim().min(1).max(16).optional(), arrivalTerminal: z.string().trim().min(1).max(16).optional()
}).strict();

/** Valida con un esquema estricto; el error solo nombra los campos, nunca sus valores. */
export function parseAdmin<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  const fields = [...new Set(parsed.error.issues.flatMap((issue) => issue.code === 'unrecognized_keys' ? issue.keys : [issue.path.join('.') || 'body']))];
  throw new GatewayProblemError(400, 'VALIDATION_FAILED', `Invalid fields: ${fields.join(', ')}`);
}
