const routes = [
  { origin: 'UIO', destination: 'GYE' },
  { origin: 'UIO', destination: 'BOG' },
  { origin: 'UIO', destination: 'LIM' },
  { origin: 'BOG', destination: 'MIA' },
  { origin: 'LIM', destination: 'MAD' },
  { origin: 'GYE', destination: 'MIA' }
];

function selectCandidate(search, now) {
  for (const offer of search.offers ?? []) {
    for (const itinerary of offer.itineraries ?? []) {
      const segment = (itinerary.segments ?? []).reduce((first, current) => !first || Date.parse(current.departure?.at) < Date.parse(first.departure?.at) ? current : first, undefined);
      const departure = Date.parse(segment?.departure?.at);
      const fare = (itinerary.pricingOptions ?? []).find((option) => option.cabinClass === 'ECONOMY' && option.fareBrand === 'BASIC');
      if (offer.offerId && itinerary.itineraryId && segment?.segmentId && Number.isFinite(departure) && departure >= now + 2 * 3600000 && departure <= now + 47 * 3600000 && fare) return { offer, itinerary, segment, fare };
    }
  }
  return undefined;
}

async function findCandidate(searchOffers, now, onSearch = () => {}) {
  const today = new Date(now);
  let selected;
  for (const offset of [1, 2]) {
    const departureDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset)).toISOString().slice(0, 10);
    for (const route of routes) {
      const result = await searchOffers({ legs: [{ ...route, departureDate }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 } });
      onSearch(result);
      const candidate = selectCandidate(result, now);
      if (candidate) { selected ??= candidate; break; }
    }
  }
  if (selected) return selected;
  throw Object.assign(new Error('NO_FLIGHT_IN_CHECKIN_WINDOW'), { code: 'NO_FLIGHT_IN_CHECKIN_WINDOW', details: 'NO_FLIGHT_IN_CHECKIN_WINDOW' });
}

module.exports = { findCandidate, selectCandidate };
