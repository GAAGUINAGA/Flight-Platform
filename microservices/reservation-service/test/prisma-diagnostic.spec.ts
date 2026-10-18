import { Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { Prisma } from '../src/infrastructure/persistence/prisma-client/client';
import { ReservationExceptionFilter } from '../src/infrastructure/grpc/filters';

it('F9 / diagnóstico: registra código y metadatos permitidos sin mensajes ni valores', async () => {
  const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  try {
    const filter = new ReservationExceptionFilter();
    const error = new Prisma.PrismaClientKnownRequestError('secret-email@example.com', { code: 'P2028', clientVersion: '6.12.0', meta: { modelName: 'Reservation', field_name: 'owner_id', target: 'reservations_pnr_key', secret: 'pay_ok_secret' } });
    await expect(firstValueFrom(filter.catch(error))).rejects.toMatchObject({ details: 'INTERNAL_ERROR' });
    expect(log).toHaveBeenCalledWith('internal error: prisma_code=P2028 model=Reservation field=owner_id index=reservations_pnr_key');
    log.mockClear();
    const unsafe = new Prisma.PrismaClientKnownRequestError('secret', { code: 'P2024', clientVersion: '6.12.0', meta: { modelName: 'secret-email@example.com', field_name: 'pay_ok_secret', target: ['owner_id', 'secret-email@example.com'] } });
    await expect(firstValueFrom(filter.catch(unsafe))).rejects.toMatchObject({ details: 'INTERNAL_ERROR' });
    expect(log).toHaveBeenCalledWith('internal error: prisma_code=P2024');
  } finally { log.mockRestore(); }
});
