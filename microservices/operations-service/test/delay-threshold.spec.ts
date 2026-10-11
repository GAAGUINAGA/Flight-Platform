import { FlightStatusUseCases } from '../src/application/flight-status';
import { FlightStore } from '../src/application/ports';
import { OperationalFlight } from '../src/domain/operational-flight';

class Store implements FlightStore {
  constructor(private readonly flight: OperationalFlight) {}
  async find() { return this.flight; }
  async findByInstance() { return this.flight; }
  async save() { return undefined; }
  async update() { return undefined; }
}

describe('OPS-05: umbral de retraso', () => {
  it('OPS-05: publica flight.schedule_changed solo desde DELAY_THRESHOLD_MINUTES', async () => {
    const flight = new OperationalFlight({ id: '1', flightInstanceId: '00000000-0000-0000-0000-000000000001', flightNumber: 'FP101', date: '2026-10-11', marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: 'UIO', arrivalIata: 'BOG', scheduledDepartureAt: new Date('2026-10-11T10:00:00.000Z'), scheduledArrivalAt: new Date('2026-10-11T11:00:00.000Z'), status: 'SCHEDULED' });
    const events: string[] = [];
    const useCases = new FlightStatusUseCases(new Store(flight), { findFlight: async () => { throw new Error('not used'); }, closeFlightInstance: async () => undefined }, { listByFlightInstance: async () => [{ bookingId: 'booking-1', ownerId: 'owner-1' }] }, { publish: async (event) => { events.push(event.eventType); } }, 15);
    await useCases.update({ flightInstanceId: flight.props.flightInstanceId, status: 'DELAYED', estimatedDepartureAt: '2026-10-11T10:14:00.000Z' });
    expect(events).toEqual([]);
    await useCases.update({ flightInstanceId: flight.props.flightInstanceId, status: 'DELAYED', estimatedDepartureAt: '2026-10-11T10:15:00.000Z' });
    expect(events).toEqual(['flight.schedule_changed']);
  });
});
