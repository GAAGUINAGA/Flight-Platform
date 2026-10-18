import { DomainError } from '@flight-platform/shared';

export type CheckInStatus = 'NOT_ELIGIBLE' | 'AVAILABLE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
export type PassengerSegmentStatus = 'NOT_CHECKED_IN' | 'CHECKED_IN' | 'FAILED';
const transitions: Record<CheckInStatus, CheckInStatus[]> = {
  NOT_ELIGIBLE: ['AVAILABLE'],
  AVAILABLE: ['IN_PROGRESS', 'NOT_ELIGIBLE'],
  IN_PROGRESS: ['COMPLETED', 'FAILED'],
  COMPLETED: ['NOT_ELIGIBLE'],
  FAILED: []
};

export function transitionCheckIn(current: CheckInStatus, next: CheckInStatus): CheckInStatus {
  if (!transitions[current].includes(next)) throw new DomainError('VALIDATION_FAILED');
  return next;
}

export function transitionPassengerSegment(current: PassengerSegmentStatus, next: PassengerSegmentStatus): PassengerSegmentStatus {
  if (current !== 'NOT_CHECKED_IN' || (next !== 'CHECKED_IN' && next !== 'FAILED')) throw new DomainError('VALIDATION_FAILED');
  return next;
}

export function completedStatus(results: PassengerSegmentStatus[]): 'COMPLETED' | 'FAILED' {
  if (results.length === 0 || results.some((result) => result === 'NOT_CHECKED_IN')) throw new DomainError('VALIDATION_FAILED');
  return results.some((result) => result === 'CHECKED_IN') ? 'COMPLETED' : 'FAILED';
}
