import { describe, expect, it } from 'vitest';
import { passengerDraft } from '../../test/passenger-fixtures';
import { birthDateRange, documentRule, draftPhone, emptyPassenger, expiryRange, shiftYears, isInternational, lastTravelDate, maxExtraBaggage, validatePassengers, type PassengerDraft, type TripSegment } from './passenger-rules';

const NOW = new Date('2026-12-01T15:00:00Z');
const UIO_GPS: TripSegment[] = [{ departureAt: '2026-12-10T13:35:00Z', departureIata: 'UIO', arrivalIata: 'GPS' }];
const UIO_MAD: TripSegment[] = [{ departureAt: '2026-12-10T22:00:00Z', departureIata: 'UIO', arrivalIata: 'MAD' }];
const adult = (index = 0, patch: Partial<PassengerDraft> = {}): PassengerDraft => ({ ...passengerDraft(emptyPassenger(`PAX-${index + 1}`, 'ADULT'), index), ...patch });
const errorsOf = (passengers: PassengerDraft[], segments = UIO_GPS) => validatePassengers(passengers, { segments, now: NOW });

describe('maletas adicionales: máximo de la tarifa (total del servidor − incluidas)', () => {
  it('PAX-BAG-01 el máximo adicional sale de las maletas incluidas: 0 incluidas ⇒ 3; 1 ⇒ 2; 2 ⇒ 1; 3 o más ⇒ 0; sin dato ⇒ 3', () => {
    expect([0, 1, 2, 3, 5].map(maxExtraBaggage)).toEqual([3, 2, 1, 0, 0]); expect(maxExtraBaggage(undefined)).toBe(3); expect(maxExtraBaggage(null)).toBe(3);
  });
  it('PAX-BAG-02 con el máximo del tramo, una cantidad mayor se rechaza con un mensaje claro del campo; dentro del máximo pasa', () => {
    const withBags = (quantity: number) => validatePassengers([adult(0, { extraBaggage: { 'it-1': quantity } })], { segments: UIO_GPS, now: NOW, maxExtraBaggage: { 'it-1': 1 } });
    expect(withBags(1)).toEqual({});
    expect(withBags(3)['0.extraBaggage.it-1']).toBe('Con la tarifa elegida puedes agregar hasta 1 maleta adicional.');
    expect(validatePassengers([adult(0, { extraBaggage: { 'it-1': 1 } })], { segments: UIO_GPS, now: NOW, maxExtraBaggage: { 'it-1': 0 } })['0.extraBaggage.it-1']).toBe('Con la tarifa elegida no se pueden agregar maletas adicionales.');
  });
});

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
    const baby = (id: string, associatedAdultId: string): PassengerDraft => ({ ...adult(2, { passengerType: 'INFANT', birthDate: '2026-02-01', documentNumber: `100${id}000001`, associatedAdultId, passengerId: `PAX-${id}` }) });
    expect(errorsOf([adult(0), adult(1), baby('3', '')])['2.associatedAdultId']).toBe('Indica el adulto con el que viaja el infante.');
    expect(errorsOf([adult(0), adult(1), baby('3', 'PAX-9')])['2.associatedAdultId']).toBe('Indica el adulto con el que viaja el infante.');
    expect(errorsOf([adult(0), adult(1), baby('3', 'PAX-1')])).toEqual({});
    expect(errorsOf([adult(0), adult(1), baby('3', 'PAX-1'), baby('4', 'PAX-1')])['3.associatedAdultId']).toBe('Cada adulto puede viajar con un solo infante.');
  });

  it('PAX-05 la edad se mide como Reservation (a la fecha de hoy): infante < 2, niño 2–11, joven 12–17, adulto ≥ 18 (ADR-F12b1fix-05; PLAN Q-010 difiere, ver BACKLOG)', () => {
    const typed = (passengerType: PassengerDraft['passengerType'], birthDate: string, index: number): PassengerDraft => adult(index, { passengerType, birthDate, documentNumber: `20${index}0000001`, associatedAdultId: 'PAX-1' });
    expect(errorsOf([adult(0), typed('CHILD', '2020-06-01', 1)])).toEqual({});
    expect(errorsOf([adult(0), typed('CHILD', '2026-06-01', 1)])['1.birthDate']).toContain('no corresponde a un pasajero niño');
    expect(errorsOf([adult(0), typed('YOUTH', '2010-12-10', 1)])).toEqual({}); // 16 años: joven (con la regla del PLAN ya sería adulto)
    expect(errorsOf([adult(0), typed('YOUTH', '2008-12-02', 1)])).toEqual({}); // 17 años
    expect(errorsOf([adult(0), typed('YOUTH', '2008-12-01', 1)])['1.birthDate']).toContain('joven'); // 18 años
    expect(errorsOf([adult(0, { birthDate: '2008-12-02' })])['0.birthDate']).toContain('adulto'); // 17 años
    expect(errorsOf([adult(0, { birthDate: '2008-12-01' })])).toEqual({}); // 18 años
    expect(errorsOf([adult(0, { birthDate: '2012-01-01' })])['0.birthDate']).toContain('adulto');
    expect(errorsOf([adult(0), typed('INFANT', '2025-01-05', 1)])).toEqual({});
    // La fecha de los vuelos no cambia la edad: la mide la fecha de hoy.
    const twoLegs: TripSegment[] = [...UIO_GPS, { departureAt: '2027-01-20T13:00:00Z', departureIata: 'GPS', arrivalIata: 'UIO' }];
    expect(errorsOf([adult(0), typed('INFANT', '2025-01-05', 1)], twoLegs)).toEqual({});
  });

  it('PAX-06 nombres, documento, contacto, nacionalidad, género y duplicados', () => {
    const errors = errorsOf([adult(0, { firstName: '', lastName: '1234', documentNumber: '12', email: 'sin-arroba', phoneNational: '', gender: '', nationality: '' }), adult(1, { documentNumber: '1712345678' })]);
    expect(errors['0.firstName']).toBeDefined(); expect(errors['0.lastName']).toBeDefined(); expect(errors['0.documentNumber']).toContain('5 y 20');
    expect(errors['0.email']).toBeDefined(); expect(errors['0.phone']).toBeDefined(); expect(errors['0.gender']).toBeDefined(); expect(errors['0.nationality']).toBeDefined();
    expect(errorsOf([adult(0), adult(1, { documentNumber: '1712345678' })])['1.documentNumber']).toBe('Este documento ya se usó para otro pasajero.');
    expect(errorsOf([adult(0, { firstName: 'María José', lastName: "O'Brien-Andrade" })])).toEqual({});
  });

  it('PAX-09 se valida lo NORMALIZADO (lo que viaja): documento sin espacios ni guiones y en mayúsculas, teléfono sin separadores, nombres sin espacios de más', () => {
    expect(errorsOf([adult(0, { documentNumber: ' 1712-345 678 ', firstName: '  Ana    María ', lastName: ' Pérez  Vera ' })])).toEqual({});
    // El mismo documento escrito distinto es el mismo documento.
    expect(errorsOf([adult(0, { documentNumber: '1712345678' }), adult(1, { documentNumber: '1712-345 678' })])['1.documentNumber']).toBe('Este documento ya se usó para otro pasajero.');
    // Los caracteres que no son separadores se rechazan, no se borran en silencio.
    expect(errorsOf([adult(0, { documentNumber: '1712.345.678' })])['0.documentNumber']).toBe('La cédula ecuatoriana lleva exactamente 10 números.');
    expect(errorsOf([adult(0, { documentType: 'PASSPORT', documentNumber: 'AB.12345', documentExpiryDate: '2030-05-31' })])['0.documentNumber']).toContain('5 y 20');
  });

  it('PAX-12 teléfono: la librería valida el número para el país elegido y compone el E.164 (con y sin el 0 troncal); inválido o vacío, no hay E.164 y se avisa', () => {
    expect(draftPhone({ phoneCountry: 'EC', phoneNational: '987654321' })).toBe('+593987654321');
    expect(draftPhone({ phoneCountry: 'EC', phoneNational: '0987654321' })).toBe('+593987654321'); // el 0 de los celulares de Ecuador no va
    expect(draftPhone({ phoneCountry: 'US', phoneNational: '2025550123' })).toBe('+12025550123');
    expect(draftPhone({ phoneCountry: 'IT', phoneNational: '0212345678' })).toBe('+390212345678'); // en Italia el 0 forma parte del número
    expect(draftPhone({ phoneCountry: 'EC', phoneNational: '1234' })).toBe(''); // no es válido para Ecuador: no se compone
    expect(errorsOf([adult(0, { phoneNational: '0987654321' })])).toEqual({});
    expect(errorsOf([adult(0, { phoneCountry: 'CO', phoneNational: '3001234567' })])).toEqual({});
    expect(errorsOf([adult(0, { phoneNational: '' })])['0.phone']).toContain('solo con dígitos');
    expect(errorsOf([adult(0, { phoneNational: '1234' })])['0.phone']).toBe('El número no es válido para Ecuador. Revisa que esté completo y sin el código de país.');
    expect(errorsOf([adult(0, { phoneCountry: 'ES', phoneNational: '12345' })])['0.phone']).toContain('no es válido para España');
    expect(errorsOf([adult(0, { phoneNational: '9'.repeat(16) })])['0.phone']).toContain('no es válido');
    expect(errorsOf([adult(0, { phoneNational: '0' })])['0.phone']).toContain('no es válido'); // solo el 0 troncal: sin número
    expect(JSON.stringify(errorsOf([adult(0, { phoneNational: '1234' })]))).not.toContain('1234');
  });

  it('PAX-13 cédula con nacionalidad Ecuador: exactamente 10 números; con otra nacionalidad, de 5 a 20 letras o números (la regla de Reservation); el pasaporte, letras y números', () => {
    const ecMessage = 'La cédula ecuatoriana lleva exactamente 10 números.';
    for (const documentNumber of ['AB123456', '171234567', '17123456789', '']) expect(errorsOf([adult(0, { documentType: 'NATIONAL_ID', nationality: 'EC', documentNumber })])['0.documentNumber']).toBe(ecMessage);
    expect(errorsOf([adult(0, { documentType: 'NATIONAL_ID', nationality: 'EC', documentNumber: '1712345678' })])).toEqual({});
    // Otra nacionalidad: la cédula (p. ej. el DNI español) admite letras y no tiene que medir 10.
    expect(errorsOf([adult(0, { documentType: 'NATIONAL_ID', nationality: 'ES', documentNumber: '12345678Z' })])).toEqual({});
    expect(errorsOf([adult(0, { documentType: 'NATIONAL_ID', nationality: 'CO', documentNumber: '12345' })])).toEqual({});
    expect(errorsOf([adult(0, { documentType: 'NATIONAL_ID', nationality: 'ES', documentNumber: '1234' })])['0.documentNumber']).toContain('5 y 20');
    expect(errorsOf([adult(0, { documentType: 'PASSPORT', documentNumber: 'AB123456', documentExpiryDate: '2030-05-31' })])).toEqual({});
  });

  it('PAX-15 la regla del documento sale del tipo y la nacionalidad (`documentRule`)', () => {
    expect(documentRule('NATIONAL_ID', 'EC')).toMatchObject({ kind: 'ECUADOR_ID', min: 10, max: 10 });
    for (const [type, nationality] of [['NATIONAL_ID', 'CO'], ['NATIONAL_ID', ''], ['PASSPORT', 'EC'], ['PASSPORT', 'ES']] as const) expect(documentRule(type, nationality)).toMatchObject({ kind: 'ALPHANUMERIC', min: 5, max: 20 });
  });

  it('PAX-14 rangos de fecha del formulario: nacimiento de hoy − 125 años a hoy; vencimiento de hoy (o del último vuelo) a hoy + 15 años; el 29 de febrero cae en el 28', () => {
    expect(birthDateRange(NOW)).toEqual({ min: '1901-12-01', max: '2026-12-01' });
    expect(expiryRange(NOW)).toEqual({ min: '2026-12-01', max: '2041-12-01' });
    expect(expiryRange(NOW, '2026-12-10').min).toBe('2026-12-10'); expect(expiryRange(NOW, '2026-11-01').min).toBe('2026-12-01');
    expect(shiftYears('2024-02-29', 1)).toBe('2025-02-28'); expect(shiftYears('2024-02-29', 4)).toBe('2028-02-29');
    expect(errorsOf([adult(0, { birthDate: '1901-11-30' })])['0.birthDate']).toContain('debe estar entre el 01/12/1901 y hoy'); expect(errorsOf([adult(0, { birthDate: '1901-12-01' })])).toEqual({});
    const passport = { documentType: 'PASSPORT' as const, documentNumber: 'AB123456' };
    expect(errorsOf([adult(0, { ...passport, documentExpiryDate: '2041-12-02' })])['0.documentExpiryDate']).toContain('posterior al 01/12/2041'); expect(errorsOf([adult(0, { ...passport, documentExpiryDate: '2041-12-01' })])).toEqual({});
  });

  it('PAX-10 nombres: tildes y ñ válidos; dígitos, símbolos, emojis, solo espacios y más de 50 caracteres no; los mensajes no repiten lo escrito', () => {
    for (const name of ['José María', "O'Brien", 'Ana-Lucía', 'Núñez', 'St. John']) expect(errorsOf([adult(0, { firstName: name, lastName: name })])).toEqual({});
    for (const name of ['Ana2', 'Ana@', 'Ana 😀', '    ', 'a'.repeat(51)]) { const errors = errorsOf([adult(0, { firstName: name })]); expect(errors['0.firstName']).toBeDefined(); expect(errors['0.firstName']).not.toContain(name.trim() || 'sin-valor'); }
  });

  it('PAX-11 fechas: la de nacimiento futura se rechaza con su mensaje; sin fecha, pide la fecha', () => {
    expect(errorsOf([adult(0, { birthDate: '2027-01-01' })])['0.birthDate']).toBe('La fecha de nacimiento no puede ser futura.');
    expect(errorsOf([adult(0, { birthDate: '' })])['0.birthDate']).toBe('Escribe la fecha de nacimiento.');
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
