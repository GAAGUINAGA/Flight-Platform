import { z } from 'zod';
import {
  ageAt, checkPassengerFields, checkPassengerSet, DOCUMENT_PATTERN, EMAIL_PATTERN, fieldMessage, isCalendarDate, isValidName, normalizeDocument, normalizeName, normalizePhone, PHONE_PATTERN,
  type PassengerFacts, type PassengerType
} from '../src/passenger-rules';

const AT = new Date('2026-12-01T15:00:00Z');
const valid = (patch: Partial<PassengerFacts> = {}): PassengerFacts => ({
  passengerId: 'p1', passengerType: 'ADULT', firstName: 'Ana María', lastName: 'Pérez Vera', documentNumber: '1712345678', nationality: 'EC', birthDate: '1990-03-14', gender: 'F', email: 'ana@example.com', phone: '+593987654321', ...patch
});
const fields = (patch: Partial<PassengerFacts>): string[] => checkPassengerFields(valid(patch), 0, AT).map((issue) => issue.field);

describe('PAX-RULES nombres y apellidos (ADR-F12b1fix-05)', () => {
  it.each(['José María', "O'Brien", 'Ana-Lucía', 'Núñez', 'St. John', 'Ñandú', 'Müller', 'D’Angelo', 'Zoë', 'a', 'Li'])('acepta %s', (name) => { expect(isValidName(name)).toBe(true); });
  it('acepta marcas combinadas (i + tilde descompuesta) y un nombre de exactamente 50 caracteres', () => {
    expect(isValidName('María')).toBe(true);
    expect(isValidName('a'.repeat(50))).toBe(true);
  });
  it.each([['con dígitos', 'Ana2'], ['solo dígitos', '1234'], ['con emoji', 'Ana 😀'], ['solo emoji', '😀'], ['con símbolo @', 'Ana@'], ['con símbolo _', 'Ana_Luz'], ['con coma', 'Pérez, Ana'], ['vacío', ''], ['solo espacios', '    '], ['empieza con guion', '-Ana'], ['empieza con punto', '.Ana'], ['espacio doble', 'Ana  María'], ['con tabulador', 'Ana\tMaría'], ['con barra', 'Ana/Luz'], ['de 51 caracteres', 'a'.repeat(51)]])('rechaza un nombre %s', (_label, name) => {
    expect(isValidName(name)).toBe(false);
  });
  it('recorta antes de medir: 50 letras con espacios alrededor valen; el nombre se normaliza colapsando espacios', () => {
    expect(isValidName(`  ${'a'.repeat(50)}  `)).toBe(true);
    expect(normalizeName('  Ana    María \t Pérez ')).toBe('Ana María Pérez');
    expect(isValidName(normalizeName('Ana     María'))).toBe(true);
  });
  it('los mensajes de nombre no incluyen el valor escrito', () => {
    const [issue] = checkPassengerFields(valid({ firstName: 'Secreto123' }), 0, AT);
    expect(issue).toMatchObject({ field: 'firstName', code: 'NAME_INVALID' }); expect(issue.message).not.toContain('Secreto');
  });
});

