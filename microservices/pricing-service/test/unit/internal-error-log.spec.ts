import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { lastValueFrom } from 'rxjs';
import { PricingExceptionFilter } from '../../src/infrastructure/grpc/filters';

describe('registro de INTERNAL_ERROR en Pricing', () => {
  afterEach(() => jest.restoreAllMocks());
  const logged = (error: unknown) => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    return { spy, result: lastValueFrom(new PricingExceptionFilter().catch(error)).catch((reason: unknown) => reason) };
  };

  it('registra el tipo y el código de Prisma sin mensaje, meta ni datos personales', async () => {
    const prisma = Object.assign(new Error('Unique constraint failed ... ana@example.com 0991234567'), { name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { target: ['ana@example.com'] } });
    const { spy, result } = logged(prisma);
    await expect(result).resolves.toEqual({ code: 13, details: 'INTERNAL_ERROR' });
    expect(spy).toHaveBeenCalledWith('internal error: type=PrismaClientKnownRequestError code=P2002');
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/ana@example|0991234567/);
  });

  it('registra el estado gRPC de una dependencia caída sin su texto', async () => {
    const { spy, result } = logged(Object.assign(new Error('14 UNAVAILABLE: No connection established to 10.0.0.5'), { code: 14, details: 'No connection established to 10.0.0.5' }));
    await expect(result).resolves.toEqual({ code: 13, details: 'INTERNAL_ERROR' });
    expect(spy).toHaveBeenCalledWith('internal error: type=Error grpc_code=14');
  });

  it('devuelve sin cambios el error de negocio de una dependencia y no lo registra como interno', async () => {
    const { spy, result } = logged(Object.assign(new Error('9 FAILED_PRECONDITION: OFFER_NO_LONGER_AVAILABLE'), { code: 9, details: 'OFFER_NO_LONGER_AVAILABLE' }));
    await expect(result).resolves.toEqual({ code: 9, details: 'OFFER_NO_LONGER_AVAILABLE' });
    expect(spy).not.toHaveBeenCalled();
  });
});
