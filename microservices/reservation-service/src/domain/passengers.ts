import { checkPassengerSet, DomainError, invalidParamsFromRuleIssues, ValidationFailedError, type PassengerBreakdown, type PassengerType } from '@flight-platform/shared';
export type { PassengerBreakdown, PassengerType };
export interface Passenger { passengerId: string; passengerType: PassengerType; associatedAdultId?: string; birthDate: string; assignedSeats?: unknown[]; }
/**
 * Las reglas viven en `@flight-platform/shared` (`passenger-rules.ts`, ADR-F12b1fix-05) para que la web adelante exactamente las mismas.
 * Aquí solo se traduce el primer incumplimiento al error de dominio que Reservation siempre ha devuelto.
 */
export function validatePassengers(passengers: Passenger[], expected: PassengerBreakdown, at: Date = new Date()): void {
  const issues = checkPassengerSet(passengers, expected, at);
  const [first] = issues;
  if (!first) return;
  if (first.code === 'INFANT_SEAT_NOT_ALLOWED') throw new DomainError('INFANT_SEAT_NOT_ALLOWED');
  // Los campos inválidos (nombre del campo y motivo de la lista cerrada, sin valores) viajan al cliente para que marque cada uno.
  throw new ValidationFailedError(invalidParamsFromRuleIssues(issues.filter((issue) => issue.code !== 'INFANT_SEAT_NOT_ALLOWED')));
}
