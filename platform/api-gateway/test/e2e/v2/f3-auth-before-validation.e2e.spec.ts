import request from 'supertest';
import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { loadV2Spec } from '../../../src/v2/http';
import { expectSchema, fetchToken, registerClient, startTestGateway, type TestGateway } from './support';

const spec = loadV2Spec();
const routes = Object.entries(spec.paths).flatMap(([path, operations]) => Object.entries(operations)
  .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
  .filter(([, operation]) => (operation.security ?? spec.security ?? []).length > 0)
  .map(([method]) => ({ method, path, url: `/api/v2${path.replace(/\{[^}]+\}/g, 'invalid-id')}?limit=invalid` })));

describe('F3 / S: autenticación previa al validador OpenAPI v2', () => {
  let gateway: TestGateway; let noScopeToken: string;
  beforeAll(async () => {
    gateway = await startTestGateway();
    noScopeToken = await fetchToken(gateway.server, await registerClient(gateway.store, []));
  }, 60_000);
  afterAll(async () => { await gateway?.close(); });

  routes.forEach(({ method, path, url }, index) => {
    it(`F3-${String(index + 1).padStart(2, '0')} / S: ${method.toUpperCase()} ${path} sin token e input inválido responde 401`, async () => {
      const response = await request(gateway.server)[method as 'get'](url).send(['post', 'put', 'patch'].includes(method) ? {} : undefined);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHORIZED');
      expectSchema('ProblemDetails', response.body);
    });
    it(`F3-${String(index + 1).padStart(2, '0')}b / S: ${method.toUpperCase()} ${path} sin scope e input inválido responde 403`, async () => {
      const response = await request(gateway.server)[method as 'get'](url).set('Authorization', `Bearer ${noScopeToken}`).send(['post', 'put', 'patch'].includes(method) ? {} : undefined);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
      expectSchema('ProblemDetails', response.body);
    });
  });

  it('F3-PUB-01 / K: search pública sigue validando su cuerpo sin token', async () => {
    const response = await request(gateway.server).post('/api/v2/vuelos/search').send({});
    expect(response.status).toBe(400);
    expectSchema('ProblemDetails', response.body);
  });
  for (const [id, header, value] of [['CORR', 'X-Correlation-Id', 'x'.repeat(101)], ['USER', 'X-User-Id', 'id con espacios']] as const) {
    it(`F3-${id}-01 / S: ${header} inválido sin token responde 401`, async () => {
      const response = await request(gateway.server).get('/api/v2/vuelos/bookings').set(header, value);
      expect(response.status).toBe(401); expectSchema('ProblemDetails', response.body);
    });
    it(`F3-${id}-02 / S: ${header} inválido sin scope responde 403`, async () => {
      const response = await request(gateway.server).get('/api/v2/vuelos/bookings').set(header, value).set('Authorization', `Bearer ${noScopeToken}`);
      expect(response.status).toBe(403); expectSchema('ProblemDetails', response.body);
    });
  }
});
