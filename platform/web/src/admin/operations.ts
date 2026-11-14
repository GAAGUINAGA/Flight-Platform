import type { CabinClass, FlightOperationsQuery } from '@flight-platform/graphql-schema/generated/types';

/** Resumen del dashboard operativo a partir de `flightOperations`. Sin React ni DOM. */
export type OperationFlight = FlightOperationsQuery['flightOperations']['items'][number];
export type CabinOccupancy = OperationFlight['cabins'][number];

/** Asientos que ya no están libres: apartados, vendidos, con check-in o abordados. */
export const takenSeats = (cabin: CabinOccupancy): number => Math.max(0, cabin.totalSeats - (cabin.seatsByStatus.AVAILABLE ?? cabin.totalSeats));
/** Ocupación de una cabina en porcentaje entero (0 si no tiene asientos). */
export const cabinPercent = (cabin: CabinOccupancy): number => (cabin.totalSeats > 0 ? Math.round((takenSeats(cabin) / cabin.totalSeats) * 100) : 0);

export interface Summary { flights: number; averageOccupancy: number; activeHolds: number; alerts: number }
/** Ocupación media ponderada por asientos (no promedio de promedios): asientos tomados ÷ asientos totales de los vuelos cargados. */
export function summarize(items: readonly OperationFlight[]): Summary {
  let taken = 0; let total = 0; let holds = 0; let alerts = 0;
  for (const flight of items) {
    for (const cabin of flight.cabins) { taken += takenSeats(cabin); total += cabin.totalSeats; }
    holds += flight.activeHolds; alerts += flight.alerts.filter((alert) => alert.code !== 'CHECKIN_OPEN').length;
  }
  return { flights: items.length, averageOccupancy: total > 0 ? Math.round((taken / total) * 100) : 0, activeHolds: holds, alerts };
}

export const ALERT_LABEL: Readonly<Record<string, string>> = { LOW_AVAILABILITY: 'Pocos asientos', DELAYED: 'Retrasado', CANCELLED: 'Cancelado', CHECKIN_OPEN: 'Check-in abierto' };
export const alertLabel = (code: string): string => ALERT_LABEL[code] ?? code;
export const SEVERITY_LABEL: Readonly<Record<string, string>> = { INFO: 'Información', WARNING: 'Atención', CRITICAL: 'Crítica' };

export type HealthLabel = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UP';
export const HEALTH_LABEL: Readonly<Record<HealthLabel, string>> = { HEALTHY: 'Saludable', DEGRADED: 'Degradada', DOWN: 'Caída', UP: 'Operativo' };
export const healthLabel = (status: string): string => HEALTH_LABEL[status as HealthLabel] ?? status;
export const healthTone = (status: string): 'ok' | 'warn' | 'bad' => (status === 'HEALTHY' || status === 'UP' ? 'ok' : status === 'DEGRADED' ? 'warn' : 'bad');

export const cabinOrder: readonly CabinClass[] = ['FIRST', 'BUSINESS', 'PREMIUM_ECONOMY', 'ECONOMY'];
