import { firstValueFrom, Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { status } from '@grpc/grpc-js';
import { DomainError } from '@flight-platform/shared';
import { EventPublisher, InventoryFlight, InventoryGateway, InventoryUnavailable, ReservationGateway } from '../../application/ports';

interface InventoryGrpcService {
  findFlightInstance(input: { flightNumber: string; departureDate: string }): Observable<{ flightInstanceId: string; segment?: InventoryFlight }>;
  closeFlightInstance(input: { flightInstanceId: string }): Observable<unknown>;
  getFlightInstance(input: { flightInstanceId: string }): Observable<{ flightInstanceId: string; segment?: InventoryFlight }>;
}

interface WebhooksGrpcService {
  publishEvent(input: unknown): Observable<unknown>;
}

/** Translates the Inventory gRPC boundary into the Operations application port. */
export class GrpcInventoryGateway implements InventoryGateway {
  constructor(private readonly client: InventoryGrpcService) {}

  async findFlight(input: { flightNumber: string; date: string }): Promise<InventoryFlight> {
    let response: { flightInstanceId: string; segment?: InventoryFlight };
    try { response = await firstValueFrom(this.client.findFlightInstance({ flightNumber: input.flightNumber, departureDate: input.date })); }
    catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === status.NOT_FOUND) throw new DomainError('NOT_FOUND');
      if (code === status.UNAVAILABLE) throw new InventoryUnavailable();
      throw error;
    }
    if (!response.segment) throw new Error('Inventory returned a flight without segment');
    return { ...response.segment, flightInstanceId: response.flightInstanceId };
  }

  async getFlight(flightInstanceId: string): Promise<InventoryFlight> {
    let response: { flightInstanceId: string; segment?: InventoryFlight };
    try { response = await firstValueFrom(this.client.getFlightInstance({ flightInstanceId })); }
    catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === status.NOT_FOUND) throw new DomainError('NOT_FOUND');
      if (code === status.UNAVAILABLE) throw new InventoryUnavailable();
      throw error;
    }
    if (!response.segment) throw new Error('Inventory returned a flight without segment');
    return { ...response.segment, flightInstanceId: response.flightInstanceId };
  }

  async closeFlightInstance(id: string): Promise<void> {
    await firstValueFrom(this.client.closeFlightInstance({ flightInstanceId: id }));
  }
}

/** Publishes the public flight notifications through the Webhooks service. */
export class GrpcEventPublisher implements EventPublisher {
  constructor(private readonly client: WebhooksGrpcService) {}

  async publish(input: Parameters<EventPublisher['publish']>[0]): Promise<void> {
    await firstValueFrom(this.client.publishEvent({
      ownerId: input.ownerId,
      payload: {
        eventId: randomUUID(),
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        apiVersion: '1.5.0.0',
        data: { bookingId: input.bookingId, ...(input.pnr ? { pnr: input.pnr } : {}) }
      }
    }));
  }
}

interface ReservationGrpcService {
  listReservationsByFlightInstance(input: { flightInstanceId: string; limit: number; cursor?: string }): Observable<{ items: Array<{ bookingId: string; ownerId: string; pnr?: string }>; nextCursor?: string }>;
}

/** Lists every reservation of a flight, following the cursor through all pages. */
export class GrpcReservationGateway implements ReservationGateway {
  static readonly PAGE_SIZE = 50;
  static readonly MAX_PAGES = 1000;
  constructor(private readonly client: ReservationGrpcService) {}

  async listByFlightInstance(id: string): Promise<Array<{ bookingId: string; ownerId: string; pnr?: string }>> {
    const bookings: Array<{ bookingId: string; ownerId: string; pnr?: string }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < GrpcReservationGateway.MAX_PAGES; page += 1) {
      const response = await firstValueFrom(this.client.listReservationsByFlightInstance({ flightInstanceId: id, limit: GrpcReservationGateway.PAGE_SIZE, ...(cursor ? { cursor } : {}) }));
      bookings.push(...response.items.map((item) => ({ bookingId: item.bookingId, ownerId: item.ownerId, ...(item.pnr ? { pnr: item.pnr } : {}) })));
      if (!response.nextCursor) return bookings;
      cursor = response.nextCursor;
    }
    throw new Error('Reservation pagination did not finish');
  }
}
