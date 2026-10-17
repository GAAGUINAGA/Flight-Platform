import { DomainError, validate } from '@flight-platform/shared';
import { z } from 'zod';
import { BookingOwnershipStore } from './booking-ownership';

const uuid = z.string().uuid();
const owner = z.string().trim().min(1).max(128);
const quantity = z.number().int().min(1).max(3);
const booking = z.object({ bookingId: uuid, ownerId: owner }).strict();
const purchase = booking.extend({ passengerId: uuid, itineraryId: uuid, quantity, operationId: uuid.optional() }).strict();
const reserve = booking.extend({ baggage: z.array(z.object({ itineraryId: uuid, quantity, passengerId: uuid.optional() }).strict()).min(1).max(9) }).strict();
const allowanceItem = z.object({ passengerId: uuid, itineraryId: uuid, checkedBaggageIncluded: z.number().int().min(0).max(2147483647) }).strict();
const registerAllowance = booking.extend({ allowances: z.array(allowanceItem).min(1).max(54) }).strict();

export interface BaggageItem { bookingId: string; ownerId: string; passengerId: string | null; itineraryId: string; quantity: number; status: 'PROVISIONAL' | 'CONFIRMED' | 'RELEASED'; }
export interface BaggageAllowanceItem { bookingId: string; ownerId: string; passengerId: string; itineraryId: string; checkedBaggageIncluded: number }
export interface BaggageStore { reserve(input: BaggageItem[], maxAllowed: number): Promise<void>; purchase(input: BaggageItem, maxAllowed: number, operationId?: string): Promise<number>; list(bookingId: string, ownerId: string): Promise<BaggageItem[]>; registerAllowances(input: BaggageAllowanceItem[]): Promise<void>; listAllowances(bookingId: string, ownerId: string): Promise<BaggageAllowanceItem[]>; release(bookingId: string, ownerId: string): Promise<void>; }
export class Baggage {
  constructor(private readonly store: BaggageStore, private readonly maxAllowed: number, private readonly ownership: BookingOwnershipStore) {}
  async registerAllowances(input: unknown): Promise<void> {
    const request = validate(registerAllowance, input);
    if (new Set(request.allowances.map((item) => `${item.passengerId}:${item.itineraryId}`)).size !== request.allowances.length) throw new DomainError('VALIDATION_FAILED');
    await this.ownership.claimOrAssertOwner(request.bookingId, request.ownerId);
    await this.store.registerAllowances(request.allowances.map((item) => ({ ...item, bookingId: request.bookingId, ownerId: request.ownerId })));
  }
  async reserve(input: unknown): Promise<{ bookingId: string; status: string }> {
    const request = validate(reserve, input);
    await this.ownership.claimOrAssertOwner(request.bookingId, request.ownerId);
    await this.store.reserve(request.baggage.map((item) => ({ bookingId: request.bookingId, ownerId: request.ownerId, passengerId: item.passengerId ?? null, itineraryId: item.itineraryId, quantity: item.quantity, status: 'PROVISIONAL' })), this.maxAllowed);
    return { bookingId: request.bookingId, status: 'PROVISIONAL' };
  }
  async options(input: unknown): Promise<Array<{ passengerId: string; itineraryId: string; maxAllowed: number; alreadyPurchased: number; checkedBaggageIncluded: number; price: { currency: string; total: string } }>> {
    const request = validate(booking, input);
    await this.ownership.assertOwner(request.bookingId, request.ownerId);
    const [values, allowances] = await Promise.all([this.store.list(request.bookingId, request.ownerId), this.store.listAllowances(request.bookingId, request.ownerId)]);
    const grouped = new Map<string, BaggageItem[]>();
    for (const value of values.filter((item) => item.passengerId && item.status !== 'RELEASED')) { const key = `${value.passengerId}:${value.itineraryId}`; grouped.set(key, [...(grouped.get(key) ?? []), value]); }
    const result = allowances.map((item) => { const alreadyPurchased = (grouped.get(`${item.passengerId}:${item.itineraryId}`) ?? []).reduce((sum, value) => sum + value.quantity, 0); return { passengerId: item.passengerId, itineraryId: item.itineraryId, maxAllowed: Math.max(0, this.maxAllowed - item.checkedBaggageIncluded - alreadyPurchased), alreadyPurchased, checkedBaggageIncluded: item.checkedBaggageIncluded, price: { currency: 'USD', total: '0.00' } }; });
    for (const [key, items] of grouped) if (!allowances.some((item) => `${item.passengerId}:${item.itineraryId}` === key)) { const alreadyPurchased = items.reduce((sum, item) => sum + item.quantity, 0); result.push({ passengerId: items[0].passengerId!, itineraryId: items[0].itineraryId, maxAllowed: Math.max(0, this.maxAllowed - alreadyPurchased), alreadyPurchased, checkedBaggageIncluded: 0, price: { currency: 'USD', total: '0.00' } }); }
    return result;
  }
  async purchase(input: unknown): Promise<{ passengerId: string; itineraryId: string; totalBaggage: number }> {
    const request = validate(purchase, input);
    await this.ownership.assertOwner(request.bookingId, request.ownerId);
    const { operationId, ...item } = request;
    const totalBaggage = await this.store.purchase({ ...item, status: 'CONFIRMED' }, this.maxAllowed, operationId);
    return { passengerId: request.passengerId, itineraryId: request.itineraryId, totalBaggage };
  }
  async releaseAll(input: unknown): Promise<void> { const request = validate(booking, input); await this.ownership.assertOwner(request.bookingId, request.ownerId); await this.store.release(request.bookingId, request.ownerId); }
}
