import { describe, expect, it } from '@jest/globals';
import {
  AIRPORT_ZONES, dayWindows, flightLocalDay, flightLocalTime, localDay, localDayRange, localTime, originDayRange, resetZoneWarnings, resolveZone, zoneOf
} from '../src/airport-time';

const iso = ([from, to]: [Date, Date]): [string, string] => [from.toISOString(), to.toISOString()];

describe('NFR-TI-01 · fecha local del aeropuerto (LD-01..03, LD-08)', () => {
  it('LD-01 ventana UTC del día local por zona', () => {
    expect(iso(localDayRange('2026-11-10', 'America/Guayaquil'))).toEqual(['2026-11-10T05:00:00.000Z', '2026-11-11T05:00:00.000Z']);
    expect(iso(localDayRange('2026-11-10', 'America/Lima'))).toEqual(['2026-11-10T05:00:00.000Z', '2026-11-11T05:00:00.000Z']);
    expect(iso(localDayRange('2026-11-10', 'Europe/Madrid'))).toEqual(['2026-11-09T23:00:00.000Z', '2026-11-10T23:00:00.000Z']);
    expect(iso(localDayRange('2026-11-10', 'Pacific/Kiritimati'))).toEqual(['2026-11-09T10:00:00.000Z', '2026-11-10T10:00:00.000Z']);
    expect(iso(localDayRange('2026-11-10', 'UTC'))).toEqual(['2026-11-10T00:00:00.000Z', '2026-11-11T00:00:00.000Z']);
  });

  it('LD-02 bordes exactos: [inicio, fin) y fecha/hora locales de un instante', () => {
    const [from, to] = localDayRange('2026-11-10', 'America/Guayaquil');
    expect(localDay(from, 'America/Guayaquil')).toBe('2026-11-10');
    expect(localTime(from, 'America/Guayaquil')).toBe('00:00');
    expect(localDay(new Date(to.getTime() - 1), 'America/Guayaquil')).toBe('2026-11-10');
    expect(localDay(to, 'America/Guayaquil')).toBe('2026-11-11');
    expect(localDay(new Date(from.getTime() - 1), 'America/Guayaquil')).toBe('2026-11-09');
    expect(localDay('2026-11-11T03:30:00.000Z', 'America/Lima')).toBe('2026-11-10');
    expect(localTime('2026-11-11T03:30:00.000Z', 'America/Lima')).toBe('22:30');
  });

  it.each([
    ['America/New_York', '2026-03-08', ['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z']],
    ['America/New_York', '2026-11-01', ['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z']],
    ['Europe/Madrid', '2026-03-29', ['2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z']],
    ['Europe/Madrid', '2026-10-25', ['2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z']],
    ['America/Havana', '2026-03-08', ['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z']]
  ] as const)('LD-03 cambio de horario %s %s dura 23 o 25 h', (zone, date, expected) => {
    expect(iso(localDayRange(date, zone))).toEqual([...expected]);
  });

  it.each(['America/New_York', 'Europe/Madrid', 'America/Havana', 'America/Guayaquil', 'Pacific/Kiritimati', 'Australia/Lord_Howe'])('LD-03 %s: 400 días seguidos sin huecos ni solapes y cada uno contiene su fecha', (zone) => {
    let date = '2026-01-01';
    for (let i = 0; i < 400; i += 1) {
      const [from, to] = localDayRange(date, zone);
      expect(from.getTime()).toBeLessThan(to.getTime());
      expect(localDay(new Date(to.getTime() - 1), zone)).toBe(date);
      const next = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + 1)).toISOString().slice(0, 10);
      expect(localDayRange(next, zone)[0].getTime()).toBe(to.getTime());
      expect(localDay(to, zone)).toBe(next);
      date = next;
    }
  });

  it('LD-08 toda zona de la tabla es una zona IANA válida y cubre Ecuador, BOG, MDE, LIM, MAD y MIA', () => {
    for (const zone of new Set(Object.values(AIRPORT_ZONES))) expect(() => localDay(new Date(0), zone)).not.toThrow();
    for (const iata of ['UIO', 'GYE', 'GPS', 'BOG', 'MDE', 'LIM', 'MAD', 'MIA']) expect(zoneOf(iata)).toBeDefined();
    expect(zoneOf('ZZZ')).toBeUndefined();
    expect(zoneOf('constructor')).toBeUndefined();
  });

  it('LD-08 lectura sin zona: UTC y un único aviso por IATA con solo el IATA y la operación', () => {
    resetZoneWarnings();
    const messages: string[] = [];
    const warn = (message: string) => messages.push(message);
    expect(resolveZone('QQQ', 'search', warn)).toBe('UTC');
    expect(flightLocalDay('2026-11-11T03:30:00.000Z', 'QQQ', 'getFlightStatus', warn)).toBe('2026-11-11');
    expect(flightLocalTime('2026-11-11T03:30:00.000Z', 'QQQ', 'getFlightStatus', warn)).toBe('03:30');
    expect(messages).toEqual(['airport_zone_missing iata=QQQ operation=search']);
    expect(iso(originDayRange('2026-11-10', 'QQQ', 'search', warn))).toEqual(['2026-11-10T00:00:00.000Z', '2026-11-11T00:00:00.000Z']);
    expect(resolveZone('LIM', 'search', warn)).toBe('America/Lima');
    expect(messages).toHaveLength(1);
  });

  it('LD-05 dayWindows: una ventana por zona y una en UTC para los demás; el caso LIM 22:30 cae en su día local', () => {
    const windows = dayWindows('2026-11-10');
    const departure = new Date('2026-11-11T03:30:00.000Z');
    const owner = (iata: string) => windows.find((w) => (w.exclude ? !w.iatas.includes(iata) : w.iatas.includes(iata)));
    const lima = owner('LIM')!;
    expect(departure >= lima.from && departure < lima.to).toBe(true);
    const other = dayWindows('2026-11-11');
    const limaNext = other.find((w) => w.iatas.includes('LIM') && !w.exclude)!;
    expect(departure >= limaNext.from && departure < limaNext.to).toBe(false);
    const unknown = owner('QQQ')!;
    expect(unknown.exclude).toBe(true);
    expect(unknown.from.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(windows.filter((w) => !w.exclude).flatMap((w) => w.iatas).sort()).toEqual(Object.keys(AIRPORT_ZONES).sort());
  });
});
