import type { components } from '../../../../packages/contracts/src/generated/openapi';
import { OfferSnapshot } from './search-offers';

/** Conversión 1:1 del DTO interno gRPC al contrato REST, comprobada por el tipo generado del OpenAPI. */
export function toSearchResponse(value: { totalOffers: number; offers: OfferSnapshot[] }): components['schemas']['SearchResponse'] {
  return {
    totalOffers: value.totalOffers,
    offers: value.offers.map((offer) => ({
      offerId: offer.offerId,
      airline: { code: offer.airlineCode, name: offer.airlineName },
      grandTotal: offer.grandTotal,
      itineraries: offer.itineraries.map((itinerary) => ({
        itineraryId: itinerary.itineraryId, totalDurationMinutes: itinerary.totalDurationMinutes, stopsCount: itinerary.stopsCount,
        segments: itinerary.segments.map((segment) => ({
          segmentId: segment.segmentId, flightNumber: segment.flightNumber, departure: segment.departure, arrival: segment.arrival,
          marketingCarrier: segment.marketingCarrier, operatingCarrier: segment.operatingCarrier,
          ...(segment.aircraft === undefined ? {} : { aircraft: segment.aircraft }),
          ...(segment.durationMinutes === undefined ? {} : { durationMinutes: segment.durationMinutes })
        })),
        pricingOptions: itinerary.pricingOptions.map((option) => ({
          cabinClass: option.cabinClass, fareBrand: option.fareBrand, availableSeats: option.availableSeats,
          fareRules: option.fareRules, baggageAllowance: option.baggageAllowance,
          extraCheckedBaggagePrice: option.extraCheckedBaggagePrice, pricePerPassengerType: option.pricePerPassengerType
        }))
      }))
    }))
  };
}

export function toHoldResponse(value: { holdId: string; status: string; expiresAt: string; ttlMinutes: number; lockedPrice: { currency: string; total: string } }): components['schemas']['HoldResponse'] {
  return { holdId: value.holdId, status: 'HELD', expiresAt: value.expiresAt, ttlMinutes: value.ttlMinutes, lockedPrice: value.lockedPrice };
}

export function toHoldStatusResponse(value: { status: string; expiresAt?: string; remainingSeconds: number; lockedPrice: { currency: string; total: string } }): components['schemas']['HoldStatusResponse'] {
  return { status: value.status as components['schemas']['HoldStatusResponse']['status'], ...(value.expiresAt ? { expiresAt: value.expiresAt } : {}), remainingSeconds: value.remainingSeconds, lockedPrice: value.lockedPrice };
}
