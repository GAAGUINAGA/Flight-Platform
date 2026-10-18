import { completedStatus, transitionCheckIn, transitionPassengerSegment } from '../src/domain/check-in';

describe('DCS-02: máquinas de estado de check-in', () => {
  it('DCS-02: permite apertura, inicio, finalización y posterior invalidación', () => {
    expect(transitionCheckIn('NOT_ELIGIBLE', 'AVAILABLE')).toBe('AVAILABLE');
    expect(transitionCheckIn('AVAILABLE', 'IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(transitionCheckIn('IN_PROGRESS', 'COMPLETED')).toBe('COMPLETED');
    expect(transitionCheckIn('COMPLETED', 'NOT_ELIGIBLE')).toBe('NOT_ELIGIBLE');
    expect(transitionCheckIn('AVAILABLE', 'NOT_ELIGIBLE')).toBe('NOT_ELIGIBLE');
    expect(transitionCheckIn('IN_PROGRESS', 'FAILED')).toBe('FAILED');
  });
  it('DCS-02: rechaza transiciones no permitidas del agregado', () => {
    expect(() => transitionCheckIn('NOT_ELIGIBLE', 'COMPLETED')).toThrow('VALIDATION_FAILED');
    expect(() => transitionCheckIn('FAILED', 'COMPLETED')).toThrow('VALIDATION_FAILED');
    expect(() => transitionCheckIn('COMPLETED', 'IN_PROGRESS')).toThrow('VALIDATION_FAILED');
  });
  it('DCS-02: pasajero por segmento solo pasa de pendiente a éxito o fallo', () => {
    expect(transitionPassengerSegment('NOT_CHECKED_IN', 'CHECKED_IN')).toBe('CHECKED_IN');
    expect(transitionPassengerSegment('NOT_CHECKED_IN', 'FAILED')).toBe('FAILED');
    expect(() => transitionPassengerSegment('CHECKED_IN', 'FAILED')).toThrow('VALIDATION_FAILED');
    expect(() => transitionPassengerSegment('FAILED', 'CHECKED_IN')).toThrow('VALIDATION_FAILED');
  });
  it('DCS-02: resultado mixto completa; todos fallidos produce FAILED', () => {
    expect(completedStatus(['CHECKED_IN', 'FAILED'])).toBe('COMPLETED');
    expect(completedStatus(['FAILED', 'FAILED'])).toBe('FAILED');
    expect(() => completedStatus([])).toThrow('VALIDATION_FAILED');
    expect(() => completedStatus(['CHECKED_IN', 'NOT_CHECKED_IN'])).toThrow('VALIDATION_FAILED');
  });
});
