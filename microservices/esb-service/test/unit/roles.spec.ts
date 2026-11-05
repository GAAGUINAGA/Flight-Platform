import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createEsbApp } from '../../src/app';
import { OPERATIONS } from '../../src/domain/catalog';
import { FakeInvoker, FakeProbe, KEY, MemoryLogger, testConfig } from './fakes';

let app: INestApplication; let invoker: FakeInvoker;
beforeAll(async () => { invoker = new FakeInvoker(() => ({})); app = await createEsbApp(testConfig(), { invoker, logger: new MemoryLogger(), probe: new FakeProbe() }); });
afterAll(async () => { await app?.close(); });

const post = (operation: string, role?: string) => {
  let call = request(app.getHttpServer()).post(`/internal/v1/operations/${operation}`).set('x-internal-key', KEY).set('x-owner-id', 'user-1');
  if (role) call = call.set('x-role', role);
  return call.send({ input: {} });
};

/** Una operación representativa por tipo protegido (admin de inventario, tarifas, operaciones; system de tareas y de reservas). */
const ADMIN = ['vuelos.guardar-instancia', 'vuelos.cerrar-instancia', 'vuelos.guardar-tarifa', 'vuelos.listar-tarifas', 'vuelos.registrar-novedad-operativa', 'vuelos.contar-check-ins'];
const SYSTEM = ['reservas.listar-por-vuelo', 'sistema.expirar-holds', 'sistema.reanudar-pendientes', 'sistema.despachar-webhooks', 'sistema.recuperar-check-ins'];

describe('ESB-ROLE: verificación de rol en operaciones administrativas y de sistema (ADR-F12b-09)', () => {
  it('ESB-ROLE-01: el catálogo declara exactamente los roles de las operaciones protegidas', () => {
    const protectedOps = OPERATIONS.filter((operation) => operation.kind === 'rpc' && operation.roles).map((operation) => operation.name).sort();
    expect(protectedOps).toEqual([...ADMIN, ...SYSTEM].sort());
  });

  it.each(ADMIN)('ESB-ROLE-02: %s rechaza customer y la ausencia de rol con PERMISSION_DENIED sin llamar al microservicio', async (operation) => {
    invoker.calls.length = 0;
    for (const role of ['customer', 'system', 'ADMIN', undefined]) {
      const response = await post(operation, role);
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ ok: false, error: { source: 'service', grpcCode: 7, grpcStatus: 'PERMISSION_DENIED', catalogCode: 'PERMISSION_DENIED' } });
    }
    expect(invoker.calls).toHaveLength(0);
  });

  it.each(SYSTEM)('ESB-ROLE-03: %s rechaza customer, admin y la ausencia de rol con PERMISSION_DENIED sin llamar al microservicio', async (operation) => {
    invoker.calls.length = 0;
    for (const role of ['customer', 'admin', undefined]) {
      const response = await post(operation, role);
      expect(response.status).toBe(403);
      expect(response.body.error).toMatchObject({ grpcCode: 7, catalogCode: 'PERMISSION_DENIED' });
    }
    expect(invoker.calls).toHaveLength(0);
  });

  it.each([...ADMIN.map((operation) => [operation, 'admin']), ...SYSTEM.map((operation) => [operation, 'system'])])('ESB-ROLE-04: %s con el rol suficiente llega al microservicio', async (operation, role) => {
    invoker.calls.length = 0;
    const response = await post(operation, role);
    expect(response.status).toBe(200);
    expect(invoker.calls).toHaveLength(1);
    expect(invoker.calls[0].context).toMatchObject({ role, ownerId: 'user-1' });
  });

  it('ESB-ROLE-05: las operaciones de usuario no exigen rol en el ESB (el filtro por dueño sigue en el servicio)', async () => {
    invoker.calls.length = 0;
    expect((await post('reservas.obtener', 'customer')).status).toBe(200);
    expect((await post('vuelos.buscar-ofertas')).status).toBe(200);
    expect(invoker.calls).toHaveLength(2);
  });

  it('ESB-ROLE-06: sin llave interna no hay verificación de rol: 401 antes de cualquier mediación', async () => {
    invoker.calls.length = 0;
    const response = await request(app.getHttpServer()).post('/internal/v1/operations/sistema.expirar-holds').set('x-role', 'system').send({ input: {} });
    expect(response.status).toBe(401);
    expect(invoker.calls).toHaveLength(0);
  });
});
