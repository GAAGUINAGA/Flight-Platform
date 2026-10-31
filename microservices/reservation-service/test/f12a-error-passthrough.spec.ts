import { describe, expect, it } from '@jest/globals';
import { status } from '@grpc/grpc-js';
import { DomainError } from '@flight-platform/shared';
import { firstValueFrom, lastValueFrom } from 'rxjs';
import { ReservationExceptionFilter } from '../src/infrastructure/grpc/filters';

const filter = new ReservationExceptionFilter();
const outcome = async (error: unknown): Promise<unknown> => { try { await lastValueFrom(filter.catch(error)); return undefined; } catch (thrown) { return thrown; } };
const clientError = (code: number, details: string) => Object.assign(new Error(`${code} ${details}`), { code, details });

describe('F12a: un error de negocio de una dependencia no se convierte en 500 (v1 y v2)', () => {
  it('ERR-01: SEAT_TAKEN de Ancillaries (ABORTED) se devuelve con su código del catálogo', async () => {
    expect(await outcome(clientError(status.ABORTED, 'SEAT_TAKEN'))).toEqual({ code: status.ABORTED, details: 'SEAT_TAKEN' });
  });
  it('ERR-02: los demás códigos del catálogo con su estado gRPC se conservan', async () => {
    for (const [code, details] of [[status.FAILED_PRECONDITION, 'SEAT_CABIN_MISMATCH'], [status.FAILED_PRECONDITION, 'INFANT_SEAT_NOT_ALLOWED'], [status.FAILED_PRECONDITION, 'BAGGAGE_LIMIT_EXCEEDED'], [status.FAILED_PRECONDITION, 'OFFER_NO_LONGER_AVAILABLE']] as const) expect(await outcome(clientError(code, details))).toEqual({ code, details });
  });
  it('ERR-03: un código del catálogo con un estado gRPC que no le corresponde sigue siendo INTERNAL_ERROR', async () => {
    expect(await outcome(clientError(status.INTERNAL, 'SEAT_TAKEN'))).toEqual({ code: status.INTERNAL, details: 'INTERNAL_ERROR' });
  });
  it('ERR-04: un texto que no es del catálogo no se refleja al cliente', async () => {
    expect(await outcome(clientError(status.ABORTED, 'select * from reservations'))).toEqual({ code: status.INTERNAL, details: 'INTERNAL_ERROR' });
    expect(JSON.stringify(await outcome(clientError(status.INTERNAL, 'password=secreto')))).not.toContain('secreto');
  });
  it('ERR-05: un DomainError propio y la indisponibilidad de una dependencia siguen como antes', async () => {
    expect(await outcome(new DomainError('SEAT_TAKEN'))).toEqual({ code: status.ABORTED, details: 'SEAT_TAKEN' });
    expect(await outcome(clientError(status.UNAVAILABLE, 'connection refused'))).toEqual({ code: status.UNAVAILABLE, details: 'Service temporarily unavailable' });
    expect(await outcome(new Error('boom'))).toEqual({ code: status.INTERNAL, details: 'INTERNAL_ERROR' });
    void firstValueFrom;
  });
});
