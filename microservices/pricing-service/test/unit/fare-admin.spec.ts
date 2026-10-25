import { expect, it } from '@jest/globals';
import { status } from '@grpc/grpc-js';
import { FareAdmin, FareAdminStore } from '../../src/application/fare-admin';
import { requireRole } from '@flight-platform/shared';

const store: FareAdminStore = { upsertFare: async (fare) => ({ ...fare, id: '11111111-1111-4111-8111-111111111111' }), listFares: async () => [] };
const input = { flightInstanceId: '22222222-2222-4222-8222-222222222222', cabinClass: 'ECONOMY', fareBrand: 'FLEX', price: { currency: 'USD', baseFare: '120.00', taxes: '20.00', total: '140.00' }, fareRules: { isRefundable: true, isChangeable: true }, baggageAllowance: { checkedBaggageIncluded: 1 }, extraCheckedBaggagePrice: { currency: 'USD', total: '50.00' } };

it('PRC-ADM-01 / U: UpsertFare inválido devuelve INVALID_ARGUMENT', async () => {
  try { await new FareAdmin(store).upsert({ ...input, flightInstanceId: 'bad' }); throw new Error('expected validation error'); }
  catch (error) { expect((error as { getError: () => unknown }).getError()).toMatchObject({ code: status.INVALID_ARGUMENT, details: 'VALIDATION_FAILED' }); }
});

it('PRC-ADM-01b / U: role distinto de admin devuelve PERMISSION_DENIED', () => {
  expect(() => requireRole({ ownerId: 'owner', role: 'customer', scopes: new Set(), correlationId: 'test' }, 'admin')).toThrow();
});

it('PRC-ADM-01d / U: el equipaje se persiste con la forma que lee la búsqueda (checkedBags) y por defecto 0', async () => {
  const saved: unknown[] = [];
  const capture: FareAdminStore = { upsertFare: async (fare) => { saved.push(fare.baggage); return { ...fare, id: '11111111-1111-4111-8111-111111111111' }; }, listFares: async () => [] };
  await new FareAdmin(capture).upsert({ ...input, baggageAllowance: { personalItemIncluded: true, carryOnIncluded: 1, checkedBaggageIncluded: 2 } });
  await new FareAdmin(capture).upsert({ ...input, baggageAllowance: {} });
  expect(saved).toEqual([{ personalItemIncluded: true, carryOnIncluded: 1, checkedBags: 2 }, { personalItemIncluded: undefined, carryOnIncluded: undefined, checkedBags: 0 }]);
});

it('PRC-ADM-01c / U: tarifa valida se transforma para persistencia', async () => {
  await expect(new FareAdmin(store).upsert(input)).resolves.toMatchObject({ fare: { flightInstanceId: input.flightInstanceId, fareBrand: 'FLEX', price: { total: '140.00' } } });
});
