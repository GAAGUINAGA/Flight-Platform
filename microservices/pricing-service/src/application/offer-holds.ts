import { Clock, DomainError, minorToDecimal, validate } from '@flight-platform/shared';
import { InventoryGateway, PassengerMix } from './ports';
import { CabinPricingView, MoneyAmount, OfferSnapshot } from './search-offers';
import { holdOfferRequest, offerHoldRequest } from './schemas';

export interface PriceLock { holdId: string; ownerId: string; offerId: string; lockedPriceMinor: number; expiresAt: Date; status: string; selections: Selection[]; fareSnapshot: OfferSnapshot }
export interface Selection { itineraryId: string; cabinClass: string; fareBrand: string }
export interface OfferHoldStore { findOffer(id: string): Promise<{ snapshot: OfferSnapshot; mix: PassengerMix; expiresAt: Date } | null>; createPriceLock(lock: PriceLock): Promise<void>; getPriceLock(holdId: string, ownerId: string): Promise<PriceLock | null>; setPriceLockStatus(holdId: string, ownerId: string, status: string): Promise<void> }
export interface HoldConfig { holdTtlMinutes: number; currency: string }
const money = (minor: number, currency: string): MoneyAmount => ({ currency, total: minorToDecimal(minor) });

export class OfferHolds {
  constructor(private readonly inventory: InventoryGateway, private readonly store: OfferHoldStore, private readonly clock: Clock, private readonly config: HoldConfig) {}
  async hold(input: unknown) {
    const request = validate(holdOfferRequest, input);
    const offer = await this.store.findOffer(request.offerId);
    if (!offer || offer.expiresAt <= this.clock.now()) throw new DomainError('OFFER_NO_LONGER_AVAILABLE');
    const sameMix = (['adults', 'youths', 'children', 'infants'] as const).every((key) => offer.mix[key] === request.passengersBreakdown[key]);
    if (!sameMix || request.itinerarySelections.length !== offer.snapshot.itineraries.length) throw new DomainError('VALIDATION_FAILED');
    const selected = request.itinerarySelections.map((selection) => {
      const itinerary = offer.snapshot.itineraries.find((item) => item.itineraryId === selection.itineraryId);
      const option = itinerary?.pricingOptions.find((item) => item.cabinClass === selection.cabinClass && item.fareBrand === selection.fareBrand);
      if (!itinerary || !option) throw new DomainError('VALIDATION_FAILED');
      return { selection, itinerary, option };
    });
    const lockedPriceMinor = selected.reduce((total, item) => total + this.total(item.option), 0);
    const seats = request.passengersBreakdown.adults + request.passengersBreakdown.youths + request.passengersBreakdown.children;
    const inventoryHold = await this.inventory.createHold({ ownerId: request.ownerId, expiresAt: new Date(this.clock.now().getTime() + this.config.holdTtlMinutes * 60_000).toISOString(), idempotencyKey: request.idempotencyKey, segments: selected.flatMap(({ itinerary, selection }) => itinerary.segments.map((segment) => ({ flightInstanceId: segment.flightInstanceId, cabinClass: selection.cabinClass as 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST', seats }))) });
    try {
      await this.store.createPriceLock({ holdId: inventoryHold.holdId, ownerId: request.ownerId, offerId: request.offerId, lockedPriceMinor, expiresAt: new Date(inventoryHold.expiresAt), status: inventoryHold.status, selections: request.itinerarySelections, fareSnapshot: offer.snapshot });
    } catch (error) {
      await this.inventory.releaseHold({ holdId: inventoryHold.holdId, ownerId: request.ownerId });
      throw error;
    }
    return { holdId: inventoryHold.holdId, status: inventoryHold.status, expiresAt: inventoryHold.expiresAt, ttlMinutes: this.config.holdTtlMinutes, lockedPrice: money(lockedPriceMinor, this.config.currency) };
  }
  async get(input: unknown) {
    const request = validate(offerHoldRequest, input);
    const lock = await this.store.getPriceLock(request.holdId, request.ownerId);
    if (!lock) throw new DomainError('NOT_FOUND');
    const inventory = await this.inventory.getHold(request);
    return { status: inventory.status, expiresAt: inventory.expiresAt, remainingSeconds: Math.max(0, Math.floor((new Date(inventory.expiresAt).getTime() - this.clock.now().getTime()) / 1000)), lockedPrice: money(lock.lockedPriceMinor, this.config.currency) };
  }
  async release(input: unknown): Promise<void> {
    const request = validate(offerHoldRequest, input);
    if (!await this.store.getPriceLock(request.holdId, request.ownerId)) throw new DomainError('NOT_FOUND');
    await this.inventory.releaseHold(request);
    await this.store.setPriceLockStatus(request.holdId, request.ownerId, 'RELEASED');
  }
  async getLock(input: unknown) {
    const request = validate(offerHoldRequest, input);
    const lock = await this.store.getPriceLock(request.holdId, request.ownerId);
    if (!lock) throw new DomainError('NOT_FOUND');
    return { holdId: lock.holdId, ownerId: lock.ownerId, lockedPrice: money(lock.lockedPriceMinor, this.config.currency), selections: lock.selections, expiresAt: lock.expiresAt.toISOString() };
  }
  private total(option: CabinPricingView): number {
    const total = option.pricePerPassengerType.find((price) => price.passengerType === 'TOTAL');
    if (!total) throw new DomainError('VALIDATION_FAILED');
    return Number(total.price.total.replace('.', ''));
  }
}
