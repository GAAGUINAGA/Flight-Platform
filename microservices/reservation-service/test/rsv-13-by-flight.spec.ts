import { expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ReservationQueries } from '../src/application/queries';
import { InMemoryReservationStore } from '../src/application/reservation-store';

it('RSV-FLT-U1: byFlightInstance pagina de forma estable con ownerId y tope de 50', async () => {
  const store = new InMemoryReservationStore(); const flight = randomUUID(); const ids: string[] = [];
  for (let index = 0; index < 7; index += 1) { const id = randomUUID(); ids.push(id); await store.create({ id, ownerId: `owner-${index % 2}`, pnr: `PNR00${index}`, status: 'CONFIRMED', holdId: randomUUID(), paymentReference: `p${index}`, idempotencyKey: `k${index}`, passengers: [], itineraries: [{ segments: [{ flightInstanceId: flight }] }], grandTotal: { currency: 'USD', total: '1.00' }, changes: [], attempts: 0 }); }
  await store.create({ id: randomUUID(), ownerId: 'owner-x', pnr: 'OTHER1', status: 'CONFIRMED', holdId: randomUUID(), paymentReference: 'px', idempotencyKey: 'kx', passengers: [], itineraries: [{ segments: [{ flightInstanceId: randomUUID() }] }], grandTotal: { currency: 'USD', total: '1.00' }, changes: [], attempts: 0 });
  const queries = new ReservationQueries(store); const seen: Array<{ bookingId: string; ownerId: string }> = []; let cursor: string | undefined; let pages = 0;
  do { const page = await queries.byFlightInstance({ flightInstanceId: flight, limit: 3, cursor }); pages += 1; seen.push(...page.items); cursor = page.nextCursor; } while (cursor);
  expect(pages).toBe(3); expect(seen.map((item) => item.bookingId)).toEqual([...ids].sort());
  expect(seen.every((item) => item.ownerId === `owner-${ids.indexOf(item.bookingId) % 2}`)).toBe(true);
  expect((await queries.byFlightInstance({ flightInstanceId: flight, limit: 500 })).items).toHaveLength(7);
  expect((await queries.byFlightInstance({ flightInstanceId: flight, cursor: 'zzzzzzzz-not-found' })).items).toEqual([]);
});
