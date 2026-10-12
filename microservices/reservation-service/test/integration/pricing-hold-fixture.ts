type PricingOption = { cabinClass?: string; cabin_class?: string; fareBrand?: string; fare_brand?: string };
type PricingItinerary = { itineraryId?: string; itinerary_id?: string; pricingOptions?: PricingOption[]; pricing_options?: PricingOption[] };
type PricingOffer = { offerId?: string; offer_id?: string; itineraries?: PricingItinerary[] };

export interface PricingSearchResponse { offers?: PricingOffer[] }
export interface HoldOfferSelection { offerId: string; itinerarySelections: Array<{ itineraryId: string; cabinClass: string; fareBrand: string }> }

/**
 * Pricing is configured with proto-loader keepCase:false, so production replies
 * use camelCase. Supporting snake_case here keeps RSV-12 diagnostic-friendly if
 * the client loader is ever changed independently.
 */
export function selectOfferForHold(search: PricingSearchResponse): HoldOfferSelection {
  const offer = search.offers?.[0];
  if (!offer) throw new Error('search devolvió 0 ofertas');
  const offerId = offer.offerId ?? offer.offer_id;
  if (!offerId) throw new Error(`la primera oferta no trae offerId; campos: ${Object.keys(offer).join(', ')}`);
  const itinerarySelections = offer.itineraries?.map((itinerary) => {
    const itineraryId = itinerary.itineraryId ?? itinerary.itinerary_id;
    const option = (itinerary.pricingOptions ?? itinerary.pricing_options)?.[0];
    const cabinClass = option?.cabinClass ?? option?.cabin_class;
    const fareBrand = option?.fareBrand ?? option?.fare_brand;
    if (!itineraryId || !cabinClass || !fareBrand) throw new Error(`el itinerario de la oferta no trae selección completa; campos: ${Object.keys(itinerary).join(', ')}`);
    return { itineraryId, cabinClass, fareBrand };
  });
  if (!itinerarySelections?.length) throw new Error(`la oferta no trae itineraries; campos: ${Object.keys(offer).join(', ')}`);
  return { offerId, itinerarySelections };
}
