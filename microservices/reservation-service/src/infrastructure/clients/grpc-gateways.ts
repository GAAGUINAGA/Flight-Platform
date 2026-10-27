import { firstValueFrom } from 'rxjs';
import { Logger } from '@nestjs/common';
import { DomainError } from '@flight-platform/shared';
import { status } from '@grpc/grpc-js';
import { AncillariesPort, EventPublisher, InventoryPort, PricingPort, TicketingPort } from '../../application/ports';

type GrpcMethod = (input: unknown) => import('rxjs').Observable<unknown>;
type GrpcService = Record<string, GrpcMethod>;
export type GrpcServiceForOwner = (ownerId?: string, role?: string) => GrpcService;
const call = <T>(service: GrpcService, method: string, input: unknown) => firstValueFrom(service[method](input)) as Promise<T>;
const dependencyLogger = new Logger('ReservationDependencies');
const readDependency = async <T>(dependency: 'inventory' | 'pricing' | 'ancillaries' | 'ticketing' | 'webhooks', method: string, operation: () => Promise<T>): Promise<T> => {
  try { return await operation(); } catch (error) {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    const safeCode = typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 16 ? code : 'UNKNOWN';
    if (!(dependency === 'ancillaries' && safeCode === 5)) dependencyLogger.error(`dependency=${dependency} operation=${method} code=${safeCode}`);
    throw error;
  }
};

