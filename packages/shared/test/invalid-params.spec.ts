import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Buffer } from 'node:buffer';
import { Metadata, Server, ServerCredentials, credentials, makeGenericClientConstructor, status, type ServiceError } from '@grpc/grpc-js';
import { lastValueFrom } from 'rxjs';
import { z } from 'zod';
import {
  checkPassengerFields, checkPassengerSet, DomainError, DomainRpcExceptionFilter, INVALID_PARAM_REASONS, INVALID_PARAMS_METADATA_KEY, MAX_INVALID_PARAMS, invalidParamsFromMetadata, invalidParamsFromRuleIssues,
  invalidParamsFromZodIssues, invalidParamsToMetadata, safeGrpcError, sanitizeInvalidParams, toRpcException, ValidationFailedError, type ZodIssueLike
} from '../src/index';

/** ADR-F12b1fix-05, punto 12: campos inválidos del VALIDATION_FAILED (nombre `passengers.<i>.<campo>` + motivo de lista cerrada, sin valores). */
const NOW = new Date('2026-06-15T12:00:00Z');
const adult = { passengerId: 'a1', passengerType: 'ADULT' as const, firstName: 'Ana', lastName: 'Pérez', documentNumber: 'AB1234567', nationality: 'EC', birthDate: '1990-01-01', gender: 'F', email: 'ana@example.com', phone: '+593990000000', assignedSeats: [] };

describe('INV-01 reglas compartidas → campos inválidos', () => {
  it('cada incumplimiento sale como passengers.<índice>.<campo> con su motivo y sin ningún valor escrito', () => {
    const issues = checkPassengerFields({ ...adult, firstName: 'Ana2', documentNumber: 'SECRETO-1', email: 'no-es-correo', phone: '0991', birthDate: '2015-01-01' }, 1, NOW);
    const params = invalidParamsFromRuleIssues(issues);
    expect(params).toEqual([
      { name: 'passengers.1.firstName', reason: 'INVALID_FORMAT' }, { name: 'passengers.1.documentNumber', reason: 'INVALID_FORMAT' },
      { name: 'passengers.1.birthDate', reason: 'AGE_NOT_ALLOWED_FOR_TYPE' }, { name: 'passengers.1.contact.email', reason: 'INVALID_FORMAT' }, { name: 'passengers.1.contact.phone', reason: 'INVALID_FORMAT' }
    ]);
    const text = JSON.stringify(params);
    for (const secret of ['Ana2', 'SECRETO', 'no-es-correo', '0991', '2015']) expect(text).not.toContain(secret);
  });
  it('fecha futura = OUT_OF_RANGE; ids repetidos = DUPLICATED; infante sin adulto y conteos = INCONSISTENT (conjunto: `passengers`)', () => {
    expect(invalidParamsFromRuleIssues(checkPassengerFields({ ...adult, birthDate: '2030-01-01' }, 0, NOW))).toEqual([{ name: 'passengers.0.birthDate', reason: 'OUT_OF_RANGE' }]);
    const infant = { ...adult, passengerId: 'i1', passengerType: 'INFANT' as const, birthDate: '2026-01-01', assignedSeats: [] };
    const params = invalidParamsFromRuleIssues(checkPassengerSet([adult, { ...adult }, infant], { adults: 1, youths: 0, children: 0, infants: 1 }, NOW));
    expect(params).toEqual(expect.arrayContaining([{ name: 'passengers.1.passengerId', reason: 'DUPLICATED' }, { name: 'passengers', reason: 'INCONSISTENT' }]));
  });
});

describe('INV-02 incumplimientos de Zod → campos inválidos', () => {
  const schema = z.object({ passengers: z.array(z.object({ firstName: z.string().min(1).max(5), seats: z.number().int().min(1).max(3), gender: z.enum(['M', 'F']), contact: z.object({ phone: z.string().regex(/^\+\d+$/) }) })), holdId: z.string() });
  const issuesOf = (value: unknown): ZodIssueLike[] => { const parsed = schema.safeParse(value); return parsed.success ? [] : parsed.error.issues as unknown as ZodIssueLike[]; };
  it('REQUIRED (falta o vacío), OUT_OF_RANGE (número fuera de rango) e INVALID_FORMAT (formato); solo campos de pasajeros', () => {
    const params = invalidParamsFromZodIssues(issuesOf({ passengers: [{ firstName: '', seats: 9, gender: 'Z', contact: { phone: 'SECRETO' } }, { seats: 1, gender: 'M', contact: {} }], holdId: 7 }));
    expect(params).toEqual(expect.arrayContaining([
      { name: 'passengers.0.firstName', reason: 'REQUIRED' }, { name: 'passengers.0.seats', reason: 'OUT_OF_RANGE' }, { name: 'passengers.0.gender', reason: 'INVALID_FORMAT' },
      { name: 'passengers.0.contact.phone', reason: 'INVALID_FORMAT' }, { name: 'passengers.1.firstName', reason: 'REQUIRED' }, { name: 'passengers.1.contact.phone', reason: 'REQUIRED' }
    ]));
    expect(params.some((param) => param.name === 'holdId')).toBe(false);
    expect(JSON.stringify(params)).not.toContain('SECRETO');
  });
});

