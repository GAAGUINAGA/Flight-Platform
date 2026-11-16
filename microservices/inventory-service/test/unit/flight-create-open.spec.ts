import { DayWindow } from '@flight-platform/shared';
import { FlightAdmin } from '../../src/application/flight-admin';
import { FlightReader, InventoryTx, UnitOfWork } from '../../src/application/ports';
import { FlightInstance } from '../../src/domain/flight-instance';

const NOW = new Date('2026-11-15T12:00:00Z');
const ID = '11111111-1111-4111-8111-111111111111';
const admin = { correlationId: 'c1', role: 'admin', ownerId: 'a1' };
const customer = { correlationId: 'c1', role: 'customer', ownerId: 'u1' };
const codeOf = async (promise: Promise<unknown>): Promise<string> => { try { await promise; return 'OK'; } catch (error) { const e = error as { code?: string; getError?: () => { details?: string } }; return e.getError?.().details ?? e.code ?? 'UNKNOWN'; } };

function memory() {
  const flights = new Map<string, FlightInstance>();
  const inWindow = (flight: FlightInstance, windows: DayWindow[]) => windows.some((w) => (w.exclude ? !w.iatas.includes(flight.props.departureIata) : w.iatas.includes(flight.props.departureIata)) && flight.props.departureAt >= w.from && flight.props.departureAt < w.to);
  const reader = {
    get: async (id: string) => flights.get(id) ?? null,
    find: async (number: string, windows: DayWindow[]) => [...flights.values()].find((f) => f.props.flightNumber === number && inWindow(f, windows)) ?? null
  } as unknown as FlightReader;
  const tx = {
    saveFlight: async (f: FlightInstance) => { flights.set(f.id, f); },
    setClosed: async (id: string, closed = true) => { const f = flights.get(id); if (!f) return false; flights.set(id, new FlightInstance({ ...f.props, closed })); return true; }
  } as unknown as InventoryTx;
  const uow: UnitOfWork = { run: (fn) => fn(tx) };
  return { flights, service: new FlightAdmin(reader, uow, () => NOW) };
}

const body = (extra: Record<string, unknown> = {}) => ({
  flightInstanceId: ID, flightNumber: 'FP210', departureIata: 'UIO', arrivalIata: 'GPS', departureAt: '2026-11-20T15:00:00.000Z', arrivalAt: '2026-11-20T17:00:00.000Z',
  cabins: [{ cabinClass: 'ECONOMY', capacity: 99 }], aircraft: 'E190', ...extra
});

describe('F12c-4c · Inventory crea cerrado y abre (INV-C)', () => {
  it('INV-C-01 el vuelo nace CERRADO y solo un administrador puede crear', async () => {
    const { service, flights } = memory();
    expect(await codeOf(service.create(customer, body()))).toBe('PERMISSION_DENIED');
    const created = await service.create(admin, body());
    expect(created.props.closed).toBe(true);
    expect(flights.size).toBe(1);
  });
  it('INV-C-02 reintento con el mismo id y los mismos datos devuelve el existente; otros datos con el mismo id ⇒ FLIGHT_ALREADY_EXISTS', async () => {
    const { service, flights } = memory();
    await service.create(admin, body());
    await expect(service.create(admin, body())).resolves.toBeDefined();
    expect(flights.size).toBe(1);
    expect(await codeOf(service.create(admin, body({ aircraft: 'A320' })))).toBe('FLIGHT_ALREADY_EXISTS');
    expect(await codeOf(service.create(admin, body({ cabins: [{ cabinClass: 'ECONOMY', capacity: 98 }] })))).toBe('FLIGHT_ALREADY_EXISTS');
  });
  it('INV-C-03 mismo número y mismo día LOCAL de salida con otro id ⇒ FLIGHT_ALREADY_EXISTS; otro día local sí', async () => {
    const { service } = memory();
    await service.create(admin, body());
    // 04:30Z del 21 sigue siendo el 20 en Guayaquil (UTC-5, 23:30 del 20): mismo día local aunque el día UTC cambie.
    expect(await codeOf(service.create(admin, body({ flightInstanceId: '22222222-2222-4222-8222-222222222222', departureAt: '2026-11-21T04:30:00.000Z', arrivalAt: '2026-11-21T06:30:00.000Z' })))).toBe('FLIGHT_ALREADY_EXISTS');
    await expect(service.create(admin, body({ flightInstanceId: '33333333-3333-4333-8333-333333333333', departureAt: '2026-11-21T15:00:00.000Z', arrivalAt: '2026-11-21T17:00:00.000Z' }))).resolves.toBeDefined();
  });
  it('INV-C-04 validaciones duras: avión obligatorio, zona conocida, origen distinto del destino, llegada posterior, salida futura, capacidad ≥ 1, campos extra', async () => {
    const { service } = memory();
    const { aircraft, ...withoutAircraft } = body(); void aircraft;
    expect(await codeOf(service.create(admin, withoutAircraft))).toBe('VALIDATION_FAILED');
    expect(await codeOf(service.create(admin, body({ arrivalIata: 'XXX' })))).toBe('VALIDATION_FAILED');
    expect(await codeOf(service.create(admin, body({ arrivalIata: 'UIO' })))).toBe('VALIDATION_FAILED');
    expect(await codeOf(service.create(admin, body({ arrivalAt: '2026-11-20T15:00:00.000Z' })))).toBe('VALIDATION_FAILED');
    expect(await codeOf(service.create(admin, body({ departureAt: '2026-11-15T11:00:00.000Z', arrivalAt: '2026-11-15T13:00:00.000Z' })))).toBe('VALIDATION_FAILED');
    expect(await codeOf(service.create(admin, body({ cabins: [{ cabinClass: 'ECONOMY', capacity: 0 }] })))).toBe('VALIDATION_FAILED');
    expect(await codeOf(service.create(admin, body({ cabins: [{ cabinClass: 'ECONOMY', capacity: 5 }, { cabinClass: 'ECONOMY', capacity: 6 }] })))).toBe('VALIDATION_FAILED');
  });
  it('INV-C-05 abrir: solo admin, idempotente, NOT_FOUND si no existe, no reabre un vuelo ya salido', async () => {
    const { service, flights } = memory();
    await service.create(admin, body());
    expect(await codeOf(service.open(customer, { flightInstanceId: ID }))).toBe('PERMISSION_DENIED');
    expect((await service.open(admin, { flightInstanceId: ID })).props.closed).toBe(false);
    expect((await service.open(admin, { flightInstanceId: ID })).props.closed).toBe(false);
    expect(await codeOf(service.open(admin, { flightInstanceId: '99999999-9999-4999-8999-999999999999' }))).toBe('NOT_FOUND');
    const past = flights.get(ID)!; flights.set(ID, new FlightInstance({ ...past.props, closed: true, departureAt: new Date('2026-11-15T11:00:00Z'), arrivalAt: new Date('2026-11-15T13:00:00Z') }));
    expect(await codeOf(service.open(admin, { flightInstanceId: ID }))).toBe('VALIDATION_FAILED');
  });
});
