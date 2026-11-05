import { describe, expect, it } from '@jest/globals';
import { resolveDeadlineMs } from '../../src/domain/deadline';
import { errorFromThrown, GRPC, httpStatusFor, operationError } from '../../src/domain/errors';
import { loadConfig } from '../../src/config';

const policy = { defaultMs: 5_000, orchestratedMs: 30_000, maxMs: 30_000 };

describe('ESB-DL: plazos', () => {
  it('ESB-DL-01: sin plazo pedido usa 5 s, o 30 s si la operación es orquestada', () => {
    expect(resolveDeadlineMs(undefined, false, policy)).toBe(5_000);
    expect(resolveDeadlineMs(undefined, true, policy)).toBe(30_000);
  });
  it('ESB-DL-02: respeta el plazo pedido y lo acota al máximo', () => {
    expect(resolveDeadlineMs(1_500, false, policy)).toBe(1_500);
    expect(resolveDeadlineMs(120_000, true, policy)).toBe(30_000);
  });
  it('ESB-DL-03: ignora valores no positivos o no finitos', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(resolveDeadlineMs(bad, false, policy)).toBe(5_000);
  });
});

describe('ESB-ER: errores', () => {
  it('ESB-ER-01: un error de servicio conserva el código gRPC y el código del catálogo, sin mensajes', () => {
    const error = errorFromThrown(Object.assign(new Error('secret internals'), { code: 9, details: 'SEAT_TAKEN' }));
    expect(error).toEqual({ source: 'service', grpcCode: 9, grpcStatus: 'FAILED_PRECONDITION', catalogCode: 'SEAT_TAKEN' });
    expect(JSON.stringify(error)).not.toContain('secret');
  });
  it('ESB-ER-02: details que no son un código del catálogo no se reenvían', () => {
    for (const details of ['could not connect to db at 10.0.0.1', 'lower_case', '', undefined, 42]) expect(errorFromThrown({ code: 13, details }).catalogCode).toBeNull();
  });
  it('ESB-ER-03: lo que no es un error gRPC es INTERNAL del ESB', () => {
    expect(errorFromThrown(new Error('boom'))).toMatchObject({ source: 'esb', grpcCode: GRPC.INTERNAL, catalogCode: null });
    expect(errorFromThrown(null)).toMatchObject({ source: 'esb', grpcCode: GRPC.INTERNAL });
  });
  it('ESB-ER-04: el paso fallido se informa cuando se conoce', () => {
    expect(errorFromThrown({ code: 5, details: 'NOT_FOUND' }, 'resolveSegment').step).toBe('resolveSegment');
  });
  it('ESB-ER-05: estado HTTP del sobre según origen y código', () => {
    expect(httpStatusFor(operationError('service', GRPC.UNAVAILABLE))).toBe(503);
    expect(httpStatusFor(operationError('service', GRPC.DEADLINE_EXCEEDED))).toBe(504);
    expect(httpStatusFor(operationError('service', GRPC.NOT_FOUND))).toBe(404);
    expect(httpStatusFor(operationError('service', GRPC.PERMISSION_DENIED))).toBe(403);
    expect(httpStatusFor(operationError('service', GRPC.UNAUTHENTICATED))).toBe(401);
    expect(httpStatusFor(operationError('service', 9, 'SEAT_TAKEN'))).toBe(422);
    expect(httpStatusFor(operationError('esb', GRPC.UNAUTHENTICATED))).toBe(401);
    expect(httpStatusFor(operationError('esb', GRPC.UNIMPLEMENTED))).toBe(404);
    expect(httpStatusFor(operationError('esb', GRPC.INVALID_ARGUMENT))).toBe(400);
    expect(httpStatusFor(operationError('esb', GRPC.INTERNAL))).toBe(500);
  });
});

describe('ESB-CF: configuración', () => {
  it('ESB-CF-01: falla rápido sin la llave interna', () => {
    expect(() => loadConfig({})).toThrow('INTERNAL_API_KEY is required');
  });
  it('ESB-CF-02: valores por defecto de PLAN §1.2 y URL de cada servicio', () => {
    const config = loadConfig({ INTERNAL_API_KEY: 'k' });
    expect(config).toMatchObject({ port: 8080, bindHost: '0.0.0.0', grpcTls: false, maxBodyBytes: 1_048_576, deadlines: { defaultMs: 5_000, orchestratedMs: 30_000, maxMs: 30_000 } });
    expect(config.grpcUrls.pricing).toBe('localhost:50052');
  });
  it('ESB-CF-03: variables de entorno sustituyen los valores y los inválidos fallan', () => {
    const config = loadConfig({ INTERNAL_API_KEY: 'k', PORT: '3100', PRICING_GRPC_URL: 'pricing.internal:443', GRPC_TLS: 'true', ESB_DEFAULT_DEADLINE_MS: '2000', INTEGRATION_LOCAL: 'true' });
    expect(config).toMatchObject({ port: 3100, grpcTls: true, bindHost: '127.0.0.1', deadlines: { defaultMs: 2_000 } });
    expect(config.grpcUrls.pricing).toBe('pricing.internal:443');
    expect(() => loadConfig({ INTERNAL_API_KEY: 'k', PORT: 'abc' })).toThrow('PORT must be a positive integer');
  });
  it('ESB-CF-04: el perfil de integración local se rechaza en producción', () => {
    expect(() => loadConfig({ INTERNAL_API_KEY: 'k', INTEGRATION_LOCAL: 'true', NODE_ENV: 'production' })).toThrow('forbidden in production');
  });
});
