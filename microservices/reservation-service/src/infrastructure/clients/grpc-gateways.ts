import { firstValueFrom } from 'rxjs';
import { Logger } from '@nestjs/common';
import { DomainError } from '@flight-platform/shared';
import { AncillariesPort, EventPublisher, InventoryPort, PricingPort, TicketingPort } from '../../application/ports';

type GrpcMethod = (input: unknown) => import('rxjs').Observable<unknown>;
type GrpcService = Record<string, GrpcMethod>;
export type GrpcServiceForOwner = (ownerId?: string, role?: string) => GrpcService;
const call = <T>(service: GrpcService, method: string, input: unknown) => firstValueFrom(service[method](input)) as Promise<T>;
const dependencyLogger = new Logger('ReservationDependencies');
const readDependency = async <T>(dependency: 'ancillaries' | 'ticketing', method: string, operation: () => Promise<T>): Promise<T> => {
  try { return await operation(); } catch (error) {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    const safeCode = typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 16 ? code : 'UNKNOWN';
    if (!(dependency === 'ancillaries' && safeCode === 5)) dependencyLogger.error(`dependency=${dependency} operation=${method} code=${safeCode}`);
    throw error;
  }
};

export class GrpcInventoryGateway implements InventoryPort {
  constructor(private readonly client: GrpcServiceForOwner) {}
  async consumeHold(input: { holdId: string; ownerId: string; reservationId: string }): Promise<void> { await call(this.client(input.ownerId, 'system'), 'consumeHold', input); }
  async releaseReservedInventory(input: { bookingId: string; ownerId: string }): Promise<void> { await call(this.client(input.ownerId, 'system'), 'releaseReservedInventory', input); }
}
export class GrpcPricingGateway implements PricingPort {
  constructor(private readonly client: GrpcServiceForOwner) {}
  async getHold(input: { holdId: string; ownerId: string }) { const value = await call<{ status: string; expiresAt?: string; lockedPrice?: { currency: string; total: string }; passengersBreakdown?: { adults: number; youths: number; children: number; infants: number }; itineraries?: unknown[] }>(this.client(input.ownerId, 'system'), 'getOfferHold', input); if (!value.lockedPrice || !value.passengersBreakdown || !value.itineraries) throw new DomainError('VALIDATION_FAILED'); return { holdId: input.holdId, ownerId: input.ownerId, status: value.status, expiresAt: value.expiresAt ?? '', lockedPrice: value.lockedPrice, passengersBreakdown: value.passengersBreakdown, itineraries: value.itineraries }; }
}
export class GrpcAncillariesGateway implements AncillariesPort {
  constructor(private readonly client: GrpcServiceForOwner) {}
  async reserveSeats(input: { ownerId: string }): Promise<void> { await call(this.client(input.ownerId, 'system'), 'reserveSeats', input); }
  async reserveBaggage(input: { ownerId: string }): Promise<void> { await call(this.client(input.ownerId, 'system'), 'reserveBaggage', input); }
  async confirmSeats(input: { bookingId: string; ownerId: string }): Promise<void> { await call(this.client(input.ownerId, 'system'), 'confirmSeats', input); }
  async releaseAll(input: { bookingId: string; ownerId: string }): Promise<void> { await call(this.client(input.ownerId, 'system'), 'releaseAll', input); }
  async getAssignments(input: { bookingId: string; ownerId: string }): Promise<unknown[]> { return (await readDependency('ancillaries', 'getAssignments', () => call<{ assignments?: unknown[] }>(this.client(input.ownerId, 'system'), 'getAssignments', input))).assignments ?? []; }
  async getBaggageOptions(input: { bookingId: string; ownerId: string }): Promise<unknown[]> { return (await readDependency('ancillaries', 'getBaggageOptions', () => call<{ options?: unknown[] }>(this.client(input.ownerId, 'system'), 'getBaggageOptions', input))).options ?? []; }
}
export class GrpcTicketingGateway implements TicketingPort {
  constructor(private readonly client: GrpcServiceForOwner) {}
  async issueTickets(input: { ownerId: string }): Promise<unknown[]> { return (await call<{ tickets?: unknown[] }>(this.client(input.ownerId, 'system'), 'issueTickets', input)).tickets ?? []; }
  async voidTickets(input: { bookingId: string; ownerId: string }): Promise<void> { await call(this.client(input.ownerId, 'system'), 'voidTickets', input); }
  async listTickets(input: { bookingId: string; ownerId: string }): Promise<unknown[]> { return (await readDependency('ticketing', 'listTickets', () => call<{ tickets?: unknown[] }>(this.client(input.ownerId, 'system'), 'listTickets', input))).tickets ?? []; }
}
export class GrpcEventPublisher implements EventPublisher {
  constructor(private readonly client: GrpcServiceForOwner) {}
  async publish(input: { ownerId: string; eventType: string; bookingId: string; pnr: string; status: string }): Promise<void> { await call(this.client(input.ownerId, 'system'), 'publishEvent', { ownerId: input.ownerId, payload: { eventId: input.bookingId, eventType: input.eventType, occurredAt: new Date().toISOString(), apiVersion: 'v1', data: { bookingId: input.bookingId, pnr: input.pnr, status: input.status } } }); }
}
