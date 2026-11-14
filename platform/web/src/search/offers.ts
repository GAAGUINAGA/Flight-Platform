import { compareAmounts } from '@flight-platform/format';
import type { CabinClass, ItineraryFieldsFragment, SearchFlightsQuery } from '@flight-platform/graphql-schema/generated/types';

/** Filtros y orden de Resultados EN EL CLIENTE (diseño F12c-0 §3.2 y hueco H-10: el servicio no filtra ni pagina). Sin React. */
export type Offer = SearchFlightsQuery['searchFlights']['offers'][number];
export type PricingOption = ItineraryFieldsFragment['pricingOptions'][number];
export type SortBy = 'price' | 'departure';
export interface OfferFilters { directOnly: boolean; cabin: CabinClass | null }

/** Precio por adulto de una opción tarifaria (o `null` si la opción no trae precio de adulto). */
export function adultPrice(option: PricingOption): { currency: string; total: string } | null {
  const price = option.pricePerPassengerType.find((entry) => entry.passengerType === 'ADULT')?.price ?? option.pricePerPassengerType[0]?.price ?? null;
  return price ? { currency: price.currency, total: price.total } : null;
}

/** La opción más barata de un tramo (por precio de adulto), opcionalmente dentro de una cabina. */
export function cheapestOption(itinerary: ItineraryFieldsFragment, cabin: CabinClass | null = null): PricingOption | null {
  const candidates = itinerary.pricingOptions.filter((option) => (cabin ? option.cabinClass === cabin : true) && adultPrice(option));
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => compareAmounts(adultPrice(a)!.total, adultPrice(b)!.total))[0];
}

export const isDirect = (offer: Offer): boolean => offer.itineraries.every((itinerary) => itinerary.stopsCount === 0);
/** Una oferta sirve para una cabina si TODOS sus tramos tienen alguna tarifa en esa cabina. */
export const hasCabin = (offer: Offer, cabin: CabinClass): boolean => offer.itineraries.every((itinerary) => itinerary.pricingOptions.some((option) => option.cabinClass === cabin));

const firstDeparture = (offer: Offer): number => { const at = Date.parse(offer.itineraries[0]?.segments[0]?.departure.at ?? ''); return Number.isNaN(at) ? Number.MAX_SAFE_INTEGER : at; };

/** Aplica filtros y orden sin modificar la lista recibida. El orden es estable: a igualdad se respeta el del servicio. */
export function selectOffers(offers: readonly Offer[], filters: OfferFilters, sortBy: SortBy): Offer[] {
  const filtered = offers.filter((offer) => (!filters.directOnly || isDirect(offer)) && (!filters.cabin || hasCabin(offer, filters.cabin)));
  const indexed = filtered.map((offer, index) => ({ offer, index }));
  indexed.sort((a, b) => (sortBy === 'price' ? compareAmounts(a.offer.grandTotal.total, b.offer.grandTotal.total) : firstDeparture(a.offer) - firstDeparture(b.offer)) || a.index - b.index);
  return indexed.map((entry) => entry.offer);
}

/** Cabinas que aparecen en alguna oferta (para no ofrecer filtros vacíos). */
export function availableCabins(offers: readonly Offer[]): CabinClass[] {
  const seen = new Set<CabinClass>();
  for (const offer of offers) for (const itinerary of offer.itineraries) for (const option of itinerary.pricingOptions) seen.add(option.cabinClass);
  return [...seen];
}

export function stopsLabel(stops: number): string {
  return stops === 0 ? 'Directo' : stops === 1 ? '1 escala' : `${stops} escalas`;
}
