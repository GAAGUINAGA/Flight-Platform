import { describe, expect, it } from '@jest/globals';
import { knownOperations, readSchemaSdl } from '@flight-platform/graphql-schema';
import { buildSchema, getNamedType, isObjectType, parse, validate, type GraphQLNamedType } from 'graphql';
import { loadConfig } from '../src/config';
import { operationCost, operationDepth } from '../src/infrastructure/security';
import { buildServiceSchema } from '../src/infrastructure/schema';
import { baseEnv } from './helpers';

describe('GQL-CON: contrato del esquema (el SDL es la única fuente)', () => {
  it('GQL-CON-01 el SDL compila y el esquema ejecutable tiene un resolutor por cada consulta y mutación (sin faltantes)', () => {
    expect(() => buildSchema(readSchemaSdl())).not.toThrow(); expect(() => buildServiceSchema()).not.toThrow();
  });
  it('GQL-CON-02 toda operación publicada valida contra el SDL y tiene nombre', () => {
    const schema = buildServiceSchema(); const known = knownOperations(); expect(known.size).toBe(28);
    for (const [name, text] of known) { const errors = validate(schema, parse(text)); expect({ name, errors: errors.map((error) => error.message) }).toEqual({ name, errors: [] }); }
  });
  it('GQL-CON-03 cada consulta y mutación del SDL tiene su operación publicada (y ninguna operación apunta a algo inexistente)', () => {
    const schema = buildServiceSchema(); const fields = [...Object.keys(schema.getQueryType()!.getFields()), ...Object.keys(schema.getMutationType()!.getFields())];
    const used = new Set<string>(); for (const text of knownOperations().values()) for (const definition of parse(text).definitions) if (definition.kind === 'OperationDefinition') for (const selection of definition.selectionSet.selections) if (selection.kind === 'Field') used.add(selection.name.value);
    expect(fields.filter((field) => !used.has(field))).toEqual([]);
  });
  it('GQL-CON-04 toda operación publicada cabe en los límites por omisión de profundidad y complejidad', () => {
    const schema = buildServiceSchema(); const config = loadConfig(baseEnv);
    for (const [name, text] of knownOperations()) { const document = parse(text); expect({ name, ok: operationDepth(document) <= config.maxDepth }).toEqual({ name, ok: true }); expect({ name, ok: operationCost(schema, document) <= config.maxComplexity }).toEqual({ name, ok: true }); }
  });
  it('GQL-CON-05 ningún tipo de salida expone campos sensibles (documentNumber completo, paymentReference, canal, email, teléfono del pasajero; el holdId solo existe en Hold, no en Booking)', () => {
    const schema = buildServiceSchema(); const forbidden = ['documentNumber', 'paymentReference', 'paymentChannel', 'provider', 'salesChannel', 'ownerId', 'email', 'phone', 'secret'];
    const outputs = Object.values(schema.getTypeMap()).filter((type: GraphQLNamedType) => isObjectType(type) && !type.name.startsWith('__'));
    for (const type of outputs) if (isObjectType(type)) for (const [name, field] of Object.entries(type.getFields())) { expect({ type: type.name, field: name, bad: forbidden.includes(name) }).toEqual({ type: type.name, field: name, bad: false }); void getNamedType(field.type); }
    const booking = schema.getType('Booking'); if (isObjectType(booking)) expect(Object.keys(booking.getFields())).not.toContain('holdId');
  });
  it('GQL-CON-06 las operaciones de escritura del cliente que crean algo exigen idempotencyKey y no hay suscripciones', () => {
    const schema = buildServiceSchema(); const mutations = schema.getMutationType()!.getFields(); expect(schema.getSubscriptionType()).toBeUndefined();
    for (const name of ['holdOffer', 'createBooking', 'addBaggage', 'confirmDateChange', 'cancelBooking', 'changeSeats', 'setPromotionAgreement']) expect(mutations[name].args.some((arg) => arg.name === 'idempotencyKey' && String(arg.type).endsWith('!'))).toBe(true);
  });
  it('GQL-CON-07 el SDL no declara en la entrada ningún campo de canal, proveedor ni usuario (los fija el Gateway)', () => {
    const sdl = readSchemaSdl(); expect(sdl).not.toMatch(/paymentChannel|\bprovider\b|X-User-Id|salesChannel/);
  });
});

describe('GQL-CFG: configuración', () => {
  const prod = { NODE_ENV: 'production', GATEWAY_BASE_URL: 'https://gateway.example', JWT_ISSUERS: JSON.stringify([{ iss: 'x', aud: 'y', jwksUri: 'https://auth.example/jwks' }]), CORS_ORIGINS: 'https://web.example' };
  it('GQL-CFG-01 producción: introspección off y operaciones conocidas on por omisión; no se pueden relajar', () => {
    const config = loadConfig(prod); expect(config).toMatchObject({ production: true, introspection: false, knownOperationsOnly: true });
    expect(() => loadConfig({ ...prod, INTROSPECTION: 'true' })).toThrow(); expect(() => loadConfig({ ...prod, KNOWN_OPERATIONS_ONLY: 'false' })).toThrow();
  });
  it('GQL-CFG-02 falla al arrancar con valores inseguros: sin Gateway, Gateway http, emisor sin jwksUri, comodín o http en CORS, límites inválidos', () => {
    expect(() => loadConfig({ ...prod, GATEWAY_BASE_URL: '' })).toThrow(); expect(() => loadConfig({ ...prod, GATEWAY_BASE_URL: 'http://gateway.example' })).toThrow();
    expect(() => loadConfig({ ...prod, JWT_ISSUERS: JSON.stringify([{ iss: 'x', aud: 'y', publicKeyFile: 'k.pem' }]) })).toThrow(); expect(() => loadConfig({ ...prod, JWT_ISSUERS: '[]' })).toThrow();
    expect(() => loadConfig({ ...prod, CORS_ORIGINS: '*' })).toThrow(); expect(() => loadConfig({ ...prod, CORS_ORIGINS: 'http://localhost:5173' })).toThrow(); expect(() => loadConfig({ ...prod, MAX_QUERY_DEPTH: '0' })).toThrow();
  });
  it('GQL-CFG-03 fuera de producción: introspección activa y localhost permitido', () => {
    expect(loadConfig({ ...baseEnv, CORS_ORIGINS: 'http://localhost:5173' })).toMatchObject({ production: false, introspection: true, knownOperationsOnly: false, corsOrigins: ['http://localhost:5173'] });
  });
});
