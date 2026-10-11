import { rpcString } from '@flight-platform/shared';
import { z } from 'zod';

const iata = z.string().regex(/^[A-Z]{3}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
const mix = z.object({
  adults: z.number().int().min(0).max(9), youths: z.number().int().min(0).max(9),
  children: z.number().int().min(0).max(9), infants: z.number().int().min(0).max(9)
}).strict();
const uuid = z.string().uuid();
const cabin = z.enum(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']);

export const searchOffersRequest = z.object({
  legs: z.array(z.object({ origin: iata, destination: iata, departureDate: date }).strict()).min(1).max(6),
  passengers: mix
}).strict();
export const resolveSegmentRequest = z.object({ segmentId: rpcString(128) }).strict();
export const holdOfferRequest = z.object({
  ownerId: rpcString(128), offerId: uuid,
  itinerarySelections: z.array(z.object({ itineraryId: uuid, cabinClass: cabin, fareBrand: rpcString(32) }).strict()).min(1).max(6),
  passengersBreakdown: mix, idempotencyKey: rpcString(128)
}).strict();
export const offerHoldRequest = z.object({ holdId: uuid, ownerId: rpcString(128) }).strict();
export const quoteChangeRequest = z.object({ bookingId: rpcString(128), ownerId: rpcString(128), changes: z.array(z.object({ itineraryId: uuid, newDepartureDate: date }).strict()).min(1).max(6), currentItineraries: z.array(z.unknown()).min(1), passengers: mix }).strict();
export const changeOfferRequest = z.object({ changeOfferId: uuid, ownerId: rpcString(128) }).strict();
export const quoteCancellationRequest = z.object({ bookingId: rpcString(128), ownerId: rpcString(128), paidPrice: z.object({ currency: z.literal('USD'), baseFare: z.string().regex(/^\d+\.\d{2}$/).optional(), taxes: z.string().regex(/^\d+\.\d{2}$/).optional(), total: z.string().regex(/^\d+\.\d{2}$/) }).strict(), fareRules: z.object({ isRefundable: z.boolean(), isChangeable: z.boolean() }).strict() }).strict();
export const baggagePriceRequest = z.object({ itineraryId: uuid, fareBrand: rpcString(32) }).strict();
