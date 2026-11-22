import { describe, expect, it } from 'vitest';
import { passengerDraft } from '../../test/passenger-fixtures';
import { emptyPassenger, type PassengerDraft } from './passenger-rules';
import { BAGGAGE_OVER_MESSAGE, FIELD_ERROR_CODES, mapServerErrors } from './server-errors';

const adult = (index: number, patch: Partial<PassengerDraft> = {}): PassengerDraft => ({ ...passengerDraft(emptyPassenger(`PAX-${index + 1}`, 'ADULT'), index), ...patch });
const params = (...names: string[]) => names.map((name) => ({ name, reason: 'valor no válido' }));
const map = (code: string, names: string[], drafts: PassengerDraft[]) => mapServerErrors({ code, invalidParams: params(...names) }, drafts);

describe('invalidParams del servidor → campo y pasajero (ADR-F12b1fix-05)', () => {
  it('SRV-01 los nombres del contrato (`passengers.<i>.<campo>`), con o sin el prefijo `input.` de GraphQL, llegan al campo y pasajero', () => {
    const drafts = [adult(0), adult(1)];
    const { errors, unmapped } = map('VALIDATION_FAILED', ['input.passengers.1.firstName', 'passengers.0.documentNumber', 'input.passengers.0.birthDate'], drafts);
    expect(Object.keys(errors).sort()).toEqual(['0.birthDate', '0.documentNumber', '1.firstName']); expect(unmapped).toBe(0);
    expect(errors['1.firstName']).toContain('nombres'); expect(errors['0.documentNumber']).toContain('5 y 20');
  });
  it('SRV-02 `contact.email` y `contact.phone` se llevan a los campos `email` y `phone` del formulario', () => {
    const { errors } = map('VALIDATION_FAILED', ['input.passengers.0.contact.email', 'input.passengers.0.contact.phone'], [adult(0)]);
    expect(errors['0.email']).toBe('Escribe un correo electrónico válido.'); expect(errors['0.phone']).toContain('código de país');
  });
  it('SRV-03 `extraBaggage.<n>.quantity` es la posición en la lista ENVIADA (solo tramos con cantidad > 0) y se lleva al campo del tramo', () => {
    const drafts = [adult(0, { extraBaggage: { 'it-a': 0, 'it-b': 2, 'it-c': 1 } })];
    expect(map('VALIDATION_FAILED', ['input.passengers.0.extraBaggage.0.quantity'], drafts).errors).toEqual({ '0.extraBaggage.it-b': BAGGAGE_OVER_MESSAGE });
    expect(map('VALIDATION_FAILED', ['passengers.0.extraBaggage.1.quantity'], drafts).errors).toEqual({ '0.extraBaggage.it-c': BAGGAGE_OVER_MESSAGE });
  });
  it('SRV-04 lo que no es un dato del formulario (passengerId, asientos, un pasajero que no existe, otro recurso) queda sin mapear y no inventa errores', () => {
    const { errors, unmapped } = map('VALIDATION_FAILED', ['passengers.0.passengerId', 'passengers.0.assignedSeats.0.seatNumber', 'passengers.7.firstName', 'holdId', 'passengers.0.extraBaggage.5.quantity'], [adult(0)]);
    expect(errors).toEqual({}); expect(unmapped).toBe(5);
  });
  it('SRV-11 el motivo de la lista cerrada del servidor afina el texto: AGE_NOT_ALLOWED_FOR_TYPE usa la regla de edad del tipo; REQUIRED, «Completa este dato»; los demás, la regla del campo', () => {
    const baby = adult(1, { passengerType: 'INFANT' });
    const { errors } = mapServerErrors({ code: 'VALIDATION_FAILED', invalidParams: [{ name: 'passengers.1.birthDate', reason: 'AGE_NOT_ALLOWED_FOR_TYPE' }, { name: 'passengers.0.lastName', reason: 'REQUIRED' }, { name: 'passengers.0.firstName', reason: 'INVALID_FORMAT' }, { name: 'passengers.0.gender', reason: 'OUT_OF_RANGE' }] }, [adult(0), baby]);
    expect(errors['1.birthDate']).toMatch(/infante.*menor de 2 años/); expect(errors['0.lastName']).toBe('Completa este dato.');
    expect(errors['0.firstName']).toContain('nombres'); expect(errors['0.gender']).toBe('Elige el género.');
  });
  it('SRV-05 VALIDATION_FAILED sin invalidParams (un servicio antiguo, o un rechazo que no es de un campo) no marca ningún campo', () => {
    expect(map('VALIDATION_FAILED', [], [adult(0)])).toEqual({ errors: {}, unmapped: 0 });
  });
  it('SRV-06 BAGGAGE_LIMIT_EXCEEDED (sin pasajero ni tramo) marca el campo de maletas de cada pasajero y tramo que pidió maletas; sin maletas no marca nada', () => {
    const drafts = [adult(0, { extraBaggage: { 'it-1': 2, 'it-2': 0 } }), adult(1), adult(2, { extraBaggage: { 'it-1': 1 } })];
    expect(map('BAGGAGE_LIMIT_EXCEEDED', [], drafts).errors).toEqual({ '0.extraBaggage.it-1': BAGGAGE_OVER_MESSAGE, '2.extraBaggage.it-1': BAGGAGE_OVER_MESSAGE });
    expect(map('BAGGAGE_LIMIT_EXCEEDED', [], [adult(0)]).errors).toEqual({});
  });
  it('SRV-07 si el servidor sí nombró el campo, no se marca lo demás por el código de negocio', () => {
    const drafts = [adult(0, { extraBaggage: { 'it-1': 1 } }), adult(1, { extraBaggage: { 'it-1': 1 } })];
    expect(map('BAGGAGE_LIMIT_EXCEEDED', ['passengers.1.extraBaggage.0.quantity'], drafts).errors).toEqual({ '1.extraBaggage.it-1': BAGGAGE_OVER_MESSAGE });
  });
  it('SRV-08 INFANT_WITHOUT_ADULT, PASSPORT_REQUIRED_INTERNATIONAL y DOCUMENT_EXPIRED nombran el campo y se llevan a los pasajeros que corresponden', () => {
    const baby = adult(1, { passengerType: 'INFANT', associatedAdultId: '' });
    expect(map('INFANT_WITHOUT_ADULT', [], [adult(0), baby]).errors).toEqual({ '1.associatedAdultId': 'Indica el adulto con el que viaja el infante.' });
    expect(map('PASSPORT_REQUIRED_INTERNATIONAL', [], [adult(0), adult(1, { documentType: 'PASSPORT' })]).errors).toEqual({ '0.documentType': 'Los vuelos internacionales requieren pasaporte.' });
    expect(map('DOCUMENT_EXPIRED', [], [adult(0), adult(1, { documentExpiryDate: '2026-01-01' })]).errors).toEqual({ '1.documentExpiryDate': 'El documento vence antes del último vuelo del viaje.' });
  });
  it('SRV-09 los mensajes salen de la web, no del servidor, y no repiten lo escrito ni el motivo del servidor', () => {
    const { errors } = mapServerErrors({ code: 'VALIDATION_FAILED', invalidParams: [{ name: 'passengers.0.firstName', reason: 'secreto-del-servidor' }] }, [adult(0, { firstName: 'Valor-Escrito-9' })]);
    expect(JSON.stringify(errors)).not.toContain('secreto-del-servidor'); expect(JSON.stringify(errors)).not.toContain('Valor-Escrito-9');
  });
  it('SRV-10 solo los códigos de la lista llevan el error a los campos', () => {
    expect([...FIELD_ERROR_CODES].sort()).toEqual(['BAGGAGE_LIMIT_EXCEEDED', 'DOCUMENT_EXPIRED', 'INFANT_WITHOUT_ADULT', 'PASSPORT_REQUIRED_INTERNATIONAL', 'VALIDATION_FAILED']);
  });
});
