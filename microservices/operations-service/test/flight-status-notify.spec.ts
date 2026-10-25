import { of } from 'rxjs';
import { DomainError } from '@flight-platform/shared';
import { FlightStatusUseCases } from '../src/application/flight-status';
import { FlightStore, InventoryFlight, InventoryGateway } from '../src/application/ports';
import { OperationalFlight } from '../src/domain/operational-flight';
import { GrpcInventoryGateway, GrpcReservationGateway } from '../src/infrastructure/adapters/grpc-adapters';

class Store implements FlightStore {
  values: OperationalFlight[] = [];
  async find(n: string, d: string) { return this.values.find((x) => x.props.flightNumber === n && x.props.date === d) ?? null; }
  async findByInstance(id: string) { return this.values.find((x) => x.props.flightInstanceId === id) ?? null; }
  async save(x: OperationalFlight) { x.props.id = '1'; this.values.push(x); }
  async update() { /* in memory */ }
}
const id = '00000000-0000-4000-8000-000000000001';
const flight: InventoryFlight = { flightInstanceId: id, flightNumber: 'FP101', departure: { iataCode: 'UIO', at: '2026-10-11T10:00:00.000Z' }, arrival: { iataCode: 'BOG', at: '2026-10-11T11:00:00.000Z' }, marketingCarrier: 'FP', operatingCarrier: 'FP' };
const inventory = (overrides: Partial<InventoryGateway> = {}): InventoryGateway => ({ findFlight: async () => flight, getFlight: async () => flight, closeFlightInstance: async () => undefined, ...overrides });

describe('OPS-ADM: actualización operacional sobre vuelos sin estado y notificaciones', () => {
  it('OPS-ADM-01: crea el estado desde Inventory cuando el vuelo aún no lo tiene', async () => {
    const store = new Store(); const getFlight = jest.fn(async () => flight);
    const useCases = new FlightStatusUseCases(store, inventory({ getFlight }), { listByFlightInstance: async () => [] }, { publish: async () => undefined }, 15);
    const result = await useCases.update({ flightInstanceId: id, status: 'DELAYED', estimatedDepartureAt: '2026-10-11T10:40:00.000Z' });
    expect(getFlight).toHaveBeenCalledWith(id);
    expect(result.props).toMatchObject({ flightInstanceId: id, flightNumber: 'FP101', date: '2026-10-11', status: 'DELAYED' });
    expect(store.values).toHaveLength(1);
  });

  it('OPS-ADM-02: un vuelo que no existe en Inventory devuelve NOT_FOUND', async () => {
    const useCases = new FlightStatusUseCases(new Store(), inventory({ getFlight: async () => { throw new DomainError('NOT_FOUND'); } }), { listByFlightInstance: async () => [] }, { publish: async () => undefined }, 15);
    await expect(useCases.update({ flightInstanceId: id, status: 'DELAYED' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('OPS-ADM-03: si Reservation falla, la cancelación y el cierre se mantienen, se registra dependencia y código, y el reintento notifica', async () => {
    const store = new Store(); const close = jest.fn(async () => undefined); const publish = jest.fn(async () => undefined); const warn = jest.fn();
    const list = jest.fn().mockRejectedValueOnce(Object.assign(new Error('boom for jane@example.com'), { code: 14 })).mockResolvedValue([{ bookingId: 'b', ownerId: 'o', pnr: 'ABC123' }]);
    const useCases = new FlightStatusUseCases(store, inventory({ closeFlightInstance: close }), { listByFlightInstance: list }, { publish }, 15, warn);
    const first = await useCases.update({ flightInstanceId: id, status: 'CANCELLED' });
    expect(first.props.status).toBe('CANCELLED'); expect(close).toHaveBeenCalledTimes(1); expect(publish).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('operational notification skipped dependency=reservation code=14');
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/jane|example|boom/);
    await useCases.update({ flightInstanceId: id, status: 'CANCELLED' });
    expect(close).toHaveBeenCalledTimes(1); expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'o', eventType: 'flight.cancelled' }));
  });

  it('OPS-ADM-04: GrpcReservationGateway recorre todas las páginas y conserva ownerId', async () => {
    const pages: Record<string, { items: Array<{ bookingId: string; ownerId: string; pnr?: string }>; nextCursor?: string }> = {
      first: { items: [{ bookingId: 'b1', ownerId: 'o1', pnr: 'AAAAAA' }, { bookingId: 'b2', ownerId: 'o2' }], nextCursor: 'c1' },
      c1: { items: [{ bookingId: 'b3', ownerId: 'o1' }], nextCursor: 'c2' },
      c2: { items: [{ bookingId: 'b4', ownerId: 'o3' }] }
    };
    const requests: unknown[] = [];
    const gateway = new GrpcReservationGateway({ listReservationsByFlightInstance: (input) => { requests.push(input); return of(pages[input.cursor ?? 'first']); } });
    const result = await gateway.listByFlightInstance(id);
    expect(result.map((item) => item.bookingId)).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(result.map((item) => item.ownerId)).toEqual(['o1', 'o2', 'o1', 'o3']);
    expect(requests).toEqual([{ flightInstanceId: id, limit: 50 }, { flightInstanceId: id, limit: 50, cursor: 'c1' }, { flightInstanceId: id, limit: 50, cursor: 'c2' }]);
  });

  it('OPS-ADM-05: GrpcInventoryGateway.getFlight traduce NOT_FOUND y devuelve el segmento con su id', async () => {
    const found = new GrpcInventoryGateway({ findFlightInstance: () => of({ flightInstanceId: id, segment: flight }), closeFlightInstance: () => of({}), getFlightInstance: () => of({ flightInstanceId: id, segment: flight }) });
    await expect(found.getFlight(id)).resolves.toMatchObject({ flightInstanceId: id, flightNumber: 'FP101' });
    const missing = new GrpcInventoryGateway({ findFlightInstance: () => of(), closeFlightInstance: () => of({}), getFlightInstance: () => { throw Object.assign(new Error('x'), { code: 5 }); } });
    await expect(missing.getFlight(id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
