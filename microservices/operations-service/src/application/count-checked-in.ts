import { validate } from '@flight-platform/shared';
import { z } from 'zod';
import { CheckInCounts } from './check-in-ports';

const requestSchema = z.object({ flightInstanceIds: z.array(z.string().guid()).max(200) }).strict();

export interface CheckedInFlight { flightInstanceId: string; cabins: Array<{ cabinClass: string; seats: number }>; withoutCabin: number }

/** Conteos de solo lectura para el panel de operaciones: sin datos personales, solo asientos por vuelo y cabina. */
export class CountCheckedIn {
  constructor(private readonly counts: CheckInCounts) {}

  async execute(input: unknown): Promise<{ flights: CheckedInFlight[] }> {
    const { flightInstanceIds } = validate(requestSchema, input);
    const ids = [...new Set(flightInstanceIds)];
    const rows = await this.counts.countCheckedIn(ids);
    return { flights: ids.map((flightInstanceId) => {
      const own = rows.filter((row) => row.flightInstanceId === flightInstanceId);
      return { flightInstanceId, cabins: own.filter((row) => row.cabinClass !== null).map((row) => ({ cabinClass: row.cabinClass as string, seats: row.seats })), withoutCabin: own.filter((row) => row.cabinClass === null).reduce((sum, row) => sum + row.seats, 0) };
    }) };
  }
}
