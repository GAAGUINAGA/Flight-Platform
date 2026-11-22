import { describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { InternalKeyInterceptor } from '@flight-platform/shared';
import { lastValueFrom, of } from 'rxjs';
import { ReservationExceptionFilter } from '../src/infrastructure/grpc/filters';
import { Metadata } from '@grpc/grpc-js';
import { ReservationController } from '../src/infrastructure/grpc/reservation.controller';

/**
 * ADR-F12b1fix-05: nombres y apellidos con la regla compartida (letras Unicode, marcas, espacios simples, apóstrofo, guion y punto; 1 a 50 tras recortar).
 * Reservation rechaza lo demás con VALIDATION_FAILED. El resto de los campos conserva la regla de siempre (casos de paridad abajo).
 */
const KEY = 'k'.repeat(32);
const base = { passengerId: 'pax-1', passengerType: 'ADULT', firstName: 'Ana', lastName: 'Pérez', documentType: 'PASSPORT', documentNumber: 'AB1234567', nationality: 'EC', documentExpiryDate: '2030-01-01', birthDate: '1990-01-01', gender: 'F', contact: { email: 'ana@example.com', phone: '+593990000000' }, assignedSeats: [], extraBaggage: [] };
const metadata = async (): Promise<Metadata> => {
  const value = new Metadata(); value.set('x-internal-key', KEY); value.set('x-owner-id', 'sub-cliente'); value.set('x-role', 'customer');
  await new Promise((resolve) => new InternalKeyInterceptor(KEY).intercept({ switchToRpc: () => ({ getContext: () => value }) } as never, { handle: () => of(null) }).subscribe({ complete: () => resolve(null) }));
  return value;
};
/** Lo que sale al cable: el filtro de excepciones del servicio convierte el error lanzado en `{ code, details, metadata? }`. */
const rejection = async (error: unknown): Promise<{ code: number; details: string }> => lastValueFrom(new ReservationExceptionFilter().catch(error)).catch((safe: unknown) => safe as { code: number; details: string });
const request = (passenger: Record<string, unknown>) => ({ holdId: randomUUID(), passengers: [passenger], payment: { paymentReference: 'pay_ok_1' }, idempotencyKey: randomUUID() });
const setup = () => { const received: Array<{ passengers: Array<Record<string, unknown>> }> = []; return { received, controller: new ReservationController({ createReservation: async (input: unknown) => { received.push(input as never); return { ok: true }; } }) }; };
const accepted = async (patch: Record<string, unknown>): Promise<boolean> => {
  const { received, controller } = setup();
  try { await controller.createReservation(request({ ...base, ...patch }), await metadata()); return received.length === 1; } catch (error) { expect(await rejection(error)).toMatchObject({ code: 3, details: 'VALIDATION_FAILED' }); return false; }
};

describe('F12b1fix: nombres y apellidos en createReservation', () => {
  it.each(['José María', "O'Brien", 'Ana-Lucía', 'Núñez', 'St. John', 'Ñandú'])('RSV-NAME-01 acepta %s (nombres y apellidos)', async (name) => {
    expect(await accepted({ firstName: name })).toBe(true); expect(await accepted({ lastName: name })).toBe(true);
  });
  it('RSV-NAME-02 acepta exactamente 50 caracteres y recorta los espacios de los extremos antes de entregar el pasajero', async () => {
    expect(await accepted({ firstName: 'a'.repeat(50) })).toBe(true);
    const { received, controller } = setup();
    await controller.createReservation(request({ ...base, firstName: '  Ana María  ', lastName: ' Pérez ' }), await metadata());
    expect(received[0].passengers[0]).toMatchObject({ firstName: 'Ana María', lastName: 'Pérez' });
  });
  it.each([['con dígitos', 'Ana2'], ['solo dígitos', '12345'], ['con emoji', 'Ana 😀'], ['con símbolos', 'Ana@#'], ['solo espacios', '     '], ['vacío', ''], ['de 51 caracteres', 'a'.repeat(51)], ['con espacio doble', 'Ana  María'], ['con guion bajo', 'Ana_María']])('RSV-NAME-03 rechaza un nombre %s con VALIDATION_FAILED', async (_label, name) => {
    expect(await accepted({ firstName: name })).toBe(false); expect(await accepted({ lastName: name })).toBe(false);
  });
});

describe('F12b1fix: las demás reglas de campo siguen como estaban (paridad con la regla anterior)', () => {
  it.each([['documento con guion', { documentNumber: 'AB-12345' }], ['documento de 4', { documentNumber: 'AB12' }], ['teléfono con espacios', { contact: { email: 'ana@example.com', phone: '+593 99 000 0000' } }], ['teléfono sin +', { contact: { email: 'ana@example.com', phone: '593990000000' } }], ['correo sin dominio', { contact: { email: 'ana@', phone: '+593990000000' } }], ['nacionalidad de 1 letra', { nationality: 'E' }], ['nacionalidad de 4 letras', { nationality: 'ECUA' }], ['género inválido', { gender: 'Z' }], ['fecha inexistente', { birthDate: '1990-02-30' }]])('RSV-NAME-04 rechaza %s', async (_label, patch) => {
    expect(await accepted(patch)).toBe(false);
  });
  it.each([['nacionalidad de 3 letras', { nationality: 'ECU' }], ['género X', { gender: 'X' }], ['documento de 20', { documentNumber: 'A'.repeat(20) }]])('RSV-NAME-05 acepta %s', async (_label, patch) => {
    expect(await accepted(patch)).toBe(true);
  });
});
