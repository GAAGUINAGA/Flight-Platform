import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { Metadata } from '@grpc/grpc-js';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { of } from 'rxjs';
import { parse } from 'yaml';
import { buildCloudEvent } from '../../webhooks-service/src/domain/webhook';
import { ListBoardingPasses } from '../src/application/boarding-passes';
import { GrpcEventPublisher } from '../src/infrastructure/adapters/grpc-adapters';
import { OperationsController } from '../src/infrastructure/grpc/operations.controller';
import { OperationalFlight } from '../src/domain/operational-flight';
import { CheckInStore } from '../src/application/check-in-ports';
import { FlightStore } from '../src/application/ports';

const spec = parse(readFileSync(join(process.cwd(), 'contracts/openapi/vuelos-openapi-v2.yaml'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true }); addFormats(ajv);
const check = (name: string) => ajv.compile({ $ref: `#/components/schemas/${name}`, components: spec.components });
const bookingId = randomUUID(); const passengerId = randomUUID(); const segmentId = randomUUID(); const flightId = randomUUID();
const flight = (gate?: string) => new OperationalFlight({ id: flightId, flightInstanceId: flightId, flightNumber: 'FP101', date: '2026-11-20', marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: 'UIO', arrivalIata: 'GYE', scheduledDepartureAt: new Date('2026-11-20T12:00:00Z'), scheduledArrivalAt: new Date('2026-11-20T13:00:00Z'), status: 'BOARDING', ...(gate ? { departureGate: gate } : {}) });

describe('Entrega 3: contrato v2 de Booking', () => {
  it('booking.checked_in lleva el estado real de la reserva y valida como EventCheckedIn', async () => {
    const publishEvent = jest.fn(() => of({ eventId: randomUUID() }));
    await new GrpcEventPublisher({ publishEvent }).publish({ ownerId: 'booking~u1', bookingId, pnr: 'ABC234', status: 'CONFIRMED', eventType: 'booking.checked_in', occurredAt: '2026-11-20T10:00:00Z' });
    const call = publishEvent.mock.calls[0][0] as unknown as { ownerId: string; payload: { eventId: string; eventType: 'booking.checked_in'; occurredAt: string; apiVersion: string; data: { bookingId: string; pnr: string; status: string } } };
    const event = buildCloudEvent({ ...call.payload, ownerId: call.ownerId }, 'gabatair');
    expect(event).toMatchObject({ data: { bookingId, pnr: 'ABC234', status: 'CONFIRMED', ownerId: 'u1' } });
    const valid = check('EventCheckedIn'); expect({ valid: valid(event), errors: valid.errors }).toEqual({ valid: true, errors: null });
    expect(valid({ ...event, data: { bookingId, pnr: 'ABC234' } })).toBe(false);
  });

  it.each([['A6', 'A6'], [undefined, undefined]])('gate %s valida en FlightStatus y BoardingPass', async (gate, expected) => {
    const current = flight(gate);
    const controller = new OperationsController({ useCases: { get: async () => current }, validateResponse: () => undefined } as never);
    const status = await controller.getFlightStatus({ flightNumber: 'FP101', date: '2026-11-20' }, new Metadata());
    expect(status.departure.gate).toBe(expected);
    const validFlight = check('FlightStatus'); expect({ valid: validFlight(status), errors: validFlight.errors }).toEqual({ valid: true, errors: null });
    const passes = new ListBoardingPasses({ getSnapshot: async () => ({ bookingId, pnr: 'ABC234', status: 'CONFIRMED', passengers: [{ passengerId, passengerType: 'ADULT' as const, documentType: 'NATIONAL_ID' }], itineraries: [{ itineraryId: 'i', segments: [{ segmentId, flightInstanceId: flightId, flightNumber: 'FP101', departure: { at: '2026-11-20T12:00:00Z' } }], pricingOptions: [{ cabinClass: 'ECONOMY' }] }] }) }, { findByInstance: async () => current } as FlightStore, { listPasses: async () => [{ passengerId, segmentId, seat: '12A', barcode: 'M1/opaque/12A', barcodeType: 'QR' }] } as unknown as CheckInStore);
    const response = await passes.execute({ ownerId: 'booking~u1', bookingId });
    expect(response.boardingPasses[0].gate).toBe(expected);
    const validPass = check('BoardingPass'); expect({ valid: validPass(response.boardingPasses[0]), errors: validPass.errors }).toEqual({ valid: true, errors: null });
    if (gate) {
      const invalid = { ...response.boardingPasses[0], gate: 42 }; expect(validPass(invalid)).toBe(false);
    }
  });
});
