import { AIRPORT_ZONES } from '@flight-platform/shared/dist/src/airport-zones';
import { AIRPORT_ZONES as SERVICE_ZONES } from '@flight-platform/shared/dist/src/airport-time';
import {
  addDays, AIRPORT_NAMES, AIRPORTS, airportLabel, cityOf, compareAmounts, dayOffset, dayOffsetLabel, formatAmount, formatDate, formatDuration,
  formatLocalDate, formatLocalTime, formatLocalTimeWithZone, formatMoney, isIsoDate, localDate, maskDocument, todayAt, zoneLabel, zoneOfAirport
} from '../src';

describe('format · aeropuertos (tabla única)', () => {
  it('FMT-01 el buscador usa la MISMA tabla de zonas que los servicios y todo aeropuerto tiene nombre', () => {
    expect(AIRPORT_ZONES).toBe(SERVICE_ZONES);
    expect(AIRPORTS.map((airport) => airport.iata).sort()).toEqual(Object.keys(AIRPORT_ZONES).sort());
    expect(Object.keys(AIRPORT_NAMES).sort()).toEqual(Object.keys(AIRPORT_ZONES).sort());
    for (const airport of AIRPORTS) expect(airport.zone).toBe(AIRPORT_ZONES[airport.iata]);
    expect(airportLabel('UIO')).toBe('Quito (UIO)');
    expect(cityOf('ZZZ')).toBe('ZZZ');
  });
});

describe('format · fechas y horas en hora local del aeropuerto', () => {
  it('FMT-02 la misma hora UTC se muestra distinta en Quito, Galápagos, Lima y Madrid', () => {
    const instant = '2026-12-10T13:35:00Z';
    expect(formatLocalTime(instant, 'UIO')).toBe('08:35');
    expect(formatLocalTime(instant, 'GPS')).toBe('07:35');
    expect(formatLocalTime(instant, 'LIM')).toBe('08:35');
    expect(formatLocalTime(instant, 'MAD')).toBe('14:35');
    expect(formatLocalTimeWithZone(instant, 'UIO')).toBe('08:35 · hora de Quito');
    expect(zoneLabel('GPS')).toBe('hora de Baltra (Galápagos)');
  });

  it('FMT-03 respeta el cambio de horario (Madrid y Miami en verano e invierno)', () => {
    expect(formatLocalTime('2026-01-15T12:00:00Z', 'MAD')).toBe('13:00');
    expect(formatLocalTime('2026-07-15T12:00:00Z', 'MAD')).toBe('14:00');
    expect(formatLocalTime('2026-01-15T12:00:00Z', 'MIA')).toBe('07:00');
    expect(formatLocalTime('2026-07-15T12:00:00Z', 'MIA')).toBe('08:00');
    // La madrugada del cambio en Madrid (29-mar-2026, 02:00 → 03:00): no existe 02:30 local.
    expect(formatLocalTime('2026-03-29T00:30:00Z', 'MAD')).toBe('01:30');
    expect(formatLocalTime('2026-03-29T01:30:00Z', 'MAD')).toBe('03:30');
  });

  it('FMT-04 acepta instantes con desplazamiento y no depende de la zona del dispositivo', () => {
    expect(formatLocalTime('2026-12-10T08:35:00-05:00', 'UIO')).toBe('08:35');
    expect(formatLocalTime(new Date('2026-12-10T08:35:00-05:00'), 'GPS')).toBe('07:35');
    expect(localDate('2026-12-11T03:30:00Z', 'UIO')).toBe('2026-12-10');
    expect(formatLocalDate('2026-12-11T03:30:00Z', 'UIO')).toBe('10 dic 2026');
    expect(formatLocalDate('2026-12-11T03:30:00Z', 'MAD', { weekday: true })).toBe('vie 11 dic 2026');
  });

  it('FMT-05 «+1» cuando la llegada cae en otro día local', () => {
    // UIO 18:40 (−05) → MAD 12:25 del día siguiente (+01)
    expect(dayOffset('2026-12-10T23:40:00Z', 'UIO', '2026-12-11T11:25:00Z', 'MAD')).toBe(1);
    expect(dayOffsetLabel('2026-12-10T23:40:00Z', 'UIO', '2026-12-11T11:25:00Z', 'MAD')).toBe('+1');
    // UIO 08:35 → GPS 10:30 el mismo día local
    expect(dayOffsetLabel('2026-12-10T13:35:00Z', 'UIO', '2026-12-10T16:30:00Z', 'GPS')).toBe('');
    // Sale 23:30 de Quito y llega 00:20 a Guayaquil: +1 aunque dure 50 minutos
    expect(dayOffsetLabel('2026-12-11T04:30:00Z', 'UIO', '2026-12-11T05:20:00Z', 'GYE')).toBe('+1');
  });

  it('FMT-06 aeropuerto sin zona: se muestra en UTC con la etiqueta UTC, sin fallar', () => {
    expect(zoneOfAirport('ZZZ')).toBe('UTC');
    expect(formatLocalTime('2026-12-10T13:35:00Z', 'ZZZ')).toBe('13:35');
    expect(formatLocalTimeWithZone('2026-12-10T13:35:00Z', 'ZZZ')).toBe('13:35 · UTC');
    expect(formatLocalTime('no-es-fecha', 'UIO')).toBe('--:--');
    expect(formatLocalDate('no-es-fecha', 'UIO')).toBe('');
  });

  it('FMT-07 fechas de calendario: formato, validez, hoy en el aeropuerto y suma de días', () => {
    expect(formatDate('2026-12-10')).toBe('10 dic 2026');
    expect(formatDate('2026-01-01', { weekday: true })).toBe('jue 1 ene 2026');
    expect(formatDate('2026-02-30')).toBe('2026-02-30');
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('10/12/2026')).toBe(false);
    // 03:00 UTC del 11: en Quito y Galápagos todavía es el 10; en Madrid ya es el 11.
    const now = new Date('2026-12-11T03:00:00Z');
    expect(todayAt('UIO', now)).toBe('2026-12-10');
    expect(todayAt('GPS', now)).toBe('2026-12-10');
    expect(todayAt('MAD', now)).toBe('2026-12-11');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('FMT-08 duraciones', () => {
    expect(formatDuration(115)).toBe('1 h 55 min');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(-5)).toBe('');
  });
});

