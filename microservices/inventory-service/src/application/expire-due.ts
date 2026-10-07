import { CabinClass } from '../domain/cabin';
import { ExpiredHold, InventoryTx } from './ports';

const BATCH = 500;

interface Total { flightInstanceId: string; cabinClass: CabinClass; seats: number }

/**
 * Marca EXPIRED los HELD vencidos (opcionalmente solo de ciertos vuelos) y
 * restituye su capacidad. Las l?neas se ordenan para evitar deadlocks.
 */
export async function expireDue(tx: InventoryTx, now: Date, flightInstanceIds?: string[]): Promise<ExpiredHold[]> {
  const result: ExpiredHold[] = [];
  for (;;) {
    const due = await tx.lockDueHolds(now, flightInstanceIds, BATCH);
    const totals = new Map<string, Total>();
    for (const hold of due) {
      hold.expire(now);
      if (!(await tx.updateHoldStatus(hold, 'HELD'))) continue;
      result.push({ holdId: hold.id, ownerId: hold.ownerId });
      for (const line of hold.lines) {
        const key = `${line.flightInstanceId}|${line.cabinClass}`;
        const total = totals.get(key) ?? { flightInstanceId: line.flightInstanceId, cabinClass: line.cabinClass, seats: 0 };
        total.seats += line.seats;
        totals.set(key, total);
      }
    }
    for (const key of [...totals.keys()].sort()) {
      const { flightInstanceId, cabinClass, seats } = totals.get(key) as Total;
      await tx.adjust('release', flightInstanceId, cabinClass, seats);
    }
    if (due.length < BATCH) return result;
  }
}
