import { firstValueFrom, Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { status } from '@grpc/grpc-js';
import { DomainError } from '@flight-platform/shared';
import { EventPublisher, InventoryFlight, InventoryGateway, InventoryUnavailable } from '../../application/ports';

interface InventoryGrpcService {
  findFlightInstance(input: { flightNumber: string; departureDate: string }): Observable<{ flightInstanceId: string; segment?: InventoryFlight }>;
  closeFlightInstance(input: { flightInstanceId: string }): Observable<unknown>;
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
