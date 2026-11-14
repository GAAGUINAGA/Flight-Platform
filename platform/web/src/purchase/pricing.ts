import type { PassengerType } from '@flight-platform/graphql-schema/generated/types';
import { multiplyAmount, sumAmounts, toCents } from './amounts';
import type { FareSelection, Offer, PassengerCounts } from './purchase-store';

/** Precios que la pantalla muestra a partir de la oferta elegida (el servidor congela el total real al reservar). Sin React ni DOM. */
export type Itinerary = Offer['itineraries'][number];
export type PricingOption = Itinerary['pricingOptions'][number];

export const optionFor = (itinerary: Itinerary, selection: FareSelection | undefined): PricingOption | undefined =>
  itinerary.pricingOptions.find((option) => option.cabinClass === selection?.cabinClass && option.fareBrand === selection.fareBrand);

export function priceOfType(option: PricingOption, type: PassengerType): string | null {
  const price = option.pricePerPassengerType.find((entry) => entry.passengerType === type)?.price;
  return price?.total ?? null;
}

/** Total estimado de la oferta con las tarifas elegidas: precio por tipo de pasajero × cantidad, de todos los tramos. `null` si falta algún precio. */
export function estimateTotal(offer: Offer, selections: Readonly<Record<string, FareSelection>>, counts: PassengerCounts): { currency: string; total: string } | null {
  const per: Array<[PassengerType, number]> = [['ADULT', counts.adults], ['YOUTH', counts.youths], ['CHILD', counts.children], ['INFANT', counts.infants]];
  const parts: string[] = [];
  for (const itinerary of offer.itineraries) {
    const option = optionFor(itinerary, selections[itinerary.itineraryId]); if (!option) return null;
    for (const [type, quantity] of per) {
      if (quantity === 0) continue;
      const price = priceOfType(option, type) ?? (type === 'INFANT' ? '0.00' : null);
      const line = price === null ? null : multiplyAmount(price, quantity);
      if (line === null) return null;
      parts.push(line);
    }
  }
  const sum = sumAmounts(parts);
  return sum.valid ? { currency: offer.grandTotal.currency, total: sum.total } : null;
}

/** Costo de las maletas adicionales elegidas: Σ cantidad × `extraCheckedBaggagePrice` del tramo (con la tarifa elegida). */
export function baggageTotal(offer: Offer, selections: Readonly<Record<string, FareSelection>>, quantities: ReadonlyArray<Readonly<Record<string, number>>>): string {
  const parts: string[] = [];
  for (const itinerary of offer.itineraries) {
    const unit = optionFor(itinerary, selections[itinerary.itineraryId])?.extraCheckedBaggagePrice?.total; if (!unit) continue;
    const count = quantities.reduce((sum, row) => sum + (row[itinerary.itineraryId] ?? 0), 0);
    const line = multiplyAmount(unit, count); if (line) parts.push(line);
  }
  return sumAmounts(parts).total;
}

export const addAmounts = (...values: string[]): string => sumAmounts(values).total;
export const isZero = (amount: string): boolean => toCents(amount) === 0;
