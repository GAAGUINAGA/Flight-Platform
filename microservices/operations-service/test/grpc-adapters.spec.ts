import { of } from 'rxjs';
import { GrpcEventPublisher, GrpcInventoryGateway } from '../src/infrastructure/adapters/grpc-adapters';

describe('OPS-01: adaptadores gRPC', () => {
  it('OPS-01: traduce Inventory y cierra la instancia por gRPC', async () => {
    const findFlightInstance = jest.fn(() => of({ flightInstanceId: '00000000-0000-0000-0000-000000000001', segment: { flightNumber: 'FP101', departure: { iataCode: 'UIO', at: '2026-10-11T10:00:00.000Z' }, arrival: { iataCode: 'BOG', at: '2026-10-11T11:00:00.000Z' }, marketingCarrier: 'FP', operatingCarrier: 'FP' } }));
    const closeFlightInstance = jest.fn(() => of({}));
    const gateway = new GrpcInventoryGateway({ findFlightInstance, closeFlightInstance });
    await expect(gateway.findFlight({ flightNumber: 'FP101', date: '2026-10-11' })).resolves.toMatchObject({ flightInstanceId: '00000000-0000-0000-0000-000000000001', flightNumber: 'FP101' });
    await gateway.closeFlightInstance('00000000-0000-0000-0000-000000000001');
    expect(closeFlightInstance).toHaveBeenCalledWith({ flightInstanceId: '00000000-0000-0000-0000-000000000001' });
  });

  it('OPS-01: publica el evento de vuelo con el payload público', async () => {
    const publishEvent = jest.fn(() => of({ eventId: '00000000-0000-0000-0000-000000000002' }));
    const publisher = new GrpcEventPublisher({ publishEvent });
    await publisher.publish({ ownerId: 'owner-1', bookingId: 'booking-1', pnr: 'ABC123', eventType: 'flight.cancelled', occurredAt: '2026-10-11T10:00:00.000Z' });
    expect(publishEvent).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'owner-1', payload: expect.objectContaining({ eventType: 'flight.cancelled', data: { bookingId: 'booking-1', pnr: 'ABC123' } }) }));
  });
});
