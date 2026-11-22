import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';
import { invalidParamsToMetadata } from '@flight-platform/shared';
import { createEsbApp } from '../../src/app';
import { errorFromThrown } from '../../src/domain/errors';
import { GrpcServiceInvoker } from '../../src/infrastructure/grpc/grpc-invoker';
import { FakeInvoker, FakeProbe, KEY, MemoryLogger, grpcError, testConfig } from './fakes';

/** ADR-F12b1fix-05, punto 12: el ESB conserva la lista de campos inválidos de un VALIDATION_FAILED en su sobre de error. Nunca valores. */
const params = [{ name: 'passengers.0.firstName', reason: 'INVALID_FORMAT' }, { name: 'passengers.1.birthDate', reason: 'AGE_NOT_ALLOWED_FOR_TYPE' }];

describe('ESB-INV: errorFromThrown', () => {
  it('ESB-INV-01 VALIDATION_FAILED con invalidParams los conserva en el error del sobre (source service, mismo código gRPC)', () => {
    expect(errorFromThrown(Object.assign(grpcError(3, 'VALIDATION_FAILED'), { invalidParams: params }), 'createReservation')).toEqual({
      source: 'service', grpcCode: 3, grpcStatus: 'INVALID_ARGUMENT', catalogCode: 'VALIDATION_FAILED', step: 'createReservation', invalidParams: params
    });
  });
  it('ESB-INV-02 sin lista el sobre es exactamente el de antes (sin la clave invalidParams)', () => {
    expect(errorFromThrown(grpcError(3, 'VALIDATION_FAILED'))).toEqual({ source: 'service', grpcCode: 3, grpcStatus: 'INVALID_ARGUMENT', catalogCode: 'VALIDATION_FAILED' });
  });
  it('ESB-INV-03 la lista solo viaja con VALIDATION_FAILED y se vuelve a filtrar: nombres ajenos, motivos libres o valores no pasan', () => {
    expect(errorFromThrown(Object.assign(grpcError(9, 'BAGGAGE_LIMIT_EXCEEDED'), { invalidParams: params })).invalidParams).toBeUndefined();
    const dirty = [{ name: 'passengers.0.firstName', reason: 'Juan Pérez no es válido' }, { name: 'passengers.0.documentNumber', reason: 'REQUIRED', value: 'SECRETO' }, { name: 'holdId', reason: 'REQUIRED' }];
    const error = errorFromThrown(Object.assign(grpcError(3, 'VALIDATION_FAILED'), { invalidParams: dirty }));
    expect(error.invalidParams).toEqual([{ name: 'passengers.0.documentNumber', reason: 'REQUIRED' }]);
    expect(JSON.stringify(error)).not.toContain('SECRETO');
  });
});

describe('ESB-INV: el invocador gRPC lee la metadata final del error del cliente', () => {
  it('ESB-INV-04 la lista de la metadata pasa a la propiedad invalidParams del error lanzado', async () => {
    const invoker = new GrpcServiceInvoker(testConfig());
    const failing = Object.assign(new Error('boom'), { code: 3, details: 'VALIDATION_FAILED', metadata: invalidParamsToMetadata(params as never) });
    (invoker as unknown as { clients: Map<string, unknown> }).clients.set('reservation', { client: { close: () => undefined }, service: { createReservation: () => ({ subscribe: (observer: { error(e: unknown): void }) => { observer.error(failing); return { unsubscribe: () => undefined }; } }) } });
    const thrown = await invoker.invoke('reservation', 'createReservation', {}, { correlationId: 'c' }, new Date(Date.now() + 1_000)).catch((error: unknown) => error);
    expect(errorFromThrown(thrown)).toMatchObject({ catalogCode: 'VALIDATION_FAILED', invalidParams: params });
    // Un error sin metadata sigue pasando tal cual.
    const plain = Object.assign(new Error('x'), { code: 14, metadata: new Metadata() });
    (invoker as unknown as { clients: Map<string, unknown> }).clients.set('reservation', { client: { close: () => undefined }, service: { createReservation: () => ({ subscribe: (observer: { error(e: unknown): void }) => { observer.error(plain); return { unsubscribe: () => undefined }; } }) } });
    expect(await invoker.invoke('reservation', 'createReservation', {}, { correlationId: 'c' }, new Date(Date.now() + 1_000)).catch((error: unknown) => error)).toBe(plain);
    await invoker.close();
  });
});

describe('ESB-INV: el sobre HTTP que recibe el Gateway', () => {
  let app: INestApplication; let behavior: () => unknown = () => ({});
  beforeAll(async () => { app = await createEsbApp(testConfig(), { invoker: new FakeInvoker(() => behavior()), logger: new MemoryLogger(), probe: new FakeProbe() }); });
  afterAll(async () => { await app?.close(); });
  it('ESB-INV-05 reservas.crear rechazada con campos: 422 con {ok:false, error:{…, invalidParams}}; sin mensajes internos ni valores', async () => {
    behavior = () => Object.assign(grpcError(3, 'VALIDATION_FAILED'), { invalidParams: params });
    const response = await request(app.getHttpServer()).post('/internal/v1/operations/reservas.crear').set('x-internal-key', KEY).send({ input: {} });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ ok: false, error: { source: 'service', grpcCode: 3, catalogCode: 'VALIDATION_FAILED', invalidParams: params } });
    expect(JSON.stringify(response.body)).not.toContain('internal detail');
  });
});
