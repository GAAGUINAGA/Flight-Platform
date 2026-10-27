import { describe, expect, it } from '@jest/globals';
import { OperationalFlight, type OperationalStatus } from '../../../../microservices/operations-service/src/domain/operational-flight';
import { canTransition, FLIGHT_STATUSES } from './flight-transitions';

const flight = (status: OperationalStatus) => new OperationalFlight({ id: 'x', flightInstanceId: 'y', flightNumber: 'FP1000', date: '2026-11-20', marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: 'AAA', arrivalIata: 'BBB', scheduledDepartureAt: new Date(), scheduledArrivalAt: new Date(), status });

describe('F12a P6 · tabla de transiciones del Gateway frente a la de Operations', () => {
  const pairs = FLIGHT_STATUSES.flatMap((from) => FLIGHT_STATUSES.map((to) => [from, to] as const));
  it.each(pairs)('V2-P6-EQ %s → %s: el Gateway y el dominio de Operations coinciden', (from, to) => {
    let domainAllows = true; try { flight(from).transition(to); } catch { domainAllows = false; }
    expect(canTransition(from, to)).toBe(domainAllows);
  });
  it('V2-P6-EQ-00 los siete estados del contrato v2 están cubiertos', () => { expect([...FLIGHT_STATUSES].sort()).toEqual(['ARRIVED', 'BOARDING', 'CANCELLED', 'DELAYED', 'DEPARTED', 'DIVERTED', 'SCHEDULED']); });
});
