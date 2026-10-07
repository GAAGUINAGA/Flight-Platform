import { makeGenericClientConstructor, Server, ServerCredentials, status, credentials } from '@grpc/grpc-js';
import { service as healthService } from 'grpc-health-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lastValueFrom, of } from 'rxjs';
import pino from 'pino';
import { RpcException } from '@nestjs/microservices';
import {
  decimalToMinor, ERROR_CODES, FixedClock, GRPC_STATUS_BY_CODE, minorToDecimal,
  buildRequestContext, createGrpcMetadata, requireRole, safeGrpcError, toRpcException, validate,
  InternalKeyInterceptor, requestContextFromMetadata, loggerOptions, DomainRpcExceptionFilter, DomainError,
  GRPC_DEADLINE_MS, withGrpcCallContext, addGrpcHealthCheck, rpcString
} from '../src/index';
import { z } from 'zod';

describe('shared foundations', () => {
  it('maps every public error code', () => {
    const contract = readFileSync(join('contracts', 'openapi', 'vuelos-openapi.yaml'), 'utf8');
    const codes = contract.match(/ {8}code:\r?\n {10}type: string\r?\n {10}enum:\r?\n((?: {10}- [A-Z_]+\r?\n)+)/)?.[1]
      .match(/ {10}- ([A-Z_]+)/g)?.map(line => line.trim().slice(2));
    expect(codes).toHaveLength(24);
    const internalCodes = ['NOT_FOUND'];
    const expected = [...codes!, ...internalCodes].sort();
    expect([...ERROR_CODES].sort()).toEqual(expected);
    expect(Object.keys(GRPC_STATUS_BY_CODE).sort()).toEqual(expected);
    expect(codes).not.toContain('NOT_FOUND');
  });

  it('maps internal NOT_FOUND to gRPC NOT_FOUND and preserves it across the RPC boundary', () => {
    expect(GRPC_STATUS_BY_CODE.NOT_FOUND).toBe(status.NOT_FOUND);
    expect(safeGrpcError(new DomainError('NOT_FOUND'))).toEqual({ code: status.NOT_FOUND, details: 'NOT_FOUND' });
    expect(safeGrpcError(new RpcException({ code: status.NOT_FOUND, details: 'NOT_FOUND' })))
      .toEqual({ code: status.NOT_FOUND, details: 'NOT_FOUND' });
  });

  it('hides unexpected failures behind generic INTERNAL', () => {
    expect(toRpcException(new Error('database password leaked')).getError()).toEqual(
      expect.objectContaining({ code: status.INTERNAL, details: 'INTERNAL_ERROR' })
    );
  });

  it('converts unhandled RPC failures without exposing their text', async () => {
    await expect(lastValueFrom(new DomainRpcExceptionFilter().catch(new Error('private database detail'))))
      .rejects.toMatchObject({ error: { code: status.INTERNAL, details: 'INTERNAL_ERROR' } });
    await expect(lastValueFrom(new DomainRpcExceptionFilter().catch(new RpcException('private database detail'))))
      .rejects.toMatchObject({ error: { code: status.INTERNAL, details: 'INTERNAL_ERROR' } });
  });

  it('preserves only safe RPC payloads without relying on instanceof', async () => {
    class ForeignRpcError {
      constructor(private readonly payload: object) {}
      getError() { return this.payload; }
    }
    const unauthenticated = new ForeignRpcError({ code: status.UNAUTHENTICATED, details: 'UNAUTHENTICATED' });
    expect(unauthenticated).not.toBeInstanceOf(RpcException);
    expect(safeGrpcError(unauthenticated)).toEqual({ code: status.UNAUTHENTICATED, details: 'UNAUTHENTICATED' });
    await expect(lastValueFrom(new DomainRpcExceptionFilter().catch(unauthenticated)))
      .rejects.toMatchObject({ error: { code: status.UNAUTHENTICATED, details: 'UNAUTHENTICATED' } });
    expect(safeGrpcError(new ForeignRpcError({ code: status.UNAUTHENTICATED, details: 'database secret' })))
      .toEqual({ code: status.INTERNAL, details: 'INTERNAL_ERROR' });
    expect(safeGrpcError({ getError: () => { throw new Error('private detail'); } }))
      .toEqual({ code: status.INTERNAL, details: 'INTERNAL_ERROR' });
  });

  it('converts money and supports a fixed clock', () => {
    expect(minorToDecimal(12345)).toBe('123.45');
    expect(decimalToMinor('-0.01')).toBe(-1);
    expect(new FixedClock(new Date('2026-01-01T00:00:00Z')).now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('requires a valid internal key and role, validates strict input and propagates metadata', () => {
    const metadata = { get: (key: string) => ({
      'x-internal-key': ['test-key'], 'x-owner-id': ['owner'], 'x-role': ['admin'], 'x-correlation-id': ['corr']
    }[key] ?? []) };
    const context = buildRequestContext(metadata, 'test-key');
    expect(context).toEqual({ ownerId: 'owner', role: 'admin', correlationId: 'corr' });
    expect(() => buildRequestContext({ get: () => [] }, 'test-key')).toThrow();
    expect(() => requireRole({ ...context, role: 'customer' }, 'admin')).toThrow();
    try { requireRole({ ...context, role: 'customer' }, 'admin'); } catch (error) {
      expect((error as { getError(): object }).getError()).toMatchObject({ code: status.PERMISSION_DENIED });
    }
    expect(validate(z.object({ value: rpcString(5) }), { value: ' hi ' })).toEqual({ value: 'hi' });
    expect(() => validate(z.object({ value: rpcString(5) }), { value: '123456' })).toThrow();
    expect(() => validate(z.object({ value: rpcString() }), { value: 'x', extra: true })).toThrow();
    try { validate(z.object({ value: rpcString() }), { value: 'x', extra: true }); } catch (error) {
      expect((error as { getError(): object }).getError()).toMatchObject({ code: status.INVALID_ARGUMENT });
    }
    const outgoing = createGrpcMetadata({ url: 'localhost', grpcTls: false, internalApiKey: 'test-key', correlationId: 'corr', ownerId: 'owner', role: 'admin' });
    expect(outgoing.get('x-owner-id')).toEqual(['owner']);
    expect(outgoing.get('x-role')).toEqual(['admin']);
  });

  it('adds metadata and a five-second deadline to outgoing RPCs', () => {
    const call = jest.fn();
    const client = withGrpcCallContext({ call }, {
      url: 'localhost:5000', grpcTls: false, internalApiKey: 'key', correlationId: 'corr', ownerId: 'owner', role: 'admin'
    });
    const before = Date.now();
    client.call({ id: 'one' });
    const [, metadata, callOptions] = call.mock.calls[0];
    expect(metadata.get('x-internal-key')).toEqual(['key']);
    expect(metadata.get('x-correlation-id')).toEqual(['corr']);
    expect(metadata.get('x-owner-id')).toEqual(['owner']);
    expect(metadata.get('x-role')).toEqual(['admin']);
    expect(callOptions.deadline.getTime()).toBeGreaterThanOrEqual(before + GRPC_DEADLINE_MS);
    expect(callOptions.deadline.getTime()).toBeLessThanOrEqual(Date.now() + GRPC_DEADLINE_MS);
  });

  it('serves the standard gRPC health Check RPC', async () => {
    const server = new Server();
    addGrpcHealthCheck(server);
    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, boundPort) =>
        error ? reject(error) : resolve(boundPort));
    });
    const HealthClient = makeGenericClientConstructor(healthService, 'Health');
    const client = new HealthClient(`127.0.0.1:${port}`, credentials.createInsecure());
    try {
      const response = await new Promise<unknown>((resolve, reject) => {
        (client as unknown as { check: (request: object, callback: (error: Error | null, value: unknown) => void) => void })
          .check({ service: '' }, (error, value) => error ? reject(error) : resolve(value));
      });
      expect(response).toEqual(expect.objectContaining({ status: 'SERVING' }));
    } finally {
      client.close();
      server.forceShutdown();
    }
  });

  it('requires the internal key in the server interceptor', () => {
    const metadata = { get: (key: string) => key === 'x-internal-key' ? ['correct'] : [] };
    const interceptor = new InternalKeyInterceptor('correct');
    const context = { switchToRpc: () => ({ getContext: () => metadata }) };
    const next = { handle: () => of('ok') };
    expect(() => interceptor.intercept(context as never, next)).not.toThrow();
    expect(requestContextFromMetadata(metadata)).toEqual(expect.objectContaining({ correlationId: expect.any(String) }));
    expect(() => new InternalKeyInterceptor('wrong').intercept(context as never, next)).toThrow();
    const missing = { switchToRpc: () => ({ getContext: () => ({ get: () => [] }) }) };
    expect(() => interceptor.intercept(missing as never, next)).toThrow();
    try { interceptor.intercept(missing as never, next); } catch (error) {
      expect((error as { getError(): object }).getError()).toMatchObject({ code: status.UNAUTHENTICATED });
    }
  });

  it('redacts personal data in a real log entry', () => {
    const chunks: string[] = [];
    const stream = { write: (chunk: string) => { chunks.push(chunk); } };
    const logger = pino(loggerOptions, stream);
    logger.info({
      documentNumber: '123456', email: 'private@example.com',
      req: { headers: { authorization: 'Bearer hidden-token' }, body: { paymentReference: 'pay_hidden' } }
    }, 'logged');
    expect(chunks.join('')).not.toContain('123456');
    expect(chunks.join('')).not.toContain('private@example.com');
    expect(chunks.join('')).not.toContain('hidden-token');
    expect(chunks.join('')).not.toContain('pay_hidden');
    expect(chunks.join('')).toContain('[REDACTED]');
  });
});
