import { describe, expect, it } from '@jest/globals';
import { loadConfig } from './config';

const base = { INTERNAL_API_KEY: 'x'.repeat(32), JWT_ISSUERS: JSON.stringify([{ iss: 'https://project.supabase.co/auth/v1', aud: 'authenticated', jwksUri: 'https://project.supabase.co/auth/v1/.well-known/jwks.json' }]) };

describe('PLT-J2: configuración final del Gateway', () => {
  it.each([
    ['producción sin variable', { NODE_ENV: 'production' }, false],
    ['producción con VALIDATE_RESPONSES=false', { NODE_ENV: 'production', VALIDATE_RESPONSES: 'false' }, false],
    ['producción con un valor que no es "true"', { NODE_ENV: 'production', VALIDATE_RESPONSES: '1' }, false],
    ['entorno de pruebas (NODE_ENV=test)', { NODE_ENV: 'test' }, true],
    ['desarrollo', { NODE_ENV: 'development' }, true],
    ['entorno de pruebas desplegado con VALIDATE_RESPONSES=true', { NODE_ENV: 'production', VALIDATE_RESPONSES: 'true' }, true],
    ['sin NODE_ENV ni variable', {}, false]
  ])('J2-01: %s ⇒ validateResponses=%s', (_name, env, expected) => {
    expect(loadConfig({ ...base, ...env }).validateResponses).toBe(expected);
  });
  it('J2-02: el scheduler solo se activa con SCHEDULER_ENABLED=true y sus intervalos por defecto son los del ADR-F11-11', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).schedulerEnabled).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'production', SCHEDULER_ENABLED: 'true' })).toMatchObject({ schedulerEnabled: true, schedulerEveryMs: 60_000, schedulerPurgeEveryMs: 3_600_000, schedulerBatchSize: 50, schedulerLockLeaseMs: 55_000 });
  });
  it('J2-03: los límites, la idempotencia y CORS toman los valores del plan y se pueden sobrescribir', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' })).toMatchObject({ publicLimit: 60, authLimit: 120, idempotencyTtlHours: 24, corsOrigins: [], grpcTls: false });
    expect(loadConfig({ ...base, NODE_ENV: 'production', RATE_LIMIT_PUBLIC_PER_MIN: '30', RATE_LIMIT_AUTH_PER_MIN: '90', CORS_ORIGINS: 'https://a.test, https://b.test', GRPC_TLS: 'true' })).toMatchObject({ publicLimit: 30, authLimit: 90, corsOrigins: ['https://a.test', 'https://b.test'], grpcTls: true });
  });
});
