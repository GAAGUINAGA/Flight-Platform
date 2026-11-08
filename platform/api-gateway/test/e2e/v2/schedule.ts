/**
 * Horario de los vuelos de las pruebas v2. Inventory busca por el día LOCAL del aeropuerto de origen (ADR-F12b1fix-02); los escenarios usan
 * orígenes aleatorios sin zona (se leen en UTC) y UIO/GYE con salida a las 14:00 UTC (09:00 locales), de modo que el día UTC y el local
 * coinciden y cualquier vuelo agregado "al mismo día" sigue en él sin importar la hora del reloj de la máquina.
 * Función pura: recibe el instante actual para poder probarla con un reloj simulado (schedule.spec.ts).
 */
export const SCENARIO_HOUR_UTC = 14;
const DAY_MS = 86_400_000;

/**
 * Salida del vuelo del escenario. Sin `hoursAhead`: dentro de 5 días a las 14:00 UTC, de modo que ±13 h siguen en el mismo día UTC.
 * Con `hoursAhead`: ese desfase exacto desde `now` (lo usan las pruebas que necesitan un vuelo cercano, p. ej. check-in a 36 h).
 */
export function scenarioDeparture(now: Date, hoursAhead?: number): Date {
  if (hoursAhead !== undefined) return new Date(now.getTime() + hoursAhead * 3_600_000);
  const departure = new Date(now.getTime() + 5 * DAY_MS);
  departure.setUTCHours(SCENARIO_HOUR_UTC, 0, 0, 0);
  return departure;
}

export const utcDay = (instant: Date): string => instant.toISOString().slice(0, 10);

/** Falla ruidosamente si una prueba coloca un vuelo fuera del día UTC que va a buscar (la causa del incidente V2-C de las 00:00-03:00 UTC). */
export function assertUtcDay(instant: Date, expectedDay: string, what: string): void {
  if (utcDay(instant) !== expectedDay) throw new Error(`${what}: sale el ${utcDay(instant)} UTC y la prueba busca el ${expectedDay}`);
}
