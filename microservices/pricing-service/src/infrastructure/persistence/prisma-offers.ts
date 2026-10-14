import { PrismaClient } from './prisma-client/client';
import { Fare, OfferSnapshot, OfferStore } from '../../application/search-offers';
import { PassengerMix } from '../../domain/pricing';
import { OfferHoldStore, PriceLock } from '../../application/offer-holds';
import { ChangeOffer, PostSaleStore } from '../../application/post-sale-pricing';

export class PrismaOfferStore implements OfferStore, OfferHoldStore, PostSaleStore {
  constructor(private readonly prisma: PrismaClient) {}
  async findFares(ids: string[]): Promise<Fare[]> {
    return (await this.prisma.fare.findMany({ where: { flightInstanceId: { in: ids } } })).map((fare) => ({
      flightInstanceId: fare.flightInstanceId, cabinClass: fare.cabinClass as Fare['cabinClass'], brand: fare.brand,
      baseFareMinor: fare.baseFareMinor, taxesMinor: fare.taxesMinor, rules: fare.rules as Fare['rules'], baggage: fare.baggage as Fare['baggage'], extraBagMinor: fare.extraBagMinor
    }));
  }
  async saveOffer(snapshot: OfferSnapshot, mix: PassengerMix, expiresAt: Date): Promise<void> {
    // JSON no admite propiedades undefined; los DTOs opcionales se omiten al persistir.
    const json = JSON.parse(JSON.stringify(snapshot));
    await this.prisma.offer.create({ data: { id: snapshot.offerId, snapshot: json, passengerMix: mix, expiresAt } });
  }
  async findActiveOffers(now: Date): Promise<OfferSnapshot[]> {
    return (await this.prisma.offer.findMany({ where: { expiresAt: { gt: now } } })).map((offer) => offer.snapshot as unknown as OfferSnapshot);
  }
  async findOffer(id: string) {
    const offer = await this.prisma.offer.findUnique({ where: { id } });
    return offer ? { snapshot: offer.snapshot as unknown as OfferSnapshot, mix: offer.passengerMix as unknown as PassengerMix, expiresAt: offer.expiresAt } : null;
  }
  async createPriceLock(lock: PriceLock): Promise<void> {
    const fareSnapshot = JSON.parse(JSON.stringify({ offer: lock.fareSnapshot, selections: lock.selections, passengersBreakdown: lock.passengersBreakdown }));
    await this.prisma.priceLock.create({ data: { holdId: lock.holdId, ownerId: lock.ownerId, offerId: lock.offerId, lockedPriceMinor: lock.lockedPriceMinor, passengerPrices: {}, extraBagByItinerary: {}, fareSnapshot, expiresAt: lock.expiresAt, status: lock.status } });
  }
  async getPriceLock(holdId: string, ownerId: string): Promise<PriceLock | null> {
    const lock = await this.prisma.priceLock.findFirst({ where: { holdId, ownerId } });
    if (!lock) return null;
    const snapshot = lock.fareSnapshot as unknown as { offer: OfferSnapshot; selections: PriceLock['selections']; passengersBreakdown: PriceLock['passengersBreakdown'] };
    return { holdId: lock.holdId, ownerId: lock.ownerId, offerId: lock.offerId, lockedPriceMinor: lock.lockedPriceMinor, expiresAt: lock.expiresAt, status: lock.status, selections: snapshot.selections, passengersBreakdown: snapshot.passengersBreakdown, fareSnapshot: snapshot.offer };
  }
  async setPriceLockStatus(holdId: string, ownerId: string, status: string): Promise<void> {
    await this.prisma.priceLock.updateMany({ where: { holdId, ownerId }, data: { status } });
  }
  async saveChangeOffer(value: ChangeOffer): Promise<void> { await this.prisma.changeOffer.create({ data: { id: value.id, bookingId: value.bookingId, ownerId: value.ownerId, snapshot: value.snapshot as never, expiresAt: value.expiresAt } }); }
  async findChangeOffer(id: string, ownerId: string): Promise<ChangeOffer | null> {
    const value = await this.prisma.changeOffer.findFirst({ where: { id, ownerId } });
    return value ? { id: value.id, bookingId: value.bookingId, ownerId: value.ownerId, snapshot: value.snapshot as unknown as ChangeOffer['snapshot'], expiresAt: value.expiresAt, ...(value.usedAt ? { usedAt: value.usedAt } : {}) } : null;
  }
  async markChangeOfferUsed(id: string, ownerId: string, at: Date): Promise<boolean> {
    const value = await this.prisma.changeOffer.updateMany({ where: { id, ownerId, usedAt: null, expiresAt: { gt: at } }, data: { usedAt: at } });
    return value.count === 1;
  }
}