describe('INV-03 sanitización (lo que no cumple el formato no pasa)', () => {
  it('la lista cerrada de motivos es EXACTAMENTE esta (el Gateway repite la misma lista y su prueba la fija igual: si cambia aquí, cambia allá)', () => {
    expect([...INVALID_PARAM_REASONS]).toEqual(['REQUIRED', 'INVALID_FORMAT', 'OUT_OF_RANGE', 'AGE_NOT_ALLOWED_FOR_TYPE', 'DUPLICATED', 'INCONSISTENT']);
    expect(MAX_INVALID_PARAMS).toBe(50);
  });
  it('descarta nombres ajenos al contrato, motivos fuera de la lista, repetidos y entradas que no son objetos; con tope', () => {
    expect(sanitizeInvalidParams([
      { name: 'passengers.0.firstName', reason: 'INVALID_FORMAT' }, { name: 'passengers.0.firstName', reason: 'REQUIRED' }, { name: 'holdId', reason: 'REQUIRED' },
      { name: 'passengers.0.<script>', reason: 'REQUIRED' }, { name: 'passengers.1.lastName', reason: 'Juan Pérez no es válido' }, null, 'x', { name: 'passengers.2.contact.email', reason: 'REQUIRED' }
    ])).toEqual([{ name: 'passengers.0.firstName', reason: 'INVALID_FORMAT' }, { name: 'passengers.2.contact.email', reason: 'REQUIRED' }]);
    expect(sanitizeInvalidParams('no es lista')).toEqual([]);
    const many = Array.from({ length: 200 }, (_, index) => ({ name: `passengers.${index % 100}.f${index}`, reason: 'REQUIRED' }));
    expect(sanitizeInvalidParams(many).length).toBeLessThanOrEqual(50);
  });
  it('la metadata de un error se lee con el mismo filtro y tolera basura', () => {
    const bad = new Metadata(); bad.set(INVALID_PARAMS_METADATA_KEY, '{no es json');
    expect(invalidParamsFromMetadata(bad)).toEqual([]); expect(invalidParamsFromMetadata(undefined)).toEqual([]); expect(invalidParamsFromMetadata(new Metadata())).toEqual([]);
    expect(invalidParamsFromMetadata(invalidParamsToMetadata([{ name: 'passengers.0.firstName', reason: 'REQUIRED' }]))).toEqual([{ name: 'passengers.0.firstName', reason: 'REQUIRED' }]);
  });
});

describe('INV-04 traductor de errores compartido', () => {
  const params = [{ name: 'passengers.0.firstName', reason: 'INVALID_FORMAT' as const }];
  it('ValidationFailedError conserva la lista en la metadata; el estado y el código no cambian', () => {
    const safe = safeGrpcError(new ValidationFailedError(params));
    expect(safe).toMatchObject({ code: status.INVALID_ARGUMENT, details: 'VALIDATION_FAILED' });
    expect(invalidParamsFromMetadata(safe.metadata)).toEqual(params);
    expect(toRpcException(new ValidationFailedError(params)).getError()).toMatchObject({ code: status.INVALID_ARGUMENT, details: 'VALIDATION_FAILED' });
  });
  it('sin campos (o con un DomainError de siempre) la forma es exactamente la de antes: sin metadata', () => {
    expect(safeGrpcError(new ValidationFailedError([]))).toEqual({ code: status.INVALID_ARGUMENT, details: 'VALIDATION_FAILED' });
    expect(safeGrpcError(new DomainError('VALIDATION_FAILED'))).toEqual({ code: status.INVALID_ARGUMENT, details: 'VALIDATION_FAILED' });
  });
  it('el filtro de excepciones la conserva y filtra lo que no cumple', async () => {
    const rejected = await lastValueFrom(new DomainRpcExceptionFilter().catch(new ValidationFailedError(params))).catch((error: unknown) => error as { error: { metadata?: Metadata } });
    expect(invalidParamsFromMetadata((rejected as { error: { metadata?: Metadata } }).error.metadata)).toEqual(params);
  });
});

describe('INV-05 por el cable gRPC real: la lista llega al cliente en la metadata final', () => {
  const definition = { Fail: { path: '/t.T/Fail', requestStream: false, responseStream: false, requestSerialize: (v: object) => Buffer.from(JSON.stringify(v)), requestDeserialize: (b: Buffer) => JSON.parse(b.toString()) as object, responseSerialize: (v: object) => Buffer.from(JSON.stringify(v)), responseDeserialize: (b: Buffer) => JSON.parse(b.toString()) as object } };
  const server = new Server(); let port = 0;
  beforeAll(async () => {
    server.addService(definition, { Fail: (_call: unknown, callback: (error: unknown) => void) => callback(safeGrpcError(new ValidationFailedError([{ name: 'passengers.0.documentNumber', reason: 'INVALID_FORMAT' }]))) } as never);
    port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, bound) => error ? reject(error) : resolve(bound)));
  });
  afterAll(() => { server.forceShutdown(); });
  it('INVALID_ARGUMENT + VALIDATION_FAILED + invalid-params', async () => {
    const Client = makeGenericClientConstructor(definition, 'T'); const client = new Client(`127.0.0.1:${port}`, credentials.createInsecure());
    const error = await new Promise<ServiceError>((resolve) => client.makeUnaryRequest('/t.T/Fail', definition.Fail.requestSerialize, definition.Fail.responseDeserialize, {}, (thrown) => resolve(thrown as ServiceError)));
    client.close();
    expect(error).toMatchObject({ code: status.INVALID_ARGUMENT, details: 'VALIDATION_FAILED' });
    expect(invalidParamsFromMetadata(error.metadata)).toEqual([{ name: 'passengers.0.documentNumber', reason: 'INVALID_FORMAT' }]);
  });
});
