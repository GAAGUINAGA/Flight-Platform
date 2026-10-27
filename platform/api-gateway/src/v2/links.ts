export interface Link { href: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' }
export type Links = Record<string, Link>;

const NOT_CANCELLABLE = new Set(['CANCELLED', 'FAILED', 'CANCELLATION_PENDING', 'CHANGE_PENDING']);

/** Enlaces HATEOAS según el estado: solo las acciones que hoy tienen sentido. `base` es la URL pública del Gateway. */
export function bookingLinks(base: string, bookingId: string, status: string, ticketsIssued: boolean): Links {
  const root = `${base}/api/v2/vuelos/bookings/${bookingId}`; const link = (path: string, method: Link['method']): Link => ({ href: `${root}${path}`, method });
  const links: Links = { self: link('', 'GET'), tickets: link('/tickets', 'GET') };
  if (status === 'PENDING_PAYMENT' || status === 'TICKET_ISSUING') links['issue-tickets'] = link('/tickets', 'POST');
  if (status === 'CONFIRMED') {
    links['baggage-options'] = link('/baggage-options', 'GET'); links['date-change-search'] = link('/date-change/search', 'POST');
    if (ticketsIssued) { links.seats = link('/seats', 'PUT'); links['check-in'] = link('/check-in', 'POST'); links['boarding-passes'] = link('/boarding-passes', 'GET'); }
  }
  if (!NOT_CANCELLABLE.has(status)) { links['cancellation-quote'] = link('/cancellation-quote', 'GET'); links.cancel = link('/cancel', 'POST'); }
  return links;
}

export function holdLinks(base: string, holdId: string, status: string): Links {
  const self = `${base}/api/v2/vuelos/offers/hold/${holdId}`;
  const links: Links = { self: { href: self, method: 'GET' } };
  if (status === 'HELD') { links.release = { href: self, method: 'DELETE' }; links.book = { href: `${base}/api/v2/vuelos/bookings`, method: 'POST' }; }
  return links;
}