describe('PAX-RULES documento, teléfono, correo, nacionalidad, género', () => {
  it('documento: alfanumérico de 5 a 20; con guion, espacios, letras acentuadas o largo fuera de rango se rechaza', () => {
    for (const ok of ['12345', 'AB123456', 'a1b2c3d4e5f6g7h8i9j0']) expect(DOCUMENT_PATTERN.test(ok)).toBe(true);
    for (const bad of ['1234', '1712-345678', '1712 345678', 'AB12345Ñ', 'a'.repeat(21), '']) expect(DOCUMENT_PATTERN.test(bad)).toBe(false);
    expect(fields({ documentNumber: '12' })).toEqual(['documentNumber']);
  });
  it('documento: normalizar quita espacios y guiones y pasa a mayúsculas; lo demás se deja para que falle', () => {
    expect(normalizeDocument(' 1712-345 678 ')).toBe('1712345678'); expect(normalizeDocument('ab-123 456')).toBe('AB123456');
    expect(DOCUMENT_PATTERN.test(normalizeDocument('171.234.5678'))).toBe(false);
  });
  it('teléfono: E.164 estricto; normalizar quita espacios, guiones, puntos y paréntesis pero no inventa el código de país', () => {
    expect(PHONE_PATTERN.test('+593987654321')).toBe(true); expect(PHONE_PATTERN.test('593987654321')).toBe(false); expect(PHONE_PATTERN.test('+0123456')).toBe(false);
    expect(PHONE_PATTERN.test('+593 98 765 4321')).toBe(false);
    expect(normalizePhone(' +593 (98) 765-4321 ')).toBe('+593987654321'); expect(normalizePhone('0987654321')).toBe('0987654321');
    expect(normalizePhone('+593abc')).toBe('+593abc'); expect(PHONE_PATTERN.test(normalizePhone('+593abc'))).toBe(false);
    expect(fields({ phone: '0987654321' })).toEqual(['contact.phone']);
  });
  it('correo: el mismo patrón que `z.string().email()` de Zod (la regla que Reservation aplicaba antes)', () => {
    const corpus = ['ana@example.com', 'a.b+c@sub.example.org', 'sin-arroba', 'a@b', 'a@b.c', 'a@b.co', '.a@b.co', 'a..b@b.co', 'a b@b.co', "o'brien@example.test", 'ana@example.invalid', 'ana@-example.com', 'ana@exa_mple.com', '', 'ana@@example.com', 'ñ@example.com', 'ana@example.com ', 'a@b.123'];
    for (const value of corpus) expect({ value, ok: EMAIL_PATTERN.test(value) }).toEqual({ value, ok: z.string().email().safeParse(value).success });
  });
  it('nacionalidad de 2 o 3 letras; género M, F o X', () => {
    expect(fields({ nationality: 'E' })).toEqual(['nationality']); expect(fields({ nationality: '' })).toEqual(['nationality']); expect(fields({ nationality: 'ECU' })).toEqual([]);
    expect(fields({ nationality: 'ECUA' })).toEqual(['nationality']);
    expect(fields({ gender: '' })).toEqual(['gender']); expect(fields({ gender: 'Z' })).toEqual(['gender']); for (const g of ['M', 'F', 'X']) expect(fields({ gender: g })).toEqual([]);
  });
  it('un pasajero completo y válido no tiene incumplimientos; uno vacío los tiene todos', () => {
    expect(checkPassengerFields(valid(), 0, AT)).toEqual([]);
    expect(fields({ firstName: '', lastName: '', documentNumber: '', nationality: '', birthDate: '', gender: '', email: '', phone: '' })).toEqual(['firstName', 'lastName', 'documentNumber', 'nationality', 'birthDate', 'gender', 'contact.email', 'contact.phone']);
  });
  it('fieldMessage: un mensaje por campo del contrato y uno genérico para los demás', () => {
    for (const field of ['firstName', 'lastName', 'documentNumber', 'nationality', 'documentExpiryDate', 'birthDate', 'gender', 'contact.email', 'contact.phone']) expect(fieldMessage(field)).not.toBe('Revisa este dato.');
    expect(fieldMessage('otro')).toBe('Revisa este dato.');
  });
});

