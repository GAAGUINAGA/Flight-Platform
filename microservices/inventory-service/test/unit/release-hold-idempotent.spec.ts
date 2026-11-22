import { FixedClock } from '@flight-platform/shared';
import { firstValueFrom, throwError } from 'rxjs';
import { HoldUseCases } from '../../src/application/hold-use-cases';
import { InventoryConfig, InventoryTx, UnitOfWork } from '../../src/application/ports';
import { InventoryHold, HoldStatus } from '../../src/domain/inventory-hold';
import { InventoryError } from '../../src/domain/errors';
import { InventoryExceptionFilter, LoggingInterceptor } from '../../src/infrastructure/grpc/filters';

const now = new Date('2026-10-10T10:00:00Z');
const config: InventoryConfig = { holdTtlMinutes: 20, airlineCode: 'FP' };
const ref = { holdId: '00000000-0000-4000-8000-000000000001', ownerId: 'owner' };
const ctx = { correlationId: 'c1', role: 'customer', ownerId: 'owner' };
const make = (status: HoldStatus, expiresAt = new Date('2026-10-10T10:20:00Z')) => new InventoryHold({ id: ref.holdId, ownerId: 'owner', status, expiresAt, idempotencyKey: 'k', lines: [{ flightInstanceId: 'f1', cabinClass: 'BUSINESS', seats: 1 }], reservationId: status === 'CONSUMED' ? 'r1' : null });
const run = (hold: InventoryHold, adjustments: string[]) => {
  const tx = { findHold: async () => hold, updateHoldStatus: async () => true, adjust: async (change: string) => { adjustments.push(change); } } as unknown as InventoryTx;
  const uow: UnitOfWork = { run: (fn) => fn(tx) };
  return new HoldUseCases(uow, { publish: async () => undefined }, new FixedClock(now), config);
};
const outcome = async (error: unknown) => { try { await firstValueFrom(new InventoryExceptionFilter().catch(error)); return undefined; } catch (thrown) { return thrown; } };

describe('fix-compra-ejecutiva · ReleaseHold es idempotente y nunca INTERNAL_ERROR', () => {
  it('INV-REL-01: un hold ya LIBERADO o VENCIDO responde sin error y sin tocar la capacidad otra vez', async () => {
    for (const status of ['RELEASED', 'EXPIRED'] as const) {
      const adjustments: string[] = [];
      await expect(run(make(status), adjustments).release(ctx, ref)).resolves.toMatchObject({ status });
      expect(adjustments).toEqual([]);
    }
  });
  it('INV-REL-02: liberar un hold vigente restituye la capacidad una vez; repetirlo no hace nada', async () => {
    const hold = make('HELD'); const adjustments: string[] = []; const use = run(hold, adjustments);
    await expect(use.release(ctx, ref)).resolves.toMatchObject({ status: 'RELEASED' });
    await expect(use.release(ctx, ref)).resolves.toMatchObject({ status: 'RELEASED' });
    expect(adjustments).toEqual(['release']);
  });
  it('INV-REL-03: un hold ya CONSUMIDO responde con el error de negocio OFFER_NO_LONGER_AVAILABLE (gRPC 9), no con INTERNAL_ERROR', async () => {
    const adjustments: string[] = [];
    const error = await run(make('CONSUMED'), adjustments).release(ctx, ref).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(InventoryError);
    expect(await outcome(error)).toEqual({ code: 9, details: 'OFFER_NO_LONGER_AVAILABLE' });
    expect(adjustments).toEqual([]);
  });
  it('INV-REL-04: el registro de la operación muestra el código de negocio, no un INTERNAL_ERROR engañoso', async () => {
    const warned: Array<{ error?: string }> = [];
    const interceptor = new LoggingInterceptor({ debug: () => undefined, info: () => undefined, warn: (value: { error?: string }) => { warned.push(value); } } as never);
    const context = { switchToRpc: () => ({ getContext: () => ({ get: () => [] }), getData: () => ({}) }), getHandler: () => ({ name: 'releaseHold' }) };
    await expect(firstValueFrom(interceptor.intercept(context as never, { handle: () => throwError(() => new InventoryError('OFFER_NO_LONGER_AVAILABLE')) }))).rejects.toBeInstanceOf(InventoryError);
    expect(warned[0]?.error).toBe('OFFER_NO_LONGER_AVAILABLE');
  });
});
