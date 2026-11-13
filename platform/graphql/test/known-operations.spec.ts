import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from '@jest/globals';
import { canonicalText, knownOperations, operationsPath } from '@flight-platform/graphql-schema';
import { Kind, parse } from 'graphql';
import request from 'supertest';
import { cleanupKeys, FakeGateway, makeApp, operationText } from './helpers';

afterAll(cleanupKeys);
const PROD = { NODE_ENV: 'production', GATEWAY_BASE_URL: 'https://gateway.example', JWT_ISSUERS: JSON.stringify([{ iss: 'x', aud: 'y', jwksUri: 'https://auth.example/jwks' }]) };
const post = (app: ReturnType<typeof makeApp>['app'], body: object) => request(app).post('/graphql').set('Content-Type', 'application/json').send(body);
const FREE = { query: 'query Libre { flightStatus(flightNumber: "FP103", date: "2026-12-01") { flightNumber status } }' };
const INTROSPECTION = { query: '{ __schema { queryType { name } types { name } } }' };
const names = parse(readFileSync(operationsPath, 'utf8')).definitions.filter((definition) => definition.kind === Kind.OPERATION_DEFINITION).map((definition) => definition.kind === Kind.OPERATION_DEFINITION ? definition.name?.value : undefined);

describe('GQL-KNOWN: lista de operaciones permitidas (Q6)', () => {
  it('GQL-KNOWN-01 packages/graphql-schema genera la lista a partir de las 28 operaciones de operations.graphql, una por documento y con nombre', () => {
    const known = knownOperations(); expect(names).toHaveLength(28); expect(new Set(names).size).toBe(28); expect([...known.keys()].sort()).toEqual([...names].sort());
    for (const [name, text] of known) { const document = parse(text); expect(document.definitions.filter((definition) => definition.kind === Kind.OPERATION_DEFINITION)).toHaveLength(1); expect(canonicalText(document)).toBe(text); expect({ name, ok: text.includes(`${name}`) }).toEqual({ name, ok: true }); }
  });
  it('GQL-KNOWN-02 producción: las 28 operaciones publicadas se aceptan (ninguna recibe 403 de operación no permitida)', async () => {
    const { app } = makeApp(PROD, new FakeGateway());
    for (const name of names) { const reply = await post(app, { query: operationText(name as string), operationName: name, variables: {} }); expect({ name, notAllowed: reply.status === 403 && reply.body.errors?.[0]?.extensions?.code === 'GRAPHQL_OPERATION_NOT_ALLOWED' }).toEqual({ name, notAllowed: false }); }
  });
  it('GQL-KNOWN-03 producción: una operación que NO está en la lista se rechaza con 403 (nueva, con otro nombre, modificada o anónima) y no llama al Gateway', async () => {
    const gateway = new FakeGateway(); const { app } = makeApp(PROD, gateway);
    const rejected = [FREE, { query: 'query PlatformHealth { platformHealth { status } }', operationName: 'PlatformHealth' }, { query: operationText('PlatformHealth').replace('nodeId', 'nodeId\n    nodeId'), operationName: 'PlatformHealth' }, { query: '{ platformHealth { status } }' }, { query: `mutation Nueva { releaseHold(holdId: "11111111-1111-4111-8111-111111111111") }` }];
    for (const body of rejected) { const reply = await post(app, body); expect({ query: body.query.slice(0, 40), status: reply.status, code: reply.body.errors?.[0]?.extensions?.code }).toEqual({ query: body.query.slice(0, 40), status: 403, code: 'GRAPHQL_OPERATION_NOT_ALLOWED' }); }
    expect(gateway.calls).toHaveLength(0);
  });
  it('GQL-KNOWN-04 producción: la introspección se rechaza (por no estar en la lista y, además, está desactivada en la configuración)', async () => {
    const { app, config } = makeApp(PROD); expect(config.introspection).toBe(false);
    for (const body of [INTROSPECTION, { query: '{ __type(name: "Query") { name } }' }, { query: 'query IntrospectionQuery { __schema { types { name } } }', operationName: 'IntrospectionQuery' }]) { const reply = await post(app, body); expect(reply.status).toBe(403); expect(JSON.stringify(reply.body)).not.toContain('"types"'); expect(reply.body.data).toBeUndefined(); }
  });
  it('GQL-KNOWN-05 producción: aunque alguien relajara solo la lista, la introspección seguiría apagada (regla de validación propia)', async () => {
    const { app } = makeApp({ ...PROD }); const { createApp } = await import('../src/infrastructure/app'); const { buildServiceSchema } = await import('../src/infrastructure/schema'); const { JoseTokenVerifier } = await import('../src/infrastructure/jwt-verifier'); const { loadConfig } = await import('../src/config'); const { MemoryLog } = await import('./helpers'); void app;
    const config = { ...loadConfig(PROD), knownOperationsOnly: false }; const open = createApp({ config, schema: buildServiceSchema(), gateway: new FakeGateway(), verifier: new JoseTokenVerifier(config.jwtIssuers), known: knownOperations(), log: new MemoryLog() });
    const reply = await post(open, INTROSPECTION); expect(reply.status).toBe(400); expect(reply.body.data).toBeUndefined();
    expect((await post(open, FREE)).status).toBe(200); // sin lista, una consulta válida corre; la introspección sigue bloqueada
  });
  it.each([['test', 'CI/pruebas'], ['development', 'local']])('GQL-KNOWN-06 NODE_ENV=%s (%s): las consultas siguen LIBRES y la introspección está activa', async (nodeEnv) => {
    const gateway = new FakeGateway(() => ({ status: 200, body: { flightNumber: 'FP103', date: '2026-12-01', marketingCarrier: 'FP', operatingCarrier: 'FP', status: 'SCHEDULED', departure: { iataCode: 'UIO', scheduledAt: '2026-12-01T10:00:00-05:00' }, arrival: { iataCode: 'GYE', scheduledAt: '2026-12-01T11:00:00-05:00' } } })); const { app, config } = makeApp({ NODE_ENV: nodeEnv }, gateway);
    expect(config).toMatchObject({ knownOperationsOnly: false, introspection: true });
    const free = await post(app, FREE); expect(free.status).toBe(200); expect(free.body.data).toEqual({ flightStatus: { flightNumber: 'FP103', status: 'SCHEDULED' } });
    const intro = await post(app, INTROSPECTION); expect(intro.status).toBe(200); expect(intro.body.data.__schema.queryType.name).toBe('Query');
  });
});
