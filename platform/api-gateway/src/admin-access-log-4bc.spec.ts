import { describe, expect, it } from '@jest/globals';
import { adminErrorCode, buildAccessRow, type AdminAccessEntry } from './admin-access-log';

describe('F12c-4b/4c: acciones CHECK_IN, BOARDING_PASSES, CREATE_FLIGHT y OPEN_FLIGHT en el mismo punto único', () => {
  const row = (action: AdminAccessEntry['action'], subject: unknown) => buildAccessRow({ actorSub: 'admin-1', action, result: 'OK', subject: subject as never });
  it('ADM4-LOG-U-04: el sujeto se valida según la acción — PNR (búsqueda, check-in, pases), número de vuelo (crear), id de instancia (abrir); cualquier otra cosa ⇒ nulo', () => {
    for (const action of ['SEARCH_PNR', 'CHECK_IN', 'BOARDING_PASSES'] as const) { expect(row(action, 'J4R8GZ').subject).toBe('J4R8GZ'); expect(row(action, 'FP210').subject).toBeNull(); expect(row(action, 'Ana Pérez ana@example.com').subject).toBeNull(); }
    expect(row('CREATE_FLIGHT', 'FP210').subject).toBe('FP210'); expect(row('CREATE_FLIGHT', 'J4R8GZ').subject).toBeNull(); expect(row('CREATE_FLIGHT', 'FP21A').subject).toBeNull(); expect(row('CREATE_FLIGHT', 'Ana Pérez ana@example.com').subject).toBeNull();
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e'; expect(row('OPEN_FLIGHT', id).subject).toBe(id); expect(row('OPEN_FLIGHT', 'FP210').subject).toBeNull(); expect(row('OPEN_FLIGHT', 'x'.repeat(2000)).subject).toBeNull();
  });
  it('ADM4-LOG-U-05: un error de negocio llega como estado gRPC genérico + su código de catálogo en details: solo vale si ES un valor de la lista cerrada', () => {
    expect(adminErrorCode({ code: 9, details: 'CHECK_IN_NOT_AVAILABLE' })).toBe('CHECK_IN_NOT_AVAILABLE');
    expect(adminErrorCode({ code: 6, details: 'FLIGHT_ALREADY_EXISTS' })).toBe('FLIGHT_ALREADY_EXISTS');
    expect(adminErrorCode({ code: 9, details: 'Ana Pérez ana@example.com' })).toBe('UNKNOWN_ERROR');
    expect(adminErrorCode({ code: 9, details: 'SEAT_TAKEN' })).toBe('UNKNOWN_ERROR');
    expect(adminErrorCode({ code: 5, details: 'FLIGHT_NOT_READY' })).toBe('NOT_FOUND');
  });
});
