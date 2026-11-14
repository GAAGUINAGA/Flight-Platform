import { describe, expect, it } from 'vitest';
import { passengerDraft } from '../../test/passenger-fixtures';
import { ageOn, emptyPassenger, isInternational, lastTravelDate, validatePassengers, type PassengerDraft, type TripSegment } from './passenger-rules';

const NOW = new Date('2026-12-01T15:00:00Z');
const UIO_GPS: TripSegment[] = [{ departureAt: '2026-12-10T13:35:00Z', departureIata: 'UIO', arrivalIata: 'GPS' }];
const UIO_MAD: TripSegment[] = [{ departureAt: '2026-12-10T22:00:00Z', departureIata: 'UIO', arrivalIata: 'MAD' }];
const adult = (index = 0, patch: Partial<PassengerDraft> = {}): PassengerDraft => ({ ...passengerDraft(emptyPassenger(`PAX-${index + 1}`, 'ADULT'), index), ...patch });
const errorsOf = (passengers: PassengerDraft[], segments = UIO_GPS) => validatePassengers(passengers, { segments, now: NOW });

describe('validación de pasajeros antes de llamar al servidor (§3.6, ADR-F12-05, PLAN Q-010)', () => {
  it('PAX-01 un adulto con datos completos en un vuelo nacional no tiene errores', () => {
    expect(errorsOf([adult()])).toEqual({});
  });

  it('PAX-02 vuelo internacional ⇒ pasaporte obligatorio; con pasaporte vigente pasa', () => {
    expect(isInternational(UIO_MAD)).toBe(true); expect(isInternational(UIO_GPS)).toBe(false);
    expect(errorsOf([adult()], UIO_MAD)['0.documentType']).toBe('Los vuelos internacionales requieren pasaporte.');
    expect(errorsOf([adult(0, { documentType: 'PASSPORT', documentNumber: 'AB123456', documentExpiryDate: '2030-05-31' })], UIO_MAD)).toEqual({});
  });

  it('PAX-03 el pasaporte exige vencimiento; un documento que vence antes del último vuelo o ya vencido se rechaza (sin mostrar el valor)', () => {
    const passport = { documentType: 'PASSPORT' as const, documentNumber: 'AB123456' };
    expect(errorsOf([adult(0, passport)])['0.documentExpiryDate']).toBe('Indica el vencimiento del pasaporte.');
    const twoLegs: TripSegment[] = [...UIO_GPS, { departureAt: '2026-12-20T13:00:00Z', departureIata: 'GPS', arrivalIata: 'UIO' }];
    expect(errorsOf([adult(0, { ...passport, documentExpiryDate: '2026-12-15' })], twoLegs)['0.documentExpiryDate']).toBe('El documento vence antes del último vuelo del viaje.');
    expect(errorsOf([adult(0, { ...passport, documentExpiryDate: '2026-12-20' })], twoLegs)['0.documentExpiryDate']).toBeUndefined(); // vence el mismo día del último vuelo: vigente
    expect(errorsOf([adult(0, { documentType: 'NATIONAL_ID', documentExpiryDate: '2026-11-01' })])['0.documentExpiryDate']).toBe('El documento vence antes del último vuelo del viaje.');
    expect(JSON.stringify(errorsOf([adult(0, { ...passport, documentExpiryDate: '2026-12-15' })], twoLegs))).not.toContain('AB123456');
  });

  it('PAX-04 todo infante necesita un adulto de la reserva y cada adulto, un solo infante', () => {
    const baby = (id: string, associatedAdultId: string): PassengerDraft => ({ ...adult(2, { passengerType: 'INFANT', birthDate: '2026-02-01', documentNumber: `INF${id}0001`, associatedAdultId, passengerId: `PAX-${id}` }) });
    expect(errorsOf([adult(0), adult(1), baby('3', '')])['2.associatedAdultId']).toBe('Indica el adulto con el que viaja el infante.');
    expect(errorsOf([adult(0), adult(1), baby('3', 'PAX-9')])['2.associatedAdultId']).toBe('Indica el adulto con el que viaja el infante.');
    expect(errorsOf([adult(0), adult(1), baby('3', 'PAX-1')])).toEqual({});
    expect(errorsOf([adult(0), adult(1), baby('3', 'PAX-1'), baby('4', 'PAX-1')])['3.associatedAdultId']).toBe('Cada adulto puede viajar con un solo infante.');
  });

  it('PAX-05 la edad se mide en la fecha del último tramo: infante < 2, niño 2–11, joven 12–15, adulto ≥ 16', () => {
    expect(ageOn('2024-12-11', '2026-12-10')).toBe(1); expect(ageOn('2024-12-10', '2026-12-10')).toBe(2);
    const typed = (passengerType: PassengerDraft['passengerType'], birthDate: string, index: number): PassengerDraft => adult(index, { passengerType, birthDate, documentNumber: `DOC${index}00001`, associatedAdultId: 'PAX-1' });
    expect(errorsOf([adult(0), typed('CHILD', '2020-06-01', 1)])).toEqual({});
    expect(errorsOf([adult(0), typed('CHILD', '2026-06-01', 1)])['1.birthDate']).toContain('no corresponde a un pasajero niño');
    expect(errorsOf([adult(0), typed('YOUTH', '2011-12-10', 1)])).toEqual({}); // 15 años
    expect(errorsOf([adult(0), typed('YOUTH', '2010-12-10', 1)])['1.birthDate']).toContain('joven'); // 16 años
    expect(errorsOf([adult(0, { birthDate: '2012-01-01' })])['0.birthDate']).toContain('adulto');
    // Un infante que cumple 2 años antes del último vuelo debe viajar como niño (EC-28).
    const twoLegs: TripSegment[] = [...UIO_GPS, { departureAt: '2027-01-20T13:00:00Z', departureIata: 'GPS', arrivalIata: 'UIO' }];
    expect(errorsOf([adult(0), typed('INFANT', '2025-01-05', 1)], twoLegs)['1.birthDate']).toBe('El infante cumple 2 años antes del último vuelo: debe viajar como niño con su propio asiento.');
  });

  it('PAX-06 nombres, documento, contacto, nacionalidad, género y duplicados', () => {
    const errors = errorsOf([adult(0, { firstName: '', lastName: '1234', documentNumber: '12', email: 'sin-arroba', phone: 'abc', gender: '', nationality: '' }), adult(1, { documentNumber: '1712345678' })]);
    expect(errors['0.firstName']).toBeDefined(); expect(errors['0.lastName']).toBeDefined(); expect(errors['0.documentNumber']).toContain('5 y 20');
    expect(errors['0.email']).toBeDefined(); expect(errors['0.phone']).toBeDefined(); expect(errors['0.gender']).toBeDefined(); expect(errors['0.nationality']).toBeDefined();
    expect(errorsOf([adult(0), adult(1, { documentNumber: '1712345678' })])['1.documentNumber']).toBe('Este documento ya se usó para otro pasajero.');
    expect(errorsOf([adult(0, { firstName: 'María José', lastName: "O'Brien-Andrade" })])).toEqual({});
  });

  it('PAX-07 equipaje adicional: de 0 a 3 por tramo y nunca para un infante', () => {
    expect(errorsOf([adult(0, { extraBaggage: { 'it-1': 3 } })])).toEqual({});
    expect(errorsOf([adult(0, { extraBaggage: { 'it-1': 4 } })])['0.extraBaggage.it-1']).toContain('entre 0 y 3');
    expect(errorsOf([adult(0, { extraBaggage: { 'it-1': -1 } })])['0.extraBaggage.it-1']).toContain('entre 0 y 3');
    const baby = adult(1, { passengerType: 'INFANT', birthDate: '2026-02-01', associatedAdultId: 'PAX-1', extraBaggage: { 'it-1': 1 } });
    expect(errorsOf([adult(0), baby])['1.extraBaggage.it-1']).toBe('Los infantes no llevan equipaje facturado propio.');
  });

  it('PAX-08 la fecha del último tramo es la LOCAL del aeropuerto de salida (cruce de medianoche)', () => {
    // 02:00Z del 11-dic es el 10-dic 21:00 en Quito.
    expect(lastTravelDate([{ departureAt: '2026-12-11T02:00:00Z', departureIata: 'UIO', arrivalIata: 'GYE' }])).toBe('2026-12-10');
    expect(lastTravelDate([])).toBeNull();
  });
});
