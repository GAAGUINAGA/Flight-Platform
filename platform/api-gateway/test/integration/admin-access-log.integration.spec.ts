/* global __dirname */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { Request } from 'express';

jest.mock('../../src/grpc-clients', () => ({ ...(jest.requireActual('../../src/grpc-clients') as object), callGatewayGrpc: jest.fn() }));
import { callGatewayGrpc } from '../../src/grpc-clients';
import { PrismaClient } from '../../generated/prisma-client';
import { AdminApiController } from '../../src/admin-api';
import { PrismaAdminAccessLog } from '../../src/admin-access-log';
import { InMemoryV2StateStore } from '../../src/v2/state';
import type { GatewayConfig } from '../../src/config';

/**
 * F12c-4a (corrección previa a la auditoría): el registro contra Postgres REAL (sin dobles de Prisma).
 * Requiere DATABASE_URL del Gateway (el cliente Prisma carga el .env del Gateway; si falta, `$connect` falla de inmediato y la suite no sigue) y las DOS migraciones aplicadas (tabla y triggers de solo inserción). Las filas de prueba NO se pueden borrar
 * (esa es la propiedad que se prueba): llevan un actor `it-…` único y se depuran con el procedimiento documentado.
 */
const PNR_OK = 'J4R8GZ'; const PNR_MISSING = 'ZZZZZZ';
const view = { bookingId: '00000000-0000-4000-8000-0000000000c1', pnr: PNR_OK, status: 'CONFIRMED', channel: 'WEB', createdAt: '2026-11-14T10:00:00.000Z', grandTotal: { currency: 'USD', total: '1.00' }, segments: [], passengers: [], tickets: [] };

