import { Metadata } from '@grpc/grpc-js';
import { of } from 'rxjs';
import { GrpcCheckInReservation, GrpcCheckInSeats, GrpcCheckInTicketing } from '../src/infrastructure/adapters/check-in-grpc';

const options = { url: 'localhost:50054', internalApiKey: 'x'.repeat(40), correlationId: 'check-in-test', role: 'system' };

describe('DCS-01: clientes con owner por llamada', () => {
  it('DCS-01: snapshot propaga el owner de cada reserva en metadata', async () => {
    const getReservationSnapshot = jest.fn((request: unknown, metadata?: Metadata) => { void request; void metadata; return of({ bookingId: 'b', pnr: 'ABC123', status: 'CONFIRMED', passengers: [], itineraries: [] }); });
    const gateway = new GrpcCheckInReservation({ getReservationSnapshot }, options);
    await expect(gateway.getSnapshot('owner-a', 'b')).resolves.toMatchObject({ bookingId: 'b', status: 'CONFIRMED' });
    await gateway.getSnapshot('owner-b', 'b');
    expect(getReservationSnapshot.mock.calls[0][1]?.get('x-owner-id')).toEqual(['owner-a']);
    expect(getReservationSnapshot.mock.calls[1][1]?.get('x-owner-id')).toEqual(['owner-b']);
  });
  it('DCS-01: cupones preservan el owner y devuelven los estados', async () => {
    const getCouponsForBooking = jest.fn((request: unknown, metadata?: Metadata) => { void request; void metadata; return of({ coupons: [{ passengerId: 'p', segmentId: 's', status: 'ISSUED' }] }); });
    const gateway = new GrpcCheckInTicketing({ getCouponsForBooking }, options);
    await expect(gateway.getCoupons('owner-a', 'b')).resolves.toEqual([{ passengerId: 'p', segmentId: 's', status: 'ISSUED' }]);
    expect(getCouponsForBooking.mock.calls[0][1]?.get('x-owner-id')).toEqual(['owner-a']);
  });
  it('DCS-01: asignación envía pasajero y segmento con owner en metadata', async () => {
    const assignSeatAtCheckIn = jest.fn((request: unknown, metadata?: Metadata) => { void request; void metadata; return of({ seatNumber: '12A', status: 'CHECKED_IN' }); });
    const gateway = new GrpcCheckInSeats({ assignSeatAtCheckIn }, options);
    const input = { ownerId: 'owner-a', bookingId: 'b', passengerId: 'p', segmentId: 's', passengerType: 'ADULT', cabinClass: 'ECONOMY' };
    await expect(gateway.assign(input)).resolves.toEqual({ seatNumber: '12A', status: 'CHECKED_IN' });
    expect(assignSeatAtCheckIn.mock.calls[0][0]).toEqual(input);
    expect(assignSeatAtCheckIn.mock.calls[0][1]?.get('x-owner-id')).toEqual(['owner-a']);
  });
});
