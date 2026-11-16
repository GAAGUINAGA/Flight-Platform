import { describe, expect, it } from '@jest/globals';
import { ADMIN_ERROR_CODES, ADMIN_RESULTS, adminErrorCode, asPnr, buildAccessRow, InMemoryAdminAccessLog, type AdminAccessEntry } from './admin-access-log';
import { GatewayProblemError } from './web-errors';

/** F12c-4a (audit-38, H2): lo que se guarda en el registro solo puede ser un valor de una lista cerrada o un PNR válido; nunca texto de un error. */
const base: AdminAccessEntry = { actorSub: 'admin-1', action: 'SEARCH_PNR', result: 'ERROR' };
const SENSITIVE = ['ana@example.com', '1234567890123456789', 'AB1234567', 'Pérez'];

describe('F12c-4a: lista cerrada del registro de accesos', () => {
  it('ADM4-LOG-U-01: un error con details que trae texto, correo o un número largo se guarda como su código del catálogo o UNKNOWN_ERROR, nunca con ese texto', () => {
    const cases: Array<[unknown, string]> = [
      [{ code: 5, details: 'reserva de Ana Pérez ana@example.com no existe' }, 'NOT_FOUND'],
      [{ code: 14, details: '1234567890123456789' }, 'UNAVAILABLE'],
      [{ code: 4, details: 'AB1234567' }, 'DEADLINE_EXCEEDED'],
      [{ code: 3, details: 'ana@example.com' }, 'VALIDATION_FAILED'],
      [{ code: 13, details: 'Pérez' }, 'INTERNAL_ERROR'],
      [{ code: 99, details: 'ana@example.com' }, 'UNKNOWN_ERROR'],
      [{ details: 'ana@example.com', message: 'AB1234567' }, 'UNKNOWN_ERROR'],
      [{ code: 'ana@example.com' }, 'UNKNOWN_ERROR'],
      [new Error('ana@example.com 1234567890123456789'), 'UNKNOWN_ERROR'],
      [new GatewayProblemError(503, 'PROVIDER_UNAVAILABLE', 'detalle con ana@example.com'), 'PROVIDER_UNAVAILABLE'],
      [new GatewayProblemError(500, 'ana@example.com'), 'UNKNOWN_ERROR'],
      ['ana@example.com', 'UNKNOWN_ERROR'], [null, 'UNKNOWN_ERROR'], [undefined, 'UNKNOWN_ERROR']
    ];
    for (const [error, expected] of cases) {
      const code = adminErrorCode(error); expect(code).toBe(expected); expect(ADMIN_ERROR_CODES).toContain(code);
      for (const text of SENSITIVE) expect(JSON.stringify(buildAccessRow({ ...base, errorCode: code }))).not.toContain(text);
    }
  });
  it('ADM4-LOG-U-02: la fila solo admite valores de la lista aunque un llamador evada los tipos', async () => {
    const hostile = { ...base, errorCode: 'ana@example.com 1234567890123456789', subject: 'Ana Pérez ana@example.com', correlationId: 'c1' } as unknown as AdminAccessEntry;
    expect(buildAccessRow(hostile)).toEqual({ actorSub: 'admin-1', action: 'SEARCH_PNR', subject: null, result: 'ERROR', errorCode: 'UNKNOWN_ERROR', correlationId: 'c1' });
    const log = new InMemoryAdminAccessLog(); await log.record(hostile);
    for (const text of SENSITIVE) expect(JSON.stringify(log.rows)).not.toContain(text);
    expect(() => buildAccessRow({ ...base, result: 'texto libre' } as unknown as AdminAccessEntry)).toThrow(/closed list/);
    expect(() => buildAccessRow({ ...base, action: 'OTRA' } as unknown as AdminAccessEntry)).toThrow(/closed list/);
    for (const result of ADMIN_RESULTS) expect(buildAccessRow({ ...base, result }).result).toBe(result);
  });
  it('ADM4-LOG-U-03: subject solo es un PNR con el formato de la plataforma, o nulo', () => {
    expect(asPnr('J4R8GZ')).toBe('J4R8GZ');
    for (const bad of ['j4r8gz', 'J4R8G0', 'J4R8GI', 'J4R8GZZ', 'J4R8G', ' J4R8GZ', '', 5, null, undefined, {}, 'ana@example.com']) expect(asPnr(bad)).toBeNull();
    expect(buildAccessRow({ ...base, subject: 'J4R8GZ' as never }).subject).toBe('J4R8GZ'); expect(buildAccessRow({ ...base, subject: 'AB1234567' as never }).subject).toBeNull();
  });
});
