import { validate } from '@flight-platform/shared';
import { z } from 'zod';
import { BookingOwnershipStore } from './booking-ownership';

const uuid = z.string().uuid();
const owner = z.string().trim().min(1).max(128);
const quantity = z.number().int().min(1).max(3);
const booking = z.object({ bookingId: uuid, ownerId: owner }).strict();
const purchase = booking.extend({ passengerId: uuid, itineraryId: uuid, quantity }).strict();
const reserve = booking.extend({ baggage: z.array(z.object({ itineraryId: uuid, quantity }).strict()).min(1).max(9) }).strict();

export interface BaggageItem { bookingId: string; ownerId: string; passengerId: string | null; itineraryId: string; quantity: number; status: 'PROVISIONAL' | 'CONFIRMED' | 'RELEASED'; }
export interface BaggageStore { reserve(input: BaggageItem[]): Promise<void>; purchase(input: BaggageItem, maxAllowed: number): Promise<number>; list(bookingId: string, ownerId: string): Promise<BaggageItem[]>; release(bookingId: string, ownerId: string): Promise<void>; }
export class Baggage {
  constructor(private readonly store: BaggageStore, private readonly maxAllowed: number, private readonly ownership: BookingOwnershipStore) {}
  async reserve(input: unknown): Promise<{ bookingId: string; status: string }> {
    const request = validate(reserve, input);
    await this.ownership.claimOrAssertOwner(request.bookingId, request.ownerId);
    await this.store.reserve(request.baggage.map((item) => ({ bookingId: request.bookingId, ownerId: request.ownerId, passengerId: null, itineraryId: item.itineraryId, quantity: item.quantity, status: 'PROVISIONAL' })));
    return { bookingId: request.bookingId, status: 'PROVISIONAL' };
  }
  async options(input: unknown): Promise<Array<{ passengerId: string; itineraryId: string; maxAllowed: number; alreadyPurchased: number; price: { currency: string; total: string } }>> {
    const request = validate(booking, input);
    await this.ownership.assertOwner(request.bookingId, request.ownerId);
    const values = await this.store.list(request.bookingId, request.ownerId);
    const grouped = new Map<string, BaggageItem[]>();
    for (const value of values.filter((item) => item.passengerId && item.status !== 'RELEASED')) { const key = `${value.passengerId}:${value.itineraryId}`; grouped.set(key, [...(grouped.get(key) ?? []), value]); }
    return [...grouped.values()].map((items) => ({ passengerId: items[0].passengerId!, itineraryId: items[0].itineraryId, maxAllowed: this.maxAllowed, alreadyPurchased: items.reduce((sum, item) => sum + item.quantity, 0), price: { currency: 'USD', total: '0.00' } }));
  }
  async purchase(input: unknown): Promise<{ passengerId: string; itineraryId: string; totalBaggage: number }> {
    const request = validate(purchase, input);
    await this.ownership.assertOwner(request.bookingId, request.ownerId);
    const totalBaggage = await this.store.purchase({ ...request, status: 'CONFIRMED' }, this.maxAllowed);
    return { passengerId: request.passengerId, itineraryId: request.itineraryId, totalBaggage };
  }
  async releaseAll(input: unknown): Promise<void> { const request = validate(booking, input); await this.ownership.assertOwner(request.bookingId, request.ownerId); await this.store.release(request.bookingId, request.ownerId); }
}
