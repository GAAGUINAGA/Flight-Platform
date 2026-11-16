import { of } from 'rxjs';
import { Metadata } from '@grpc/grpc-js';
import { InternalKeyInterceptor } from '@flight-platform/shared';
import { AircraftCatalog } from '../src/application/aircraft-catalog';
import { AncillariesController } from '../src/infrastructure/grpc/ancillaries.controller';

const KEY = 'k'.repeat(32);
const metadata = async (role?: string): Promise<Metadata> => {
  const value = new Metadata(); value.set('x-internal-key', KEY); value.set('x-owner-id', 'sub-1'); if (role) value.set('x-role', role);
  await new Promise((resolve) => new InternalKeyInterceptor(KEY).intercept({ switchToRpc: () => ({ getContext: () => value }) } as never, { handle: () => of(null) }).subscribe({ complete: () => resolve(null) }));
  return value;
};
const reader = { countSeatsByAircraftAndCabin: async () => [
  { aircraft: 'B787', cabinClass: 'ECONOMY', seats: 200 }, { aircraft: 'B787', cabinClass: 'BUSINESS', seats: 30 },
  { aircraft: 'E190', cabinClass: 'ECONOMY', seats: 99 }, { aircraft: 'A320', cabinClass: 'ECONOMY', seats: 150 }, { aircraft: 'X1', cabinClass: 'ECONOMY', seats: 0 }
] };

describe('F12c-4c · AircraftCatalog (ANC-CAT)', () => {
  it('ANC-CAT-01 agrupa por avión, ordena cabinas (de la más alta a la más baja) y omite cabinas vacías', async () => {
    const result = await new AircraftCatalog(reader).list();
    expect(result.aircraft.map((value) => value.code)).toEqual(['A320', 'B787', 'E190']);
    expect(result.aircraft[1].cabins).toEqual([{ cabinClass: 'BUSINESS', seats: 30 }, { cabinClass: 'ECONOMY', seats: 200 }]);
  });
  it.each([['customer'], ['partner'], ['system'], [undefined]])('ANC-CAT-02 el rol %s ⇒ PERMISSION_DENIED', async (role) => {
    const controller = new AncillariesController({ aircraft: new AircraftCatalog(reader) });
    await expect(Promise.resolve().then(async () => controller.listAircraftLayouts({}, await metadata(role)))).rejects.toMatchObject({ error: { code: 7 } });
  });
  it('ANC-CAT-03 el rol admin lo lee', async () => {
    const controller = new AncillariesController({ aircraft: new AircraftCatalog(reader) });
    await expect(controller.listAircraftLayouts({}, await metadata('admin'))).resolves.toMatchObject({ aircraft: expect.any(Array) });
  });
});
