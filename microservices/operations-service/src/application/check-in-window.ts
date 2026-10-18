import { DomainError } from '@flight-platform/shared';

export function assertCheckInWindow(departure: Date, now: Date, openHours: number, closeMinutes: number): void {
  const remaining = departure.getTime() - now.getTime();
  if (!Number.isFinite(remaining) || remaining > openHours * 60 * 60 * 1000) throw new DomainError('CHECK_IN_NOT_AVAILABLE');
  if (remaining <= closeMinutes * 60 * 1000) throw new DomainError('CUTOFF_PASSED');
}
