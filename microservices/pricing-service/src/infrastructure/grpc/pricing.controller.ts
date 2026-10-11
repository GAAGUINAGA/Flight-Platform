import { Controller, Inject } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Metadata } from '@grpc/grpc-js';
import { RequestContext, requestContextFromMetadata, requireRole } from '@flight-platform/shared';
import { SearchOffers } from '../../application/search-offers';
import { OfferHolds } from '../../application/offer-holds';
import { PostSalePricing } from '../../application/post-sale-pricing';

export const PRICING_DEPS = Symbol('PRICING_DEPS');
export interface PricingDeps { readonly currency: string; readonly search: SearchOffers; readonly holds: OfferHolds; readonly postSale: PostSalePricing }
const ctxOf = (metadata: Metadata): RequestContext => requestContextFromMetadata(metadata) as RequestContext;

/** La frontera gRPC se registra desde el inicio; cada operación se conecta a su caso de uso en los bloques siguientes. */
@Controller()
export class PricingController {
  constructor(private readonly deps: PricingDeps) {}

  private pending(metadata: Metadata): never {
    // Acceder al contexto garantiza que el interceptor de llave se ejecutó antes de cualquier RPC.
    void ctxOf(metadata);
    void this.deps.currency;
    throw new RpcException({ code: status.UNIMPLEMENTED, details: 'UNIMPLEMENTED' });
  }

  upsertFare(_data: unknown, metadata: Metadata) { requireRole(ctxOf(metadata), 'admin'); return this.pending(metadata); }
  listFares(_data: unknown, metadata: Metadata) { requireRole(ctxOf(metadata), 'admin'); return this.pending(metadata); }
  async searchOffers(data: unknown, metadata: Metadata) {
    void ctxOf(metadata);
    return this.deps.search.execute(data);
  }
  async resolveSegment(data: unknown, metadata: Metadata) {
    void ctxOf(metadata);
    return { segment: await this.deps.search.resolveSegment(data) };
  }
  async holdOffer(data: unknown, metadata: Metadata) { void ctxOf(metadata); return this.deps.holds.hold(data); }
  async getOfferHold(data: unknown, metadata: Metadata) { void ctxOf(metadata); return this.deps.holds.get(data); }
  async releaseOfferHold(data: unknown, metadata: Metadata) { void ctxOf(metadata); await this.deps.holds.release(data); return {}; }
  async getPriceLock(data: unknown, metadata: Metadata) { void ctxOf(metadata); return this.deps.holds.getLock(data); }
  async quoteChange(data: unknown, metadata: Metadata) { void ctxOf(metadata); return this.deps.postSale.quoteChange(data); }
  async getChangeOffer(data: unknown, metadata: Metadata) { void ctxOf(metadata); return this.deps.postSale.getChangeOffer(data); }
  async markChangeOfferUsed(data: unknown, metadata: Metadata) { void ctxOf(metadata); await this.deps.postSale.markChangeOfferUsed(data); return {}; }
  quoteCancellation(data: unknown, metadata: Metadata) { void ctxOf(metadata); return this.deps.postSale.quoteCancellation(data); }
  async getBaggagePrice(data: unknown, metadata: Metadata) { void ctxOf(metadata); return this.deps.postSale.getBaggagePrice(data); }
}

const RPC_METHODS: Record<string, keyof PricingController> = {
  UpsertFare: 'upsertFare', ListFares: 'listFares', SearchOffers: 'searchOffers', ResolveSegment: 'resolveSegment',
  HoldOffer: 'holdOffer', GetOfferHold: 'getOfferHold', ReleaseOfferHold: 'releaseOfferHold', GetPriceLock: 'getPriceLock',
  QuoteChange: 'quoteChange', GetChangeOffer: 'getChangeOffer', MarkChangeOfferUsed: 'markChangeOfferUsed',
  QuoteCancellation: 'quoteCancellation', GetBaggagePrice: 'getBaggagePrice'
};
for (const [rpc, key] of Object.entries(RPC_METHODS)) {
  const descriptor = Object.getOwnPropertyDescriptor(PricingController.prototype, key) as PropertyDescriptor;
  GrpcMethod('PricingService', rpc)(PricingController.prototype, key, descriptor);
}
Inject(PRICING_DEPS)(PricingController, undefined as unknown as string, 0);
