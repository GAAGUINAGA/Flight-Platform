import { afterEach, describe, expect, it, jest } from '@jest/globals';
import process from 'node:process';
import { Cleanup } from '../../test/e2e/v2/cleanup';
import { assertUtcDay, scenarioDeparture, utcDay } from '../../test/e2e/v2/schedule';

/**
 * Regresión del incidente V2-C-01/05/06/08: el escenario salía a la hora del reloj + 5 días y las pruebas agregaban vuelos 3 h antes;
 * entre 00:00 y 03:00 UTC ese vuelo caía en el día UTC anterior y Inventory (busca por día UTC) no lo devolvía.
 */
const HOUR = 3_600_000;
const legacyDeparture = (now: Date) => new Date(now.getTime() + 5 * 24 * HOUR);
/** Desfases (horas) que usan hoy las pruebas sobre el vuelo del escenario: de -12 h (c-latency) a +5 h (c-multi-offers). */
const OFFSETS_HOURS = [-12, -3, -1, 0, 1, 2, 5, 9];

describe('horario de las pruebas v2 con el reloj simulado', () => {
  afterEach(() => { jest.useRealTimers(); });

  it.each(['2026-11-07T00:42:00Z', '2026-11-07T00:52:00Z', '2026-11-07T00:00:00Z', '2026-11-07T02:59:59Z'])('con el reloj en %s la fórmula anterior fallaba y la nueva no', (clock) => {
    jest.useFakeTimers({ now: new Date(clock) });
    const legacy = legacyDeparture(new Date());
    expect(utcDay(new Date(legacy.getTime() - 3 * HOUR))).not.toBe(utcDay(legacy)); // el vuelo "−3 h" caía en el día anterior
    const departure = scenarioDeparture(new Date());
    expect(departure.getUTCHours()).toBe(14);
    for (const offset of OFFSETS_HOURS) expect(utcDay(new Date(departure.getTime() + offset * HOUR))).toBe(utcDay(departure));
  });

  it('a cualquier hora del día (cada 15 minutos) el escenario sale a las 14:00 UTC de dentro de 4 a 6 días y los desfases no cruzan el día', () => {
    for (let minute = 0; minute < 24 * 60; minute += 15) {
      const now = new Date(Date.UTC(2026, 10, 7, 0, 0) + minute * 60_000);
      const departure = scenarioDeparture(now);
      expect(departure.getUTCHours()).toBe(14); expect(departure.getUTCMinutes()).toBe(0);
      const days = (departure.getTime() - now.getTime()) / (24 * HOUR);
      expect(days).toBeGreaterThan(4); expect(days).toBeLessThanOrEqual(5.6);
      for (const offset of OFFSETS_HOURS) expect(utcDay(new Date(departure.getTime() + offset * HOUR))).toBe(utcDay(departure));
      // El vuelo de vuelta (+7 días) tampoco cambia de día con los mismos desfases.
      const back = new Date(departure.getTime() + 7 * 24 * HOUR);
      for (const offset of OFFSETS_HOURS) expect(utcDay(new Date(back.getTime() + offset * HOUR))).toBe(utcDay(back));
    }
  });

  it('con hoursAhead el desfase es exacto desde ahora (check-in a 36 h, vuelo cercano a 10 h)', () => {
    const now = new Date('2026-11-07T00:42:00Z');
    expect(scenarioDeparture(now, 36).toISOString()).toBe('2026-11-08T12:42:00.000Z');
    expect(scenarioDeparture(now, 10).toISOString()).toBe('2026-11-07T10:42:00.000Z');
  });

  it('assertUtcDay falla ruidosamente si un vuelo cae fuera del día buscado', () => {
    expect(() => assertUtcDay(new Date('2026-11-11T21:42:00Z'), '2026-11-12', 'vuelo')).toThrow('sale el 2026-11-11 UTC y la prueba busca el 2026-11-12');
    expect(() => assertUtcDay(new Date('2026-11-12T11:00:00Z'), '2026-11-12', 'vuelo')).not.toThrow();
  });
});

describe('Cleanup de las pruebas e2e', () => {
  it('registra el borrado que falla, sigue con los demás y verify() hace fallar la suite', async () => {
    const cleanup = new Cleanup(); const ran: string[] = []; const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await cleanup.step('uno', async () => { throw new Error('delete failed\nclave foránea'); });
      await cleanup.step('dos', async () => { ran.push('dos'); });
      expect(ran).toEqual(['dos']);
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('LIMPIEZA FALLÓ uno'));
      expect(() => cleanup.verify()).toThrow(/La limpieza de la prueba falló \(1\)[\s\S]*uno: clave foránea/);
    } finally { stderr.mockRestore(); }
  });

  it('sin fallos verify() no lanza y sin stack ni vuelos la comprobación de restos no hace nada', async () => {
    const cleanup = new Cleanup(); await cleanup.leftovers(undefined, ['x']); await cleanup.leftovers({} as never, []);
    expect(() => cleanup.verify()).not.toThrow();
  });

  it('si quedan datos de la prueba cuenta como fallo', async () => {
    const cleanup = new Cleanup(); const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stack = { db: { inventory: { flightInstance: { count: async () => 2 } }, pricing: { fare: { count: async () => 0 } }, operations: { operationalFlight: { count: async () => 1 } } } };
    try {
      await cleanup.leftovers(stack as never, ['a', 'b']);
      expect(() => cleanup.verify()).toThrow('2 vuelos, 1 vuelos operativos');
    } finally { stderr.mockRestore(); }
  });
});
