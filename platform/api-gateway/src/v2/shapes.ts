type Json = Record<string, unknown>;

/** `flightInstanceId` es interno y no se publica. */
export const publicSegment = (segment: Json): Json => { const { flightInstanceId: _internal, ...rest } = segment; void _internal; return rest; };

/** v2 enumera ADULT, YOUTH, CHILD e INFANT: el total por cabina ya viaja como `grandTotal` y Pricing escribe el niño de forma abreviada. */
const PASSENGER_TYPES: Record<string, string> = { ADULT: 'ADULT', YOUTH: 'YOUTH', CHILD: 'CHILD', CHILDRE: 'CHILD', CHILDREN: 'CHILD', INFANT: 'INFANT' };
const publicPricing = (option: Json): Json => ({ ...option, pricePerPassengerType: Array.isArray(option.pricePerPassengerType) ? (option.pricePerPassengerType as Json[]).filter((entry) => typeof entry.passengerType === 'string' && entry.passengerType in PASSENGER_TYPES).map((entry) => ({ ...entry, passengerType: PASSENGER_TYPES[entry.passengerType as string] })) : [] });

/** Itinerario tal como lo publica v2 (búsqueda y detalle de reserva comparten la misma forma). */
export const publicItinerary = (itinerary: Json): Json => ({ ...itinerary, segments: Array.isArray(itinerary.segments) ? (itinerary.segments as Json[]).map(publicSegment) : [], pricingOptions: Array.isArray(itinerary.pricingOptions) ? (itinerary.pricingOptions as Json[]).map(publicPricing) : [] });