describe('F12c-4a integración: gateway.admin_access_log en Postgres real', () => {
  const prisma = new PrismaClient(); const log = new PrismaAdminAccessLog(prisma); let connected = false;
  const actor = () => `it-${randomUUID().slice(0, 12)}`;
  beforeAll(async () => { await prisma.$connect(); connected = true; });
  afterAll(async () => { if (connected) await prisma.$disconnect(); });
  const triggers = () => prisma.$queryRawUnsafe<Array<{ tgname: string; tgenabled: string }>>("SELECT tgname, tgenabled FROM pg_catalog.pg_trigger WHERE tgrelid = 'gateway.admin_access_log'::regclass AND NOT tgisinternal ORDER BY tgname");
  const EXPECTED_TRIGGERS = [{ tgname: 'admin_access_log_no_truncate', tgenabled: 'O' }, { tgname: 'admin_access_log_no_update_delete', tgenabled: 'O' }];
  const rowsOf = (actorSub: string) => prisma.adminAccessLog.findMany({ where: { actorSub }, orderBy: { at: 'asc' } });

  it('ADM4-LOG-IT-01: insertar y leer funciona', async () => {
    const sub = actor();
    await log.record({ actorSub: sub, action: 'SEARCH_PNR', subject: PNR_OK, result: 'FOUND', correlationId: 'it-1' });
    const rows = await rowsOf(sub);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ actorSub: sub, action: 'SEARCH_PNR', subject: PNR_OK, result: 'FOUND', errorCode: null, correlationId: 'it-1' }); expect(rows[0].at).toBeInstanceOf(Date);
    expect(await log.countSince(sub, 'SEARCH_PNR', new Date(Date.now() - 60_000))).toBe(1); expect(await log.countSince(sub, 'SEARCH_PNR', new Date(Date.now() + 60_000))).toBe(0);
  });

  /** SQLSTATE de un error de Prisma (en `meta.code` de las consultas crudas o dentro del mensaje); NO depende del texto del mensaje. */
  const sqlState = async (operation: Promise<unknown>): Promise<string> => {
    try { await operation; } catch (error) { const failure = error as { meta?: { code?: string }; code?: string; message?: string }; return failure.meta?.code ?? /(42501|23[0-9]{3}|P2010)/.exec(String(failure.message))?.[0] ?? `sin-codigo:${failure.code ?? '?'}`; }
    return 'sin-error';
  };

  it('ADM4-LOG-IT-02: UPDATE, DELETE y TRUNCATE fallan con 42501 (insufficient_privilege: el trigger antes del paso de permisos, los permisos después) y la fila queda intacta', async () => {
    // Antes de cualquier operación destructiva se exige que los triggers existan: sin ellos (migración sin aplicar) esta prueba NO toca la tabla.
    const present = await triggers();
    if (JSON.stringify(present) !== JSON.stringify(EXPECTED_TRIGGERS)) throw new Error('falta aplicar la migración 20261115120000_gateway_admin_access_log_immutable: la prueba no toca la tabla');
    const sub = actor(); await log.record({ actorSub: sub, action: 'SEARCH_PNR', subject: PNR_OK, result: 'FOUND', correlationId: 'it-2' });
    const [row] = await rowsOf(sub);
    const attempts: Array<[string, Promise<unknown>]> = [
      ['UPDATE', prisma.$executeRawUnsafe("UPDATE gateway.admin_access_log SET result = 'NOT_FOUND' WHERE id = $1::uuid", row.id)],
      ['UPDATE (todas las filas del actor)', prisma.$executeRawUnsafe('UPDATE gateway.admin_access_log SET subject = NULL WHERE actor_sub = $1', sub)],
      ['DELETE', prisma.$executeRawUnsafe('DELETE FROM gateway.admin_access_log WHERE id = $1::uuid', row.id)],
      ['DELETE (todas las filas del actor)', prisma.$executeRawUnsafe('DELETE FROM gateway.admin_access_log WHERE actor_sub = $1', sub)],
      ['TRUNCATE', prisma.$executeRawUnsafe('TRUNCATE TABLE gateway.admin_access_log')]
    ];
    const outcomes = await Promise.all(attempts.map(async ([name, operation]) => [name, await sqlState(operation)] as const));
    expect(outcomes).toEqual(attempts.map(([name]) => [name, '42501']));
    // Las operaciones del modelo de Prisma no exponen el SQLSTATE: aquí solo se exige que fallen (sin depender del texto) y que la fila siga igual.
    await expect(prisma.adminAccessLog.update({ where: { id: row.id }, data: { result: 'NOT_FOUND' } })).rejects.toThrow();
    await expect(prisma.adminAccessLog.deleteMany({ where: { actorSub: sub } })).rejects.toThrow();
    expect(await rowsOf(sub)).toEqual([row]);
    expect(await prisma.adminAccessLog.count()).toBeGreaterThan(0);
  });

  it('ADM4-LOG-IT-03: las migraciones dejaron los dos triggers activos', async () => {
    expect(await triggers()).toEqual(EXPECTED_TRIGGERS);
  });

  it('ADM4-LOG-IT-05: el SQL de la migración de triggers, ejecutado en una transacción que SE REVIERTE, rechaza UPDATE, DELETE y TRUNCATE incluso del dueño', async () => {
    if ((await triggers()).length > 0) return; // ya aplicada: la cubren IT-02 e IT-03
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261115120000_gateway_admin_access_log_immutable/migration.sql'), 'utf8').split(/\r?\n\s*\r?\n/).filter((part) => part.trim().length > 0);
    class Rollback extends Error {}
    await prisma.$transaction(async (tx) => {
      for (const statement of sql) await tx.$executeRawUnsafe(statement);
      await tx.adminAccessLog.create({ data: { actorSub: 'it-migration', action: 'SEARCH_PNR', result: 'FOUND' } });
      for (const probe of ["UPDATE gateway.admin_access_log SET result = 'X' WHERE actor_sub = 'it-migration'", "DELETE FROM gateway.admin_access_log WHERE actor_sub = 'it-migration'", 'TRUNCATE TABLE gateway.admin_access_log']) {
        await tx.$executeRawUnsafe('SAVEPOINT probe'); await expect(tx.$executeRawUnsafe(probe)).rejects.toThrow(/solo insercion/); await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT probe');
      }
      throw new Rollback();
    }).catch((error: unknown) => { if (!(error instanceof Rollback)) throw error; });
    expect(await triggers()).toEqual([]); // nada quedó aplicado
  });

  describe('cada intento de búsqueda queda registrado antes de responder, y el límite cuenta todos', () => {
    const config = { admin: { pnrSearchLimitPerHour: 30, checkInLimitPerHour: 60 }, internalApiKey: 'x'.repeat(32) } as unknown as GatewayConfig;
    const controller = new AdminApiController(config, new InMemoryV2StateStore(), log);
    const request = (sub: string): Request => ({ auth: { ownerId: sub, role: 'admin', scopes: new Set(['flights:admin']) }, res: { getHeader: () => 'corr-it', setHeader: () => undefined } }) as unknown as Request;
    const run = async (sub: string, pnr: string) => controller.searchBooking(request(sub), { pnr }).then(() => 'ok', (error: { statusCode?: number }) => error.statusCode ?? 'error');

    it('ADM4-LOG-IT-04: FOUND, NOT_FOUND e INVALID_FORMAT (sin guardar el texto); el intento 31 recibe 429 y también queda registrado', async () => {
      jest.mocked(callGatewayGrpc).mockImplementation(async (_config, _service, method, input) => {
        if (method === 'adminGetReservationByPnr') { if ((input as { pnr: string }).pnr === PNR_MISSING) throw { code: 5, details: 'NOT_FOUND' }; return view; }
        return { bookingId: view.bookingId, status: 'NOT_STARTED', passengers: [] };
      });
      const sub = actor(); const outcomes: Array<string | number> = [];
      for (let index = 0; index < 10; index += 1) outcomes.push(await run(sub, PNR_OK), await run(sub, PNR_MISSING), await run(sub, index % 2 ? 'ab' : 'texto con espacios y datos personales'));
      expect(outcomes.filter((value) => value === 'ok')).toHaveLength(10); expect(outcomes.filter((value) => value === 404)).toHaveLength(20);
      expect(await run(sub, PNR_OK)).toBe(429);
      const rows = await rowsOf(sub);
      const count = (result: string) => rows.filter((row) => row.result === result).length;
      expect({ FOUND: count('FOUND'), NOT_FOUND: count('NOT_FOUND'), INVALID_FORMAT: count('INVALID_FORMAT'), RATE_LIMITED: count('RATE_LIMITED'), total: rows.length }).toEqual({ FOUND: 10, NOT_FOUND: 10, INVALID_FORMAT: 10, RATE_LIMITED: 1, total: 31 });
      expect(rows.filter((row) => row.result === 'FOUND' || row.result === 'NOT_FOUND').map((row) => row.subject)).toEqual(Array.from({ length: 10 }, () => [PNR_OK, PNR_MISSING]).flat());
      expect(rows.filter((row) => row.result === 'INVALID_FORMAT').every((row) => row.subject === null)).toBe(true);
      expect(JSON.stringify(rows)).not.toMatch(/datos personales|texto con espacios/);
      expect(rows.every((row) => row.actorSub === sub && row.action === 'SEARCH_PNR' && row.correlationId === 'corr-it')).toBe(true);
      // Otro administrador no se ve afectado.
      expect(await run(actor(), PNR_OK)).toBe('ok');
    });

    it('ADM4-LOG-IT-06 (audit-38 H1 y H2): cuerpos {} y {"pnr":5} quedan como INVALID_FORMAT sin sujeto; un error de servicio con details guarda solo su código del catálogo', async () => {
      const sub = actor(); const hostile = 'ana@example.com 1234567890123456789 AB1234567';
      jest.mocked(callGatewayGrpc).mockImplementation(async (_config, _service, method) => {
        if (method === 'adminGetReservationByPnr') throw { code: 14, details: hostile };
        return { bookingId: view.bookingId, status: 'NOT_STARTED', passengers: [] };
      });
      const invalid = [await controller.searchBooking(request(sub), {}).then(() => 'ok', (error: { statusCode?: number }) => error.statusCode), await controller.searchBooking(request(sub), { pnr: 5 }).then(() => 'ok', (error: { statusCode?: number }) => error.statusCode)];
      expect(invalid).toEqual([404, 404]);
      await expect(controller.searchBooking(request(sub), { pnr: PNR_OK })).rejects.toMatchObject({ code: 14 });
      const rows = await rowsOf(sub);
      expect(rows.map((row) => [row.result, row.subject, row.errorCode])).toEqual([['INVALID_FORMAT', null, null], ['INVALID_FORMAT', null, null], ['ERROR', PNR_OK, 'UNAVAILABLE']]);
      expect(JSON.stringify(rows)).not.toMatch(/ana@example|1234567890123456789|AB1234567/);
    });
  });
});
