import { describe, expect, it } from 'vitest';
import { checkInMessage, checkInWindow, nextPendingSegment } from './checkin-rules';

// Salida del 10-dic-2026 08:35 en Quito (UTC−5) = 13:35Z.
const DEPARTURE = '2026-12-10T13:35:00Z';
const base = { departureAt: DEPARTURE, origin: 'UIO', openHours: 48, closeMinutes: 60 };
const at = (iso: string) => checkInWindow({ ...base, now: new Date(iso) })!;

describe('ventana de check-in en la hora local del aeropuerto (§3.12; bordes de 48 h y 60 min)', () => {
  it('CHK-01 abre exactamente 48 h antes: un segundo antes está cerrado aún y en el instante exacto está abierto', () => {
    expect(at('2026-12-08T13:34:59Z').state).toBe('before');
    expect(at('2026-12-08T13:35:00Z').state).toBe('open');
  });

  it('CHK-02 cierra exactamente 60 min antes de la salida: un segundo antes sigue abierto y en el instante exacto ya cerró', () => {
    expect(at('2026-12-10T12:34:59Z').state).toBe('open');
    expect(at('2026-12-10T12:35:00Z').state).toBe('closed');
    expect(at('2026-12-10T13:40:00Z').state).toBe('closed'); // ya salió
  });

  it('CHK-03 cuándo abre se dice en la hora local del aeropuerto, no en la del navegador', () => {
    const window = at('2026-12-01T00:00:00Z');
    expect(window.opensLabel).toBe('8 dic 2026 a las 08:35, hora de Quito');
    expect(window.closesLabel).toBe('10 dic 2026 a las 07:35, hora de Quito');
    expect(checkInMessage(window)).toBe('El check-in abre el 8 dic 2026 a las 08:35, hora de Quito.');
    expect(checkInMessage(at('2026-12-09T00:00:00Z'))).toBe('El check-in está abierto y cierra el 10 dic 2026 a las 07:35, hora de Quito.');
    expect(checkInMessage(at('2026-12-10T12:40:00Z'))).toBe('El check-in cerró el 10 dic 2026 a las 07:35, hora de Quito.');
  });

  it('CHK-04 en Galápagos (UTC−6) la hora local cambia respecto de Quito', () => {
    const window = checkInWindow({ ...base, origin: 'GPS', now: new Date('2026-12-01T00:00:00Z') })!;
    expect(window.opensLabel).toBe('8 dic 2026 a las 07:35, hora de Baltra (Galápagos)');
  });

  it('CHK-05 los umbrales son parámetros (no fijos) y los valores inválidos no producen una ventana', () => {
    expect(checkInWindow({ ...base, openHours: 24, now: new Date('2026-12-08T13:35:00Z') })!.state).toBe('before');
    expect(checkInWindow({ ...base, departureAt: 'no-es-fecha' })).toBeNull();
    expect(checkInWindow({ ...base, openHours: 0 })).toBeNull();
    expect(checkInMessage(null)).toContain('No pudimos calcular');
  });

  it('CHK-06 el primer tramo pendiente es el de salida más próxima que no salió ni tiene pase', () => {
    const segments = [{ segmentId: 's1', departureAt: '2026-12-10T13:35:00Z', origin: 'UIO' }, { segmentId: 's2', departureAt: '2026-12-17T15:00:00Z', origin: 'GPS' }];
    expect(nextPendingSegment(segments, new Set(), new Date('2026-12-09T00:00:00Z'))?.segmentId).toBe('s1');
    expect(nextPendingSegment(segments, new Set(['s1']), new Date('2026-12-09T00:00:00Z'))?.segmentId).toBe('s2');
    expect(nextPendingSegment(segments, new Set(), new Date('2026-12-11T00:00:00Z'))?.segmentId).toBe('s2'); // s1 ya salió
    expect(nextPendingSegment(segments, new Set(['s1', 's2']))).toBeNull();
  });
});
