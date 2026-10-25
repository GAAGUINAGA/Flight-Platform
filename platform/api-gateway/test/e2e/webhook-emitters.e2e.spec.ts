import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import process from 'node:process';
import { Server, ServerCredentials, type ServerUnaryCall, type sendUnaryData } from '@grpc/grpc-js';
import { loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createGrpcClient, withGrpcCallContext } from '@flight-platform/shared';
import { GrpcEventPublisher as InventoryPublisher, SafeEventPublisher } from '../../../../microservices/inventory-service/src/infrastructure/events/grpc-event-publisher';
import { GrpcEventPublisher as ReservationPublisher } from '../../../../microservices/reservation-service/src/infrastructure/clients/grpc-gateways';
import { GrpcEventPublisher as OperationsPublisher } from '../../../../microservices/operations-service/src/infrastructure/adapters/grpc-adapters';
import type { Observable } from 'rxjs';

type Published = { ownerId: string; payload: { eventType: string; data: Record<string, unknown> } };
type WebhooksClient = { publishEvent(input: object): Observable<unknown> };

describe('PLT-H3 / E: los emisores publican en el receptor gRPC de Webhooks', () => {
  const server = new Server();
  const received: Published[] = [];
  const clients: Array<{ close(): void }> = [];
  let endpoint = '';

  beforeAll(async () => {
    const root = join(process.cwd(), 'contracts', 'proto');
    const definition = loadSync(join(root, 'flightplatform', 'webhooks', 'v1', 'webhooks.proto'), {
      includeDirs: [root], keepCase: false, defaults: true, arrays: true, objects: true
    });
    const pkg = loadPackageDefinition(definition) as unknown as { flightplatform: { webhooks: { v1: { WebhooksService: { service: object } } } } };
    server.addService(pkg.flightplatform.webhooks.v1.WebhooksService.service, {
      publishEvent: (call: ServerUnaryCall<Published, unknown>, callback: sendUnaryData<unknown>) => {
        received.push(call.request);
        callback(null, { eventId: randomUUID() });
      }
    });
    const port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, boundPort) => error ? reject(error) : resolve(boundPort)));
    server.start();
    endpoint = `127.0.0.1:${port}`;
  });

  afterAll(() => { clients.forEach((client) => client.close()); server.forceShutdown(); });

  const receiver = (): WebhooksClient => {
    const root = join(process.cwd(), 'contracts', 'proto');
    const client = createGrpcClient({ url: endpoint, grpcTls: false, internalApiKey: 'k'.repeat(40), correlationId: randomUUID(), ownerId: 'owner-h3', role: 'system', packageName: 'flightplatform.webhooks.v1', protoPath: join(root, 'flightplatform', 'webhooks', 'v1', 'webhooks.proto'), serviceName: 'WebhooksService' });
    clients.push(client as unknown as { close(): void });
    return withGrpcCallContext(client.getService<WebhooksClient>('WebhooksService'), { url: endpoint, grpcTls: false, internalApiKey: 'k'.repeat(40), correlationId: randomUUID(), ownerId: 'owner-h3', role: 'system' });
  };

  it('inventory entrega hold.expired al receptor', async () => {
    await new SafeEventPublisher(new InventoryPublisher(receiver()), { warn: jest.fn() } as never).publish({ ownerId: 'owner-h3', eventType: 'hold.expired', holdId: 'hold-h3', occurredAt: new Date('2030-01-01T00:00:00.000Z'), data: { status: 'EXPIRED' } });
    expect(received.at(-1)).toMatchObject({ ownerId: 'owner-h3', payload: { eventType: 'hold.expired', data: { status: 'EXPIRED' } } });
  });

  it('reservation entrega booking.confirmed al receptor', async () => {
    await new ReservationPublisher(() => receiver()).publish({ ownerId: 'owner-h3', eventType: 'booking.confirmed', bookingId: 'booking-h3', pnr: 'H3PNR1', status: 'CONFIRMED' });
    expect(received.at(-1)).toMatchObject({ ownerId: 'owner-h3', payload: { eventType: 'booking.confirmed', data: { bookingId: 'booking-h3', pnr: 'H3PNR1', status: 'CONFIRMED' } } });
  });

  it('operations entrega booking.checked_in al receptor', async () => {
    await new OperationsPublisher(receiver()).publish({ ownerId: 'owner-h3', eventType: 'booking.checked_in', bookingId: 'booking-h3', pnr: 'H3PNR1', occurredAt: '2030-01-01T00:00:00.000Z' });
    expect(received.at(-1)).toMatchObject({ ownerId: 'owner-h3', payload: { eventType: 'booking.checked_in', data: { bookingId: 'booking-h3', pnr: 'H3PNR1' } } });
  });
});
