export const FLIGHT_STATUSES = ['SCHEDULED', 'BOARDING', 'DEPARTED', 'DELAYED', 'ARRIVED', 'CANCELLED', 'DIVERTED'] as const;
export type FlightStatusName = typeof FLIGHT_STATUSES[number];

/**
 * Copia de la tabla de transiciones de operations-service (domain/operational-flight.ts): permite responder 409
 * INVALID_STATUS_TRANSITION sin tocar Operations, que lo expresaría como VALIDATION_FAILED. Una prueba de equivalencia las compara.
 */
const ALLOWED: Record<FlightStatusName, FlightStatusName[]> = {
  SCHEDULED: ['BOARDING', 'DELAYED', 'CANCELLED'], BOARDING: ['DELAYED', 'DEPARTED'], DELAYED: ['BOARDING', 'CANCELLED'],
  DEPARTED: ['ARRIVED', 'DIVERTED'], ARRIVED: [], CANCELLED: [], DIVERTED: []
};

/** Repetir el estado actual es válido (solo cambia estimaciones, puerta o motivo). */
export const canTransition = (from: FlightStatusName, to: FlightStatusName): boolean => from === to || ALLOWED[from].includes(to);
