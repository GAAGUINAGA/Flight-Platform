import { validate } from '@flight-platform/shared';
import { z } from 'zod';
import { CheckInUseCase } from './check-in';
import { CheckInStore } from './check-in-ports';

const schema = z.object({ limit: z.number().int().min(1).max(100) }).strict();

/** Reclaims stale work and retries check-in event publication without an HTTP surface. */
export class RecoverCheckInsUseCase {
  constructor(private readonly store: CheckInStore, private readonly checkIn: CheckInUseCase, private readonly now: () => Date, private readonly staleMinutes: number) {}

  async execute(input: unknown): Promise<{ recoveredCheckIns: number; publishedEvents: number }> {
    const { limit } = validate(schema, input);
    const now = this.now();
    const staleBefore = new Date(now.getTime() - this.staleMinutes * 60_000);
    let recoveredCheckIns = 0;
    for (const entry of await this.store.claimStale(now, staleBefore, limit)) {
      await this.store.releaseRecoveryClaim(entry.ownerId, entry.bookingId);
      try { await this.checkIn.execute(entry); recoveredCheckIns += 1; }
      catch { await this.store.markBlocked(entry.ownerId, entry.bookingId); }
    }
    let publishedEvents = 0;
    for (const entry of await this.store.listUnpublished(limit)) {
      try { await this.checkIn.execute(entry); publishedEvents += 1; } catch { /* next bounded run retries */ }
    }
    return { recoveredCheckIns, publishedEvents };
  }
}
