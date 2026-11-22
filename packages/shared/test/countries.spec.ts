import { COUNTRIES, countryByCode, DEFAULT_COUNTRY, E164_MAX_DIGITS, searchCountries, searchKey } from '../src/countries';
import { NAME_CHAR_PATTERN, NAME_PATTERN, PHONE_PATTERN } from '../src/passenger-rules';

describe('COUNTRIES lista única de países (nacionalidad y prefijo del teléfono)', () => {
  it('CTR-01 códigos ISO-2 únicos y en mayúsculas, códigos de marcación de dígitos (1 a 4) y ordenada por nombre', () => {
    const codes = COUNTRIES.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length); expect(codes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
    expect(COUNTRIES.every((country) => /^[1-9]\d{0,3}$/.test(country.dial) && country.name.length > 1)).toBe(true);
    const names = COUNTRIES.map((country) => country.name); expect([...names].sort((a, b) => a.localeCompare(b, 'es'))).toEqual(names);
    expect(COUNTRIES.length).toBeGreaterThan(190);
  });
  it('CTR-02 Ecuador es el país por omisión, con +593; los países de la lista antigua de nacionalidades siguen estando', () => {
    expect(countryByCode(DEFAULT_COUNTRY)).toEqual({ code: 'EC', name: 'Ecuador', dial: '593' });
    for (const code of ['EC', 'CO', 'PE', 'US', 'ES', 'AR', 'BO', 'BR', 'CA', 'CL', 'CU', 'DE', 'FR', 'GB', 'IT', 'MX', 'PA', 'PY', 'UY', 'VE']) expect(countryByCode(code)).toBeDefined();
    expect(countryByCode('ZZ')).toBeUndefined();
  });
  it('CTR-03 búsqueda sin tildes ni mayúsculas, por nombre, por código ISO y por código de marcación (con o sin +); primero los que empiezan con lo escrito', () => {
    expect(searchKey('  PERÚ ')).toBe('peru');
    expect(searchCountries('peru')[0].code).toBe('PE'); expect(searchCountries('ECUADOR').map((country) => country.code)).toContain('EC');
    expect(searchCountries('ec')[0].code).toBe('EC'); // el código ISO exacto va primero
    expect(searchCountries('+593').map((country) => country.code)).toEqual(['EC']); expect(searchCountries('593').map((country) => country.code)).toEqual(['EC']);
    expect(searchCountries('+1').length).toBeGreaterThan(10); expect(searchCountries('+1').every((country) => country.dial.startsWith('1'))).toBe(true);
    expect(searchCountries('unidos').map((country) => country.code)).toEqual(expect.arrayContaining(['US', 'AE'])); // contiene
    expect(searchCountries('estados')[0].code).toBe('US'); // empieza
    expect(searchCountries('zzzz')).toEqual([]); expect(searchCountries('')).toBe(COUNTRIES);
  });
  it('CTR-04 la lista solo trae nombre, ISO-2 y código de marcación (el número nacional lo valida libphonenumber-js en la web, no una lista a mano)', () => {
    expect(COUNTRIES.every((country) => Object.keys(country).sort().join() === 'code,dial,name')).toBe(true);
    expect(E164_MAX_DIGITS).toBe(15);
    // Código de marcación + hasta 15 dígitos en total es lo que acepta Reservation (la regla E.164 no cambia).
    expect(PHONE_PATTERN.test('+593987654321')).toBe(true); expect(PHONE_PATTERN.test(`+${'9'.repeat(16)}`)).toBe(false); expect(PHONE_PATTERN.test('+0123')).toBe(false);
  });
  it('CTR-06 el carácter permitido en un nombre coincide con la regla de nombre completo (una sola definición de caracteres)', () => {
    for (const char of ['a', 'Ñ', 'é', '́', "'", '’', '-', '.', ' ']) { expect(NAME_CHAR_PATTERN.test(char)).toBe(true); }
    for (const char of ['1', '@', '_', '😀', ',', '/', '<']) { expect(NAME_CHAR_PATTERN.test(char)).toBe(false); expect(NAME_PATTERN.test(`Ana${char}`)).toBe(false); }
  });
});
