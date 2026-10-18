import { assertCheckInWindow } from '../src/application/check-in-window';

describe('DCS-03: ventana con reloj fijo', () => {
  const departure = new Date('2026-10-20T12:00:00.000Z');
  it('DCS-03: antes de la apertura devuelve CHECK_IN_NOT_AVAILABLE', () => {
    expect(() => assertCheckInWindow(departure, new Date('2026-10-18T11:59:59.999Z'), 48, 60)).toThrow('CHECK_IN_NOT_AVAILABLE');
  });
  it('DCS-03: acepta la apertura y una hora dentro de la ventana', () => {
    expect(() => assertCheckInWindow(departure, new Date('2026-10-18T12:00:00.000Z'), 48, 60)).not.toThrow();
    expect(() => assertCheckInWindow(departure, new Date('2026-10-20T10:59:59.999Z'), 48, 60)).not.toThrow();
  });
  it('DCS-03: en el cierre y después devuelve CUTOFF_PASSED', () => {
    expect(() => assertCheckInWindow(departure, new Date('2026-10-20T11:00:00.000Z'), 48, 60)).toThrow('CUTOFF_PASSED');
    expect(() => assertCheckInWindow(departure, new Date('2026-10-20T11:30:00.000Z'), 48, 60)).toThrow('CUTOFF_PASSED');
  });
});