export class GrpcInventoryGateway implements InventoryPort {
  constructor(private readonly client: GrpcServiceForOwner) {}
  async consumeHold(input: { holdId: string; ownerId: string; reservationId: string }): Promise<void> { await readDependency('inventory', 'consumeHold', () => call(this.client(input.ownerId, 'system'), 'consumeHold', input)); }
  async createHold(input: { ownerId: string; segments: Array<{ flightInstanceId: string; cabinClass: string; seats: number }>; expiresAt: string; idempotencyKey: string }): Promise<{ holdId: string }> { return readDependency('inventory', 'createHold', () => call(this.client(input.ownerId, 'system'), 'createHold', input)); }
  async releaseReservedInventory(input: { bookingId: string; ownerId: string }): Promise<void> { await readDependency('inventory', 'releaseReservedInventory', () => call(this.client(input.ownerId, 'system'), 'releaseReservedInventory', input)); }
}
export class GrpcPricingGateway implements PricingPort {
  constructor(private readonly client: GrpcServiceForOwner) {}
  async getHold(input: { holdId: string; ownerId: string }) {
    type Itinerary = { itineraryId: string; pricingOptions: Array<{ cabinClass: string; fareBrand: string }> };
    const client = this.client(input.ownerId, 'system');
    let value: { status: string; expiresAt?: string; lockedPrice?: { currency: string; total: string }; passengersBreakdown?: { adults: number; youths: number; children: number; infants: number }; itineraries?: Itinerary[] };
    try { value = await readDependency('pricing', 'getOfferHold', () => call(client, 'getOfferHold', input)); }
    catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === status.NOT_FOUND) throw new DomainError('NOT_FOUND');
      throw error;
    }
    if (!value.lockedPrice || !value.passengersBreakdown || !value.itineraries) throw new DomainError('VALIDATION_FAILED');
    const lock = await readDependency('pricing', 'getPriceLock', () => call<{ selections: Array<{ itineraryId: string; cabinClass: string; fareBrand: string }> }>(client, 'getPriceLock', input));
    const itineraries = value.itineraries.map((itinerary) => { const selected = lock.selections.find((item) => item.itineraryId === itinerary.itineraryId); const option = itinerary.pricingOptions.find((item) => item.cabinClass === selected?.cabinClass && item.fareBrand === selected.fareBrand); if (!option) throw new DomainError('VALIDATION_FAILED'); return { ...itinerary, pricingOptions: [option] }; });
    if (lock.selections.length !== itineraries.length) throw new DomainError('VALIDATION_FAILED');
    return { holdId: input.holdId, ownerId: input.ownerId, status: value.status, expiresAt: value.expiresAt ?? '', lockedPrice: value.lockedPrice, passengersBreakdown: value.passengersBreakdown, itineraries };
  }
  async quoteChange(input: unknown): Promise<{ offers: unknown[] }> {
    try { return await call(this.client((input as { ownerId: string }).ownerId, 'system'), 'quoteChange', input); }
    catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 9 && (error as { details?: unknown }).details === 'FARE_NOT_CHANGEABLE') throw new DomainError('FARE_NOT_CHANGEABLE');
      throw error;
    }
  }
  async getChangeOffer(input: { changeOfferId: string; ownerId: string }): Promise<unknown> { return call(this.client(input.ownerId, 'system'), 'getChangeOffer', input); }
  async markChangeOfferUsed(input: { changeOfferId: string; ownerId: string }): Promise<void> { await call(this.client(input.ownerId, 'system'), 'markChangeOfferUsed', input); }
  async quoteCancellation(input: unknown): Promise<unknown> { return call(this.client((input as { ownerId: string }).ownerId, 'system'), 'quoteCancellation', input); }
  async releaseHold(input: { holdId: string; ownerId: string }): Promise<void> { await call(this.client(input.ownerId, 'system'), 'releaseOfferHold', input); }
}
export class GrpcAncillariesGateway implements AncillariesPort {
  constructor(private readonly client: GrpcServiceForOwner) {}
  async registerBaggageAllowance(input: { bookingId: string; ownerId: string; allowances: Array<{ passengerId: string; itineraryId: string; checkedBaggageIncluded: number }> }): Promise<void> { await readDependency('ancillaries', 'registerBaggageAllowance', () => call(this.client(input.ownerId, 'system'), 'registerBaggageAllowance', input)); }
  async reserveSeats(input: { ownerId: string }): Promise<void> { await readDependency('ancillaries', 'reserveSeats', () => call(this.client(input.ownerId, 'system'), 'reserveSeats', input)); }
  async reserveBaggage(input: { ownerId: string }): Promise<void> { await readDependency('ancillaries', 'reserveBaggage', () => call(this.client(input.ownerId, 'system'), 'reserveBaggage', input)); }
  async confirmSeats(input: { bookingId: string; ownerId: string }): Promise<void> { await readDependency('ancillaries', 'confirmSeats', () => call(this.client(input.ownerId, 'system'), 'confirmSeats', input)); }
  async releaseAll(input: { bookingId: string; ownerId: string }): Promise<void> { await readDependency('ancillaries', 'releaseAll', () => call(this.client(input.ownerId, 'system'), 'releaseAll', input)); }
  async getAssignments(input: { bookingId: string; ownerId: string }): Promise<unknown[]> { return (await readDependency('ancillaries', 'getAssignments', () => call<{ assignments?: unknown[] }>(this.client(input.ownerId, 'system'), 'getAssignments', input))).assignments ?? []; }
  async getBaggageOptions(input: { bookingId: string; ownerId: string }): Promise<unknown[]> { return (await readDependency('ancillaries', 'getBaggageOptions', () => call<{ options?: unknown[] }>(this.client(input.ownerId, 'system'), 'getBaggageOptions', input))).options ?? []; }
  async purchaseBaggage(input: { bookingId: string; ownerId: string; passengerId: string; itineraryId: string; quantity: number; operationId: string }): Promise<{ passengerId: string; itineraryId: string; totalBaggage: number }> { return readDependency('ancillaries', 'purchaseBaggage', () => call(this.client(input.ownerId, 'system'), 'purchaseBaggage', input)); }
}
export class GrpcTicketingGateway implements TicketingPort {
  constructor(private readonly client: GrpcServiceForOwner) {}
  async issueTickets(input: { ownerId: string }): Promise<unknown[]> { return (await readDependency('ticketing', 'issueTickets', () => call<{ tickets?: unknown[] }>(this.client(input.ownerId, 'system'), 'issueTickets', input))).tickets ?? []; }
  async voidTickets(input: { bookingId: string; ownerId: string }): Promise<void> { await readDependency('ticketing', 'voidTickets', () => call(this.client(input.ownerId, 'system'), 'voidTickets', input)); }
  async listTickets(input: { bookingId: string; ownerId: string }): Promise<unknown[]> { return (await readDependency('ticketing', 'listTickets', () => call<{ tickets?: unknown[] }>(this.client(input.ownerId, 'system'), 'listTickets', input))).tickets ?? []; }
  async reissueTickets(input: { bookingId: string; ownerId: string; newItineraries: unknown[] }): Promise<unknown[]> { return (await readDependency('ticketing', 'reissueTickets', () => call<{ tickets?: unknown[] }>(this.client(input.ownerId, 'system'), 'reissueTickets', input))).tickets ?? []; }
  async refundTickets(input: { bookingId: string; ownerId: string }): Promise<void> { await readDependency('ticketing', 'refundTickets', () => call(this.client(input.ownerId, 'system'), 'refundTickets', input)); }
}
export class GrpcEventPublisher implements EventPublisher {
  constructor(private readonly client: GrpcServiceForOwner) {}
  async publish(input: { ownerId: string; eventType: string; bookingId: string; pnr: string; status: string; eventId?: string; refundAmount?: string; extra?: Record<string, unknown> }): Promise<void> { await readDependency('webhooks', 'publishEvent', () => call(this.client(input.ownerId, 'system'), 'publishEvent', { ownerId: input.ownerId, payload: { eventId: input.eventId ?? input.bookingId, eventType: input.eventType, occurredAt: new Date().toISOString(), apiVersion: 'v1', data: { bookingId: input.bookingId, pnr: input.pnr, status: input.status, ...(input.refundAmount ? { refundAmount: input.refundAmount } : {}), ...(input.extra && Object.keys(input.extra).length ? { dataJson: JSON.stringify(input.extra) } : {}) } } })); }
}