describe('PAX-RULES fechas y edad por tipo (regla de Reservation: INFANT <2, CHILD 2–11, YOUTH 12–17, ADULT ≥18, a la fecha de hoy)', () => {
  it('fechas de calendario: existe el día, incluido el 29 de febrero solo en bisiesto', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true); expect(isCalendarDate('2026-02-29')).toBe(false); expect(isCalendarDate('2026-13-01')).toBe(false); expect(isCalendarDate('2026-1-1')).toBe(false); expect(isCalendarDate('')).toBe(false);
  });
  it('años cumplidos: el día antes del cumpleaños aún no cumple; el día del cumpleaños sí; fecha futura ⇒ negativo', () => {
    expect(ageAt('2008-12-02', AT)).toBe(17); expect(ageAt('2008-12-01', AT)).toBe(18); expect(ageAt('2026-12-02', AT)).toBeLessThan(0); expect(ageAt('2027-01-01', AT)).toBeLessThan(0);
  });
  const typed = (passengerType: PassengerType, birthDate: string): string[] => fields({ passengerType, birthDate });
  it.each([
    ['ADULT', '2008-12-01', true], ['ADULT', '2008-12-02', false], ['ADULT', '1900-01-01', true],
    ['YOUTH', '2008-12-02', true], ['YOUTH', '2014-12-01', true], ['YOUTH', '2014-12-02', false], ['YOUTH', '2008-12-01', false],
    ['CHILD', '2014-12-02', true], ['CHILD', '2024-12-01', true], ['CHILD', '2024-12-02', false], ['CHILD', '2014-12-01', false],
    ['INFANT', '2024-12-02', true], ['INFANT', '2026-12-01', true], ['INFANT', '2024-12-01', false]
  ] as const)('%s nacido el %s ⇒ edad válida: %s', (type, birthDate, ok) => { expect(typed(type, birthDate)).toEqual(ok ? [] : ['birthDate']); });
  it('fecha futura: código y mensaje propios; fecha inexistente o vacía; el mensaje de edad nombra la regla y no la fecha', () => {
    expect(checkPassengerFields(valid({ birthDate: '2027-01-01' }), 0, AT)[0]).toMatchObject({ field: 'birthDate', code: 'BIRTHDATE_FUTURE', message: 'La fecha de nacimiento no puede ser futura.' });
    expect(checkPassengerFields(valid({ birthDate: '2026-02-30' }), 0, AT)[0]).toMatchObject({ code: 'DATE_INVALID' });
    expect(checkPassengerFields(valid({ birthDate: '' }), 0, AT)[0]).toMatchObject({ code: 'DATE_INVALID', message: 'Escribe la fecha de nacimiento.' });
    const [age] = checkPassengerFields(valid({ passengerType: 'YOUTH', birthDate: '1990-03-14' }), 0, AT);
    expect(age).toMatchObject({ code: 'AGE_MISMATCH' }); expect(age.message).toContain('joven'); expect(age.message).toContain('12 a 17'); expect(age.message).not.toContain('1990');
  });
  it('vencimiento del documento: si se escribe, debe ser una fecha real', () => {
    expect(fields({ documentExpiryDate: '2030-05-31' })).toEqual([]); expect(fields({ documentExpiryDate: '2030-02-31' })).toEqual(['documentExpiryDate']); expect(fields({ documentExpiryDate: undefined })).toEqual([]);
  });
});

describe('PAX-RULES conjunto de pasajeros (movida desde Reservation: mismo orden y mismos casos)', () => {
  const adult = (id = 'adult'): PassengerFacts => valid({ passengerId: id });
  const infant = (id: string, associatedAdultId?: string, extra: Partial<PassengerFacts> = {}): PassengerFacts => valid({ passengerId: id, passengerType: 'INFANT', birthDate: '2026-01-01', associatedAdultId, ...extra });
  const one = { adults: 1, youths: 0, children: 0, infants: 0 };
  const codes = (passengers: PassengerFacts[], expected = one): string[] => checkPassengerSet(passengers, expected, AT).map((issue) => issue.code);

  it('un adulto que coincide con el desglose no tiene incumplimientos', () => { expect(codes([adult()])).toEqual([]); });
  it('conteo distinto del desglose del hold', () => { expect(codes([adult()], { ...one, adults: 2 })).toEqual(['COUNT_MISMATCH']); });
  it('identificador de pasajero repetido: es el primer incumplimiento', () => { expect(codes([adult(), adult()], { ...one, adults: 2 })[0]).toBe('PASSENGER_ID_DUPLICATED'); });
  it('infante sin adulto, con un adulto que no existe, o con un adulto que ya lleva otro infante', () => {
    const two = { adults: 1, youths: 0, children: 0, infants: 2 };
    expect(codes([infant('i1')], { adults: 0, youths: 0, children: 0, infants: 1 })[0]).toBe('INFANT_ADULT_REQUIRED');
    expect(codes([adult(), infant('i1', 'otro')], { ...one, infants: 1 })).toEqual(['INFANT_ADULT_REQUIRED']);
    expect(codes([adult(), infant('i1', 'adult'), infant('i2', 'adult')], two)).toEqual(['INFANT_ADULT_TAKEN', 'COUNT_MISMATCH']);
  });
  it('infante con asiento: INFANT_SEAT_NOT_ALLOWED', () => { expect(codes([adult(), infant('i1', 'adult', { assignedSeats: [{}] })], { ...one, infants: 1 })).toEqual(['INFANT_SEAT_NOT_ALLOWED']); });
  it('edad incoherente con el tipo (con la misma regla de los campos)', () => { expect(codes([valid({ birthDate: '2025-01-01' })])).toEqual(['AGE_MISMATCH']); });
  it('más infantes que adultos nunca coincide', () => { expect(codes([adult(), infant('i1', 'adult'), infant('i2', 'otro')], { adults: 1, youths: 0, children: 0, infants: 2 }).at(-1)).toBe('COUNT_MISMATCH'); });
});
