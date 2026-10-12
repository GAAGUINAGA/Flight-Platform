import { describe, expect, it } from '@jest/globals';
import { selectOfferForHold } from './pricing-hold-fixture';

describe('RSV-12 pricing hold fixture', () => {
  it('RSV-12 / U: reads the camelCase Pricing SearchOffers response used by the gRPC client', () => {
    expect(selectOfferForHold({ offers: [{ offerId: 'offer-1', itineraries: [{ itineraryId: 'itinerary-1', pricingOptions: [{ cabinClass: 'ECONOMY', fareBrand: 'BASIC' }] }] }] })).toEqual({ offerId: 'offer-1', itinerarySelections: [{ itineraryId: 'itinerary-1', cabinClass: 'ECONOMY', fareBrand: 'BASIC' }] });
  });
});
