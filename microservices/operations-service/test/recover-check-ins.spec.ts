import { RecoverCheckInsUseCase } from '../src/application/recover-check-ins';
import { CheckInStore } from '../src/application/check-in-ports';

const ownerId = 'recovery-owner';
const bookingId = '00000000-0000-4000-8000-000000000001';

class RecoveryStore implements CheckInStore {
  readonly claimed = [{ ownerId, bookingId }];
  readonly unpublished = [{ ownerId, bookingId: '00000000-0000-4000-8000-000000000002' }];
  released: string[] = []; blocked: string[] = [];
  async find() { return null; } async begin() { return true; } async resume() { return true; } async savePass() { return undefined; } async complete() { return undefined; } async abort() { return undefined; } async restore() { return undefined; } async listPasses() { return []; }
  async claimStale(now: Date, staleBefore: Date, limit: number) { expect(now.toISOString()).toBe('2026-10-23T12:00:00.000Z'); expect(staleBefore.toISOString()).toBe('2026-10-23T11:50:00.000Z'); expect(limit).toBe(10); return this.claimed; }
  async releaseRecoveryClaim(owner: string, booking: string) { this.released.push(`${owner}/${booking}`); }
  async markBlocked(owner: string, booking: string) { this.blocked.push(`${owner}/${booking}`); }
  async listUnpublished(limit: number) { expect(limit).toBe(10); return this.unpublished; }
  async markEventPublished() { return undefined; }
}

describe('F11c-1 / tarea 0: recuperación de check-ins', () => {
  it('recupera el IN_PROGRESS reclamado y reintenta eventos no publicados con reloj inyectable', async () => {
    const store = new RecoveryStore();
    const execute = jest.fn(async () => ({ status: 'COMPLETED' }));
    const useCase = new RecoverCheckInsUseCase(store, { execute } as never, () => new Date('2026-10-23T12:00:00.000Z'), 10);
    await expect(useCase.execute({ limit: 10 })).resolves.toEqual({ recoveredCheckIns: 1, publishedEvents: 1 });
    expect(store.released).toEqual([`${ownerId}/${bookingId}`]);
    expect(execute).toHaveBeenCalledWith({ ownerId, bookingId });
    expect(execute).toHaveBeenCalledWith({ ownerId, bookingId: '00000000-0000-4000-8000-000000000002' });
  });

  it('no publica dos veces ni detiene el lote cuando la recuperación de un check-in falla', async () => {
    const store = new RecoveryStore();
    const execute = jest.fn(async (input: { bookingId: string }) => { if (input.bookingId === bookingId) throw new Error('dependency failed'); return { status: 'COMPLETED' }; });
    const useCase = new RecoverCheckInsUseCase(store, { execute } as never, () => new Date('2026-10-23T12:00:00.000Z'), 10);
    await expect(useCase.execute({ limit: 10 })).resolves.toEqual({ recoveredCheckIns: 0, publishedEvents: 1 });
    expect(store.blocked).toEqual([`${ownerId}/${bookingId}`]);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
