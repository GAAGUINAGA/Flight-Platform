import { describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { InternalKeyInterceptor, invalidParamsFromMetadata } from '@flight-platform/shared';
import { lastValueFrom, of } from 'rxjs';
import { Metadata } from '@grpc/grpc-js';
import { ReservationController } from '../src/infrastructure/grpc/reservation.controller';
import { ReservationExceptionFilter } from '../src/infrastructure/grpc/filters';
import { validatePassengers } from '../src/domain/passengers';

/**
 * ADR-F12b1fix-05, punto 12: cuando la validación de pasajeros rechaza, el error gRPC lleva en su metadata final la lista de campos inválidos
 * (`passengers.<índice>.<campo>` + motivo de una lista cerrada), sin valores ni datos personales.
 */
const KEY = 'k'.repeat(32);
const base = { passengerId: 'pax-1', passengerType: 'ADULT', firstName: 'Ana', lastName: 'Pérez', documentType: 'PASSPORT', documentNumber: 'AB1234567', nationality: 'EC', documentExpiryDate: '2030-01-01', birthDate: '1990-01-01', gender: 'F', contact: { email: 'ana@example.com', phone: '+593990000000' }, assignedSeats: [], extraBaggage: [] };
const metadata = async (): Promise<Metadata> => {
  const value = new Metadata(); value.set('x-internal-key', KEY); value.set('x-owner-id', 'sub-cliente'); value.set('x-role', 'customer');
  await new Promise((resolve) => new InternalKeyInterceptor(KEY).intercept({ switchToRpc: () => ({ getContext: () => value }) } as never, { handle: () => of(null) }).subscribe({ complete: () => resolve(null) }));
  return value;
};
const create = (passengers: unknown[]) => ({ holdId: randomUUID(), passengers, payment: { paymentReference: 'pay_ok_1' }, idempotencyKey: randomUUID() });
const wire = async (thrown: unknown) => lastValueFrom(new ReservationExceptionFilter().catch(thrown)).catch((safe: unknown) => safe as { code: number; details: string; metadata?: Metadata });
/** El controlador valida de forma síncrona: lanza antes de devolver la promesa. */
const thrownBy = async (input: unknown): Promise<unknown> => {
  const controller = new ReservationController({ createReservation: async () => ({ ok: true }) });
  try { await controller.createReservation(input, await metadata()); } catch (error) { return error; }
  throw new Error('se esperaba un rechazo');
};
const failure = async (passengers: unknown[]) => wire(await thrownBy(create(passengers)));

describe('F12b1fix punto 12: Reservation emite los campos inválidos', () => {
  it('RSV-INV-01 el esquema (Zod) rechaza varios campos de varios pasajeros: la lista los trae todos con su índice y motivo', async () => {
    const safe = await failure([{ ...base, firstName: 'Ana2', contact: { email: 'ana@', phone: '+593990000000' } }, { ...base, passengerId: 'pax-2', documentNumber: 'AB-12', gender: 'Z' }]);
    expect(safe).toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
    expect(invalidParamsFromMetadata(safe.metadata)).toEqual(expect.arrayContaining([
      { name: 'passengers.0.firstName', reason: 'INVALID_FORMAT' }, { name: 'passengers.0.contact.email', reason: 'INVALID_FORMAT' },
      { name: 'passengers.1.documentNumber', reason: 'INVALID_FORMAT' }, { name: 'passengers.1.gender', reason: 'INVALID_FORMAT' }
    ]));
  });
  it('RSV-INV-02 un campo que falta es REQUIRED y una cantidad de maletas fuera de rango es OUT_OF_RANGE', async () => {
    const { lastName: _omitted, ...withoutLastName } = base; void _omitted;
    const safe = await failure([{ ...withoutLastName, extraBaggage: [{ itineraryId: randomUUID(), quantity: 9 }] }]);
    expect(invalidParamsFromMetadata(safe.metadata)).toEqual(expect.arrayContaining([{ name: 'passengers.0.lastName', reason: 'REQUIRED' }, { name: 'passengers.0.extraBaggage.0.quantity', reason: 'OUT_OF_RANGE' }]));
  });
  it('RSV-INV-03 la lista nunca lleva valores ni datos personales (nombre, documento, correo, teléfono, fecha)', async () => {
    const safe = await failure([{ ...base, firstName: 'Secreto2', documentNumber: 'DOC-SECRETO', contact: { email: 'secreto@', phone: '099SECRETO' }, birthDate: '1990-13-45' }]);
    const raw = String((safe.metadata as Metadata).get('invalid-params')[0]);
    for (const secret of ['Secreto', 'SECRETO', 'secreto', '1990', '099']) expect(raw).not.toContain(secret);
    expect(raw).toMatch(/passengers\.0\.firstName/);
  });
  it('RSV-INV-04 un campo que no es de pasajeros (p. ej. holdId) sigue siendo VALIDATION_FAILED, pero sin nombrarlo en la lista', async () => {
    const safe = await wire(await thrownBy({ ...create([base]), holdId: 'no-es-uuid' }));
    expect(safe).toMatchObject({ code: 3, details: 'VALIDATION_FAILED' }); expect(safe.metadata).toBeUndefined();
  });
  it('RSV-INV-05 la regla compartida de conjunto (edad por tipo) también emite el campo: AGE_NOT_ALLOWED_FOR_TYPE en birthDate del pasajero', async () => {
    const passengers = [{ passengerId: 'a1', passengerType: 'ADULT' as const, birthDate: '2015-01-01' }];
    let thrown: unknown; try { validatePassengers(passengers, { adults: 1, youths: 0, children: 0, infants: 0 }, new Date('2026-06-15T00:00:00Z')); } catch (error) { thrown = error; }
    const safe = await wire(thrown);
    expect(safe).toMatchObject({ code: 3, details: 'VALIDATION_FAILED' });
    expect(invalidParamsFromMetadata(safe.metadata)).toEqual([{ name: 'passengers.0.birthDate', reason: 'AGE_NOT_ALLOWED_FOR_TYPE' }]);
  });
  it('RSV-INV-06 INFANT_SEAT_NOT_ALLOWED conserva su código propio (no se convierte en VALIDATION_FAILED con campos)', async () => {
    const passengers = [{ passengerId: 'a1', passengerType: 'ADULT' as const, birthDate: '1990-01-01' }, { passengerId: 'i1', passengerType: 'INFANT' as const, associatedAdultId: 'a1', birthDate: '2026-01-01', assignedSeats: [{}] }];
    let thrown: unknown; try { validatePassengers(passengers, { adults: 1, youths: 0, children: 0, infants: 1 }, new Date('2026-06-15T00:00:00Z')); } catch (error) { thrown = error; }
    const safe = await wire(thrown);
    expect(safe).toMatchObject({ details: 'INFANT_SEAT_NOT_ALLOWED' }); expect(safe.metadata).toBeUndefined();
  });
});
