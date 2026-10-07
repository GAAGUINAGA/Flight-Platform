import { rpcString } from '@flight-platform/shared';
import { z } from 'zod';

const uuid = z.string().uuid();
const ownerId = rpcString(128);
const passenger = z.object({ passengerId: rpcString(128), passengerType: z.string(), firstName: rpcString(128), lastName: rpcString(128) }).passthrough();
const segment = z.object({ segmentId: rpcString(128) }).passthrough();
const itinerary = z.object({ itineraryId: rpcString(128), segments: z.array(segment).min(1).max(6) }).passthrough();
export const bookingOwner = z.object({ bookingId: uuid, ownerId });
export const getTicket = bookingOwner.extend({ ticketId: uuid });
export const issueTickets = bookingOwner.extend({ requestId: rpcString(128), passengers: z.array(passenger).min(1).max(9), itineraries: z.array(itinerary).min(1).max(6) });
export const reissueTickets = bookingOwner.extend({ newItineraries: z.array(itinerary).min(1).max(6) });
