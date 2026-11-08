import { CheckInUseCase } from '../src/application/check-in';
import { CheckInPass, CheckInResult, CheckInStore } from '../src/application/check-in-ports';
import { FlightStatusUseCases } from '../src/application/flight-status';
import { FlightStore } from '../src/application/ports';
import { OperationalFlight } from '../src/domain/operational-flight';

// NFR-TI-01 / ADR-F12b1fix-02 (LD-09): operations usa la fecha local del aeropuerto de origen.
const bookingId = '00000000-0000-4000-8000-000000000001';
const segmentId = '00000000-0000-4000-8000-000000000002';
const flightId = '00000000-0000-4000-8000-000000000003';
const passengerId = '00000000-0000-4000-8000-000000000004';

class MemoryFlights implements FlightStore {
  values: OperationalFlight[] = [];
  async find(n: string, d: string) { return this.values.find((x) => x.props.flightNumber === n && x.props.date === d) ?? null; }
  async findByInstance(id: string) { return this.values.find((x) => x.props.flightInstanceId === id) ?? null; }
  async save(x: OperationalFlight) { x.props.id = '1'; this.values.push(x); }
  async update() {}
}

class MemoryCheckIn implements CheckInStore {
  result: CheckInResult | null = null; begun = false; passes: CheckInPass[] = [];
  async find() { return this.begun ? { status: this.result?.status ?? 'IN_PROGRESS', result: this.result, eventPublished: false } : null; }
  async begin() { if (this.begun) return false; this.begun = true; return true; }
  async resume() { return this.begun; }
  async savePass(_o: string, _b: string, pass: CheckInPass) { this.passes.push(pass); }
  async complete(_o: string, result: CheckInResult) { this.result = result; }
  async abort() { this.begun = false; }
  async restore() {}
  async listPasses() { return this.passes; }
  async claimStale() { return []; }
  async releaseRecoveryClaim() { return undefined; }
  async markBlocked() { return undefined; }
  async listUnpublished() { return []; }
  async markEventPublished() {}
}

describe('LD-09 operations', () => {
  it('el estado materializado guarda la fecha local del origen: LIM 22:30 locales (03:30Z) → día 10; sin zona, UTC', async () => {
    const make = async (iataCode: string) => {
      const flights = new MemoryFlights();
      const inventory = { findFlight: async () => { throw new Error(); }, getFlight: async () => ({ flightInstanceId: flightId, flightNumber: 'FP500', departure: { iataCode, at: '2030-06-11T03:30:00Z' }, arrival: { iataCode: 'MAD', at: '2030-06-11T14:00:00Z' }, marketingCarrier: 'FP', operatingCarrier: 'FP' }), closeFlightInstance: async () => undefined };
      const useCases = new FlightStatusUseCases(flights, inventory as never, { listByFlightInstance: async () => [] }, { publish: async () => undefined }, 15);
      await useCases.update({ flightInstanceId: flightId, status: 'CANCELLED' });
      return flights.values[0].props.date;
    };
    expect(await make('LIM')).toBe('2030-06-10');
    expect(await make('UIO')).toBe('2030-06-10');
    expect(await make('MAD')).toBe('2030-06-11');
    expect(await make('QQQ')).toBe('2030-06-11');
  });

  it('el pasaporte que vence el día local de la salida es válido (con el corte UTC se rechazaba)', async () => {
    const run = async (documentExpiryDate: string) => {
      const store = new MemoryCheckIn();
      const snapshot = { bookingId, pnr: 'ABC123', status: 'CONFIRMED', passengers: [{ passengerId, passengerType: 'ADULT' as const, documentType: 'PASSPORT', documentExpiryDate }], itineraries: [{ itineraryId: 'i', segments: [{ segmentId, flightInstanceId: flightId, flightNumber: 'FP500', departure: { iataCode: 'LIM', at: '2030-06-11T03:30:00.000Z' } }], pricingOptions: [{ cabinClass: 'ECONOMY' }] }] };
      const useCase = new CheckInUseCase({ getSnapshot: async () => snapshot }, { getCoupons: async () => [{ passengerId, segmentId, status: 'ISSUED' }] }, { assign: async () => ({ seatNumber: '12A', status: 'CHECKED_IN' }) }, new MemoryFlights(), store, { publish: async () => undefined }, () => new Date('2030-06-10T12:00:00.000Z'), 48, 60);
      const result = await useCase.execute({ ownerId: 'owner', bookingId });
      return result.checkedInPassengers[0].segments[0].status;
    };
    expect(await run('2030-06-10')).toBe('CHECKED_IN');
    expect(await run('2030-06-09')).toBe('FAILED');
  });
});