describe('format · dinero sin flotantes', () => {
  it('FMT-09 formato es-EC desde cadenas decimales, sin redondeos propios', () => {
    expect(formatMoney({ currency: 'USD', total: '254.78' })).toBe('USD 254,78');
    expect(formatAmount('1254.7')).toBe('1.254,70');
    expect(formatAmount('630')).toBe('630,00');
    expect(formatAmount('1000000.00')).toBe('1.000.000,00');
    expect(formatAmount('0.10')).toBe('0,10');
    expect(formatAmount('12.345')).toBe('12,345');
    expect(formatAmount('-35.00')).toBe('−35,00');
    expect(formatAmount('abc')).toBe('abc');
    // Un importe que un flotante no representa exactamente llega intacto.
    expect(formatAmount('9007199254740993.01')).toBe('9.007.199.254.740.993,01');
  });

  it('FMT-10 comparación exacta de importes (para ordenar por precio)', () => {
    expect(compareAmounts('127.39', '149.90')).toBeLessThan(0);
    expect(compareAmounts('149.9', '149.90')).toBe(0);
    expect(compareAmounts('1000', '999.99')).toBeGreaterThan(0);
    expect(compareAmounts('0.1', '0.09')).toBeGreaterThan(0);
    expect(compareAmounts('9007199254740993.01', '9007199254740993.02')).toBeLessThan(0);
    expect(['165.30', '127.39', '149.90'].sort(compareAmounts)).toEqual(['127.39', '149.90', '165.30']);
  });
});

describe('format · documento', () => {
  it('FMT-11 enmascara dejando solo los últimos caracteres', () => {
    expect(maskDocument('GQL1234567')).toBe('••••••4567');
    expect(maskDocument('12345')).toBe('•••45');
    expect(maskDocument('123')).toBe('•••');
    expect(maskDocument('')).toBe('');
  });
});
