import { PHONE_PATTERN } from '@flight-platform/format';
import { describe, expect, it } from 'vitest';
import { maxNationalDigits, phoneE164, resolvePhone } from './phone';

/** Teléfono por país con libphonenumber-js «min» (ADR-F12b1fix-05, punto 13). */
describe('resolvePhone: el número nacional se valida PARA el país elegido', () => {
  it.each([
    ['EC', '987654321', '+593987654321'], ['EC', '0987654321', '+593987654321'], ['EC', '022345678', '+59322345678'], ['EC', '2234567', 'INVALID'],
    ['CO', '3001234567', '+573001234567'], ['ES', '612345678', '+34612345678'], ['GB', '07911123456', '+447911123456'], ['IT', '0212345678', '+390212345678'],
    ['US', '2025550123', '+12025550123'], ['US', '5551234567', 'INVALID'], ['AR', '91123456789', '+5491123456789'], ['XK', '44123456', '+38344123456'], ['CW', '95181234', '+59995181234']
  ])('PHN-01 %s %s → %s', (country, national, expected) => {
    const result = resolvePhone(country, national);
    expect(result.status).toBe(expected === 'INVALID' ? 'INVALID' : 'VALID'); expect(result.e164).toBe(expected === 'INVALID' ? '' : expected);
    if (result.e164) expect(PHONE_PATTERN.test(result.e164)).toBe(true); // lo que viaja cumple la regla E.164 de Reservation
  });
  it('PHN-02 sin dígitos, EMPTY; con otro tipo de caracteres se ignoran los que no son dígitos; país desconocido, INVALID', () => {
    expect(resolvePhone('EC', '').status).toBe('EMPTY'); expect(resolvePhone('EC', '   ').status).toBe('EMPTY');
    expect(resolvePhone('EC', '(098) 765-4321').e164).toBe('+593987654321'); expect(resolvePhone('ZZ', '987654321')).toEqual({ status: 'INVALID', e164: '' });
  });
  it('PHN-03 un número que la librería leería como de OTRO país (prefijo internacional «00» + código) no vale: el país ya está elegido', () => {
    expect(resolvePhone('EC', '00987654321')).toEqual({ status: 'INVALID', e164: '' });
    expect(resolvePhone('EC', '005939876543')).toEqual({ status: 'INVALID', e164: '' });
    expect(resolvePhone('US', '0112025550123')).toEqual({ status: 'INVALID', e164: '' }); // 011 = prefijo internacional de EE. UU.
  });
  it('PHN-04 demasiado corto, demasiado largo o un solo 0 son inválidos y nunca producen un E.164', () => {
    for (const national of ['0', '09', '9'.repeat(16), '9'.repeat(30)]) expect(phoneE164('EC', national)).toBe('');
  });
  it('PHN-05 los países que comparten el código +1 se validan cada uno con su país y sacan el E.164 con ese código', () => {
    expect(resolvePhone('CA', '4168675309')).toEqual({ status: 'VALID', e164: '+14168675309' });
    expect(resolvePhone('US', '2025550123').e164).toBe('+12025550123');
    expect(resolvePhone('CA', '2025550123').status).not.toBe('EMPTY');
  });
});

describe('maxNationalDigits: el tope de lo que se puede escribir sale de la librería', () => {
  it('PHN-06 Ecuador 11 (12 si lo escrito empieza con el 0 troncal), EE. UU. 10, España 9; país desconocido, 15', () => {
    expect(maxNationalDigits('EC')).toBe(11); expect(maxNationalDigits('EC', '0987')).toBe(12); expect(maxNationalDigits('US')).toBe(10); expect(maxNationalDigits('ES')).toBe(9); expect(maxNationalDigits('ZZ')).toBe(15);
  });
  it('PHN-07 en ningún país el tope deja escribir más de lo que cabe en un E.164 (15 dígitos en total; con 0 troncal, uno más al escribir) ni menos de 4', async () => {
    const { COUNTRIES } = await import('@flight-platform/format');
    for (const country of COUNTRIES) {
      const cap = maxNationalDigits(country.code); const withZero = maxNationalDigits(country.code, '0');
      expect(cap + country.dial.length, country.code).toBeLessThanOrEqual(15); expect(withZero, country.code).toBeLessThanOrEqual(16 - country.dial.length);
      expect(cap, country.code).toBeGreaterThanOrEqual(4);
    }
  });
});
