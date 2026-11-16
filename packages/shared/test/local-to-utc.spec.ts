import { describe, expect, it } from '@jest/globals';
import { localToUtc } from '../src/airport-time';

const ok = (local: string, zone: string): string => { const r = localToUtc(local, zone); if (!r.ok) throw new Error(r.reason); return r.instant.toISOString(); };
const reason = (local: string, zone: string): string => { const r = localToUtc(local, zone); return r.ok ? 'ok' : r.reason; };

describe('F12c-4c · localToUtc (hora civil local → UTC, rechaza inexistentes y ambiguas)', () => {
  it('LTU-01 zonas sin horario de verano', () => {
    expect(ok('2026-11-15T14:30', 'America/Guayaquil')).toBe('2026-11-15T19:30:00.000Z');
    expect(ok('2026-11-15T14:30', 'Pacific/Galapagos')).toBe('2026-11-15T20:30:00.000Z');
  });
  it('LTU-02 zonas con horario de verano (invierno y verano)', () => {
    expect(ok('2026-01-10T12:00', 'Europe/Madrid')).toBe('2026-01-10T11:00:00.000Z');
    expect(ok('2026-07-10T12:00', 'Europe/Madrid')).toBe('2026-07-10T10:00:00.000Z');
    expect(ok('2026-07-10T12:00', 'America/New_York')).toBe('2026-07-10T16:00:00.000Z');
  });
  it('LTU-03 hora inexistente (salto de primavera) se rechaza', () => {
    expect(reason('2026-03-29T02:30', 'Europe/Madrid')).toBe('nonexistent');
    expect(reason('2026-03-08T02:30', 'America/New_York')).toBe('nonexistent');
  });
  it('LTU-04 hora ambigua (retroceso de otoño) se rechaza', () => {
    expect(reason('2026-10-25T02:30', 'Europe/Madrid')).toBe('ambiguous');
    expect(reason('2026-11-01T01:30', 'America/New_York')).toBe('ambiguous');
  });
  it('LTU-05 horas contiguas a los cambios sí valen', () => {
    expect(reason('2026-03-29T01:59', 'Europe/Madrid')).toBe('ok');
    expect(reason('2026-03-29T03:00', 'Europe/Madrid')).toBe('ok');
    expect(reason('2026-10-25T01:59', 'Europe/Madrid')).toBe('ok');
    expect(reason('2026-10-25T03:00', 'Europe/Madrid')).toBe('ok');
  });
  it('LTU-06 formatos inválidos', () => {
    for (const bad of ['', '2026-11-15', '2026-11-15T14:30:00', '2026-11-15T14:30Z', '2026-02-30T10:00', '2026-11-15T24:00', '2026-13-01T10:00', 'x'])
      expect(reason(bad, 'America/Guayaquil')).toBe('invalid');
  });
});
