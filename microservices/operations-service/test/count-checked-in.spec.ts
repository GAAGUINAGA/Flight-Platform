import { describe, expect, it } from '@jest/globals';
import { CountCheckedIn } from '../src/application/count-checked-in';
import { CheckedInCount, CheckInCounts } from '../src/application/check-in-ports';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
class Memory implements CheckInCounts {
  calls: string[][] = [];
  constructor(private readonly rows: CheckedInCount[]) {}
  async countCheckedIn(ids: string[]) { this.calls.push(ids); return this.rows.filter((row) => ids.includes(row.flightInstanceId)); }
}

describe('OPS-D: CountCheckedIn', () => {
  it('OPS-D-01 / I: agrupa por vuelo y cabina, devuelve 0 cabinas para un vuelo sin check-ins y separa los pases sin cabina', async () => {
    const store = new Memory([{ flightInstanceId: a, cabinClass: 'ECONOMY', seats: 3 }, { flightInstanceId: a, cabinClass: 'BUSINESS', seats: 1 }, { flightInstanceId: a, cabinClass: null, seats: 2 }]);
    await expect(new CountCheckedIn(store).execute({ flightInstanceIds: [a, b] })).resolves.toEqual({ flights: [
      { flightInstanceId: a, cabins: [{ cabinClass: 'ECONOMY', seats: 3 }, { cabinClass: 'BUSINESS', seats: 1 }], withoutCabin: 2 },
      { flightInstanceId: b, cabins: [], withoutCabin: 0 }
    ] });
  });
  it('OPS-D-02 / I: la respuesta solo trae conteos (sin datos personales) y los ids repetidos se consultan una vez', async () => {
    const store = new Memory([{ flightInstanceId: a, cabinClass: 'ECONOMY', seats: 1 }]);
    const result = await new CountCheckedIn(store).execute({ flightInstanceIds: [a, a] });
    expect(store.calls).toEqual([[a]]);
    expect(Object.keys(result.flights[0]).sort()).toEqual(['cabins', 'flightInstanceId', 'withoutCabin']);
  });
  it('OPS-D-03 / S: valida la entrada (ids no UUID, propiedades extra y más de 200 vuelos)', async () => {
    const useCase = new CountCheckedIn(new Memory([]));
    await expect(useCase.execute({ flightInstanceIds: ['x'] })).rejects.toThrow('Rpc Exception');
    await expect(useCase.execute({ flightInstanceIds: [], extra: 1 })).rejects.toThrow('Rpc Exception');
    await expect(useCase.execute({ flightInstanceIds: Array.from({ length: 201 }, () => a) })).rejects.toThrow('Rpc Exception');
    await expect(useCase.execute({})).rejects.toThrow('Rpc Exception');
  });
});
