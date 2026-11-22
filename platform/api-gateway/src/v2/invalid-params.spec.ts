import { describe, expect, it } from '@jest/globals';
import { Metadata, status } from '@grpc/grpc-js';
import { EsbCallError, errorFromEnvelope } from '../esb-client';
import { INVALID_PARAM_REASONS, INVALID_PARAMS_METADATA_KEY, invalidParamsFromMetadata, safeInvalidParams } from './invalid-params';
import { v2ProblemFromError } from './problem';

/**
 * ADR-F12b1fix-05, punto 12: el Gateway copia a `invalidParams` del ProblemDetails v2 los campos inválidos que Reservation adjunta a un VALIDATION_FAILED
 * (por el sobre del ESB o, con transporte directo, por la metadata del error gRPC). Solo nombre del campo y motivo de una lista cerrada: nunca valores.
 */
const params = [{ name: 'passengers.0.firstName', reason: 'INVALID_FORMAT' }, { name: 'passengers.1.birthDate', reason: 'AGE_NOT_ALLOWED_FOR_TYPE' }];
const info = { method: 'POST', path: '/api/v2/vuelos/bookings' };

describe('GW-INV: sobre del ESB → error', () => {
  const envelope = (error: Record<string, unknown>) => ({ ok: false, error: { source: 'service', grpcCode: 3, catalogCode: 'VALIDATION_FAILED', ...error } });
  it('GW-INV-01 conserva la lista del sobre en el error con forma de error gRPC (mismo code y details de siempre)', () => {
    const error = errorFromEnvelope(envelope({ invalidParams: params }));
    expect(error).toBeInstanceOf(EsbCallError); expect(error).toMatchObject({ code: status.INVALID_ARGUMENT, details: 'VALIDATION_FAILED', invalidParams: params });
  });
  it('GW-INV-02 sin lista, o con otro código, no hay invalidParams; lo que no cumple el formato se descarta', () => {
    expect(errorFromEnvelope(envelope({})).invalidParams).toBeUndefined();
    expect(errorFromEnvelope(envelope({ grpcCode: 9, catalogCode: 'BAGGAGE_LIMIT_EXCEEDED', invalidParams: params })).invalidParams).toBeUndefined();
    expect(errorFromEnvelope(envelope({ invalidParams: [{ name: 'passengers.0.firstName', reason: 'Ana Pérez', value: 'x' }, { name: '<x>', reason: 'REQUIRED' }] })).invalidParams).toBeUndefined();
  });
});

describe('GW-INV: error → ProblemDetails v2', () => {
  it('GW-INV-03 VALIDATION_FAILED del ESB con campos: 400 con invalidParams {name, reason}; el resto del problema no cambia', () => {
    const problem = v2ProblemFromError(new EsbCallError(status.INVALID_ARGUMENT, 'VALIDATION_FAILED', 'createReservation', params), info);
    expect(problem).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', title: 'Solicitud inválida', type: 'https://flight-platform.dev/problems/validation-failed', instance: info.path, invalidParams: params });
    expect(Object.keys(problem.invalidParams![0]).sort()).toEqual(['name', 'reason']);
  });
  it('GW-INV-04 sin campos el problema es el de siempre (sin la clave invalidParams)', () => {
    const problem = v2ProblemFromError(new EsbCallError(status.INVALID_ARGUMENT, 'VALIDATION_FAILED'), info);
    expect(problem).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' }); expect('invalidParams' in problem).toBe(false);
  });
  it('GW-INV-05 transporte directo: la lista sale de la metadata final del error gRPC del cliente', () => {
    const metadata = new Metadata(); metadata.set('invalid-params', JSON.stringify(params));
    const problem = v2ProblemFromError(Object.assign(new Error('x'), { code: status.INVALID_ARGUMENT, details: 'VALIDATION_FAILED', metadata }), info);
    expect(problem).toMatchObject({ status: 400, invalidParams: params });
  });
  it('GW-INV-06 nunca copia valores: un error con campos sucios solo deja pasar nombre de campo del contrato y motivo de la lista cerrada', () => {
    const dirty = [{ name: 'passengers.0.documentNumber', reason: 'REQUIRED', value: 'DOC-SECRETO' }, { name: 'passengers.0.lastName', reason: 'Pérez no es válido' }, { name: 'passengers.0.contact.email', reason: 'INVALID_FORMAT' }];
    const problem = v2ProblemFromError(new EsbCallError(status.INVALID_ARGUMENT, 'VALIDATION_FAILED', undefined, dirty as never), info);
    expect(problem.invalidParams).toEqual([{ name: 'passengers.0.documentNumber', reason: 'REQUIRED' }, { name: 'passengers.0.contact.email', reason: 'INVALID_FORMAT' }]);
    expect(JSON.stringify(problem)).not.toMatch(/SECRETO|Pérez/);
  });
  it('GW-INV-07 los demás códigos (p. ej. BAGGAGE_LIMIT_EXCEEDED) no llevan invalidParams aunque el error los traiga', () => {
    const problem = v2ProblemFromError(new EsbCallError(status.FAILED_PRECONDITION, 'BAGGAGE_LIMIT_EXCEEDED', undefined, params), info);
    expect(problem).toMatchObject({ code: 'BAGGAGE_LIMIT_EXCEEDED' }); expect('invalidParams' in problem).toBe(false);
  });
});

describe('GW-INV: filtros', () => {
  it('GW-INV-09 la lista de motivos, la clave de la metadata y el tope son los mismos que los de packages/shared/src/invalid-params.ts (el Gateway no depende de ese paquete: la copia se fija aquí y allá)', () => {
    expect([...INVALID_PARAM_REASONS]).toEqual(['REQUIRED', 'INVALID_FORMAT', 'OUT_OF_RANGE', 'AGE_NOT_ALLOWED_FOR_TYPE', 'DUPLICATED', 'INCONSISTENT']);
    expect(INVALID_PARAMS_METADATA_KEY).toBe('invalid-params');
    expect(safeInvalidParams(Array.from({ length: 60 }, (_, index) => ({ name: `passengers.${index}.firstName`, reason: 'REQUIRED' }))).length).toBe(50);
    // Los nombres admitidos: los del contrato bajo `passengers`; nada más.
    expect(safeInvalidParams([{ name: 'passengers', reason: 'INCONSISTENT' }, { name: 'passengers.0.extraBaggage.1.quantity', reason: 'OUT_OF_RANGE' }, { name: 'passengers.0.contact.phone', reason: 'REQUIRED' }, { name: 'payment.paymentReference', reason: 'REQUIRED' }, { name: 'passengers.0.a.b.c.d.e', reason: 'REQUIRED' }]).map((param) => param.name))
      .toEqual(['passengers', 'passengers.0.extraBaggage.1.quantity', 'passengers.0.contact.phone']);
  });
  it('GW-INV-08 safeInvalidParams: sin repetidos, con tope y tolerante a basura; la metadata inválida se ignora', () => {
    expect(safeInvalidParams(undefined)).toEqual([]);
    expect(safeInvalidParams(Array.from({ length: 200 }, (_, index) => ({ name: `passengers.${index % 100}.f${index}`, reason: 'REQUIRED' }))).length).toBeLessThanOrEqual(50);
    const bad = new Metadata(); bad.set('invalid-params', '{roto');
    expect(invalidParamsFromMetadata(bad)).toEqual([]); expect(invalidParamsFromMetadata(null)).toEqual([]);
  });
});
