import { describe, expect, it } from 'vitest';
import { COUNTRIES } from '@flight-platform/format';
import { flagUrl } from '../data/flags';
import { adjustDocument, displayToIso, filterDateText, filterDocument, filterName, filterPhoneNational, isoToDisplay, maskDate, NAME_HELP } from './input-filters';

describe('filtrado de lo que se escribe y se pega (ADR-F12b1fix-05, punto 8)', () => {
  it('FLT-01 nombres: pasan letras con tildes y ñ, marcas combinadas, espacios, apóstrofo, guion y punto; lo demás se bloquea con ayuda', () => {
    for (const ok of ['José María', "O'Brien", 'Ana-Lucía', 'Núñez', 'St. John', 'María', 'D’Angelo']) expect(filterName(ok)).toEqual({ value: ok, blocked: null });
    for (const [raw, value] of [['Ana2', 'Ana'], ['Ana@#', 'Ana'], ['Ana 😀', 'Ana '], ['<b>Ana</b>', 'bAnab'], ['Pérez, Ana', 'Pérez Ana']] as const) {
      expect(filterName(raw)).toEqual({ value, blocked: NAME_HELP });
    }
    expect(filterName('')).toEqual({ value: '', blocked: null });
  });
  it('FLT-02 nombres: tope de 50 caracteres con aviso (no se corta en silencio)', () => {
    expect(filterName('a'.repeat(50)).blocked).toBeNull();
    expect(filterName('a'.repeat(51))).toEqual({ value: 'a'.repeat(50), blocked: 'Máximo 50 caracteres.' });
  });
  it('FLT-03 teléfono nacional: solo dígitos; con separadores se quitan y se avisa; tope según el país', () => {
    expect(filterPhoneNational('EC')('0987654321')).toEqual({ value: '0987654321', blocked: null });
    expect(filterPhoneNational('EC')('(098) 765-4321')).toEqual({ value: '0987654321', blocked: 'Solo números.' });
    expect(filterPhoneNational('EC')('abc')).toEqual({ value: '', blocked: 'Solo números.' });
    // El tope sale del largo que `libphonenumber-js` da por posible en cada país (no de 15 − código): Ecuador 11, o 12 si lo escrito empieza con el 0 troncal; EE. UU. 10; España 9.
    expect(filterPhoneNational('EC')('1'.repeat(14))).toEqual({ value: '1'.repeat(11), blocked: 'Máximo 11 caracteres.' });
    expect(filterPhoneNational('EC')('0' + '1'.repeat(13))).toEqual({ value: '0' + '1'.repeat(11), blocked: 'Máximo 12 caracteres.' });
    expect(filterPhoneNational('US')('1'.repeat(15)).value).toHaveLength(10); expect(filterPhoneNational('ES')('6'.repeat(12))).toEqual({ value: '6'.repeat(9), blocked: 'Máximo 9 caracteres.' });
  });
  it('FLT-04 documento según tipo y nacionalidad: cédula de Ecuador, solo dígitos y 10; en los demás casos, letras (sin tildes ni ñ) y números en mayúsculas, tope 20', () => {
    expect(filterDocument('NATIONAL_ID', 'EC')('1712-345 678')).toEqual({ value: '1712345678', blocked: 'Solo números.' });
    expect(filterDocument('NATIONAL_ID', 'EC')('AB12')).toEqual({ value: '12', blocked: 'Solo números.' });
    expect(filterDocument('NATIONAL_ID', 'EC')('17123456789')).toEqual({ value: '1712345678', blocked: 'Máximo 10 caracteres.' });
    expect(filterDocument('NATIONAL_ID', 'EC')('')).toEqual({ value: '', blocked: null });
    // Otra nacionalidad: la cédula no bloquea letras (p. ej. el DNI español).
    expect(filterDocument('NATIONAL_ID', 'ES')('12345678z')).toEqual({ value: '12345678Z', blocked: null });
    expect(filterDocument('NATIONAL_ID', 'CO')('12.345-ñ')).toEqual({ value: '12345', blocked: 'Solo letras (sin tildes) y números.' });
    expect(filterDocument('PASSPORT', 'EC')('ab123456')).toEqual({ value: 'AB123456', blocked: null }); // pasar a mayúsculas no es descartar
    expect(filterDocument('PASSPORT', 'EC')('ab-12ñ')).toEqual({ value: 'AB12', blocked: 'Solo letras (sin tildes) y números.' });
    expect(filterDocument('PASSPORT', 'EC')('A'.repeat(21))).toEqual({ value: 'A'.repeat(20), blocked: 'Máximo 20 caracteres.' });
  });
  it('FLT-04b al cambiar el tipo o la nacionalidad lo escrito se ajusta a la regla nueva y se avisa (nunca en silencio)', () => {
    expect(adjustDocument('NATIONAL_ID', 'EC', 'AB123456')).toEqual({ value: '123456', notice: 'Ajustamos el número de documento a la regla elegida. Solo números.' });
    expect(adjustDocument('NATIONAL_ID', 'EC', 'A'.repeat(0) + '12345678901')).toEqual({ value: '1234567890', notice: 'Ajustamos el número de documento a la regla elegida. Máximo 10 caracteres.' });
    expect(adjustDocument('NATIONAL_ID', 'EC', '1712345678')).toEqual({ value: '1712345678', notice: null }); // ya cumple: no avisa
    expect(adjustDocument('PASSPORT', 'EC', '1712345678')).toEqual({ value: '1712345678', notice: null }); // de cédula a pasaporte no se pierde nada
    expect(adjustDocument('NATIONAL_ID', 'ES', 'AB123456')).toEqual({ value: 'AB123456', notice: null });
  });
  it('FLT-05 fecha escrita: dígitos y separadores; la máscara arma dd/mm/aaaa y permite borrar hacia atrás', () => {
    expect(filterDateText('14/03/1990')).toEqual({ value: '14/03/1990', blocked: null }); expect(filterDateText('14a03')).toEqual({ value: '1403', blocked: 'Solo números.' });
    expect(maskDate('1')).toBe('1'); expect(maskDate('14')).toBe('14'); expect(maskDate('140')).toBe('14/0'); expect(maskDate('1403')).toBe('14/03'); expect(maskDate('14031')).toBe('14/03/1'); expect(maskDate('14031990')).toBe('14/03/1990'); expect(maskDate('140319901234')).toBe('14/03/1990');
    expect(maskDate('14/')).toBe('14'); expect(maskDate('14-03-1990')).toBe('14/03/1990');
  });
  it('FLT-06 fecha: ISO ⇄ dd/mm/aaaa; solo fechas de calendario que existen', () => {
    expect(isoToDisplay('1990-03-14')).toBe('14/03/1990'); expect(isoToDisplay('')).toBe(''); expect(isoToDisplay('14/03/1990')).toBe('');
    expect(displayToIso('14/03/1990')).toBe('1990-03-14'); expect(displayToIso('29/02/2024')).toBe('2024-02-29');
    for (const bad of ['29/02/2023', '31/04/2000', '00/01/2000', '14/13/2000', '1/1/2000', '14/03/90', '']) expect(displayToIso(bad)).toBeNull();
  });
});

describe('banderas como imagen (flag-icons, servidas por el propio sitio)', () => {
  it('FLG-01 cada país de la lista compartida tiene su bandera SVG', () => {
    const missing = COUNTRIES.filter((country) => !flagUrl(country.code)).map((country) => country.code);
    expect(missing).toEqual([]);
    expect(flagUrl('ec')).toMatch(/ec\.svg/); expect(flagUrl('EC')).toBe(flagUrl('ec')); expect(flagUrl('ZZ')).toBeUndefined();
  });
});
