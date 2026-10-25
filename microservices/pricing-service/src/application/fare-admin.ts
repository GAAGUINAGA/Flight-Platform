import { validate } from '@flight-platform/shared';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { Fare } from './search-offers';
import { listFaresRequest, upsertFareRequest } from './schemas';

export type AdminFare = Fare & { id: string };

export interface FareAdminStore {
  upsertFare(input: Fare): Promise<AdminFare>;
  listFares(flightInstanceId?: string): Promise<AdminFare[]>;
}

const decimal = (minor: number): string => (minor / 100).toFixed(2);
const minor = (value: string): number => Number(value.replace('.', ''));
const view = (fare: AdminFare) => ({
  fareId: fare.id,
  flightInstanceId: fare.flightInstanceId,
  cabinClass: fare.cabinClass,
  fareBrand: fare.brand,
  price: { currency: 'USD', baseFare: decimal(fare.baseFareMinor), taxes: decimal(fare.taxesMinor), total: decimal(fare.baseFareMinor + fare.taxesMinor) },
  fareRules: { isChangeable: fare.rules.changeable, isRefundable: fare.rules.refundable },
  baggageAllowance: { personalItemIncluded: fare.baggage.personalItemIncluded, carryOnIncluded: fare.baggage.carryOnIncluded, checkedBaggageIncluded: fare.baggage.checkedBags },
  extraCheckedBaggagePrice: { currency: 'USD', total: decimal(fare.extraBagMinor) }
});

export class FareAdmin {
  constructor(private readonly store: FareAdminStore) {}
  async upsert(input: unknown) {
    const parsed = upsertFareRequest.safeParse(input);
    if (!parsed.success) {
      const error = new RpcException({ code: status.INVALID_ARGUMENT, details: 'VALIDATION_FAILED' }) as RpcException & { validationFields?: string[] };
      error.validationFields = parsed.error.issues.map((issue) => issue.path.join('.')).filter(Boolean);
      throw error;
    }
    const value = parsed.data;
    return { fare: view(await this.store.upsertFare({
      flightInstanceId: value.flightInstanceId, cabinClass: value.cabinClass, brand: value.fareBrand,
      baseFareMinor: minor(value.price.baseFare ?? value.price.total), taxesMinor: minor(value.price.taxes ?? '0.00'),
      rules: { changeable: value.fareRules.isChangeable, refundable: value.fareRules.isRefundable },
      baggage: { personalItemIncluded: value.baggageAllowance.personalItemIncluded, carryOnIncluded: value.baggageAllowance.carryOnIncluded, checkedBags: value.baggageAllowance.checkedBaggageIncluded ?? 0 }, extraBagMinor: minor(value.extraCheckedBaggagePrice.total)
    })) };
  }
  async list(input: unknown) { const value = validate(listFaresRequest, input); return { fares: (await this.store.listFares(value.flightInstanceId)).map((fare) => ({ fare: view(fare) })), page: {} }; }
}
