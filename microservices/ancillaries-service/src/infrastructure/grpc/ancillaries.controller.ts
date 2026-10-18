import { Controller, Inject } from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { Metadata } from '@grpc/grpc-js';
import { DomainError, RequestContext, requestContextFromMetadata, requireRole } from '@flight-platform/shared';
import { GetSeatMapForOffer } from '../../application/seat-map';
import { SeatAssignments } from '../../application/seat-assignments';
import { Baggage } from '../../application/baggage';

export const ANCILLARIES_DEPS = Symbol('ANCILLARIES_DEPS');
export interface AncillariesDeps { seatMap?: GetSeatMapForOffer; seats?: SeatAssignments; baggage?: Baggage; }
const context = (metadata: Metadata): RequestContext => requestContextFromMetadata(metadata) as RequestContext;

@Controller()
export class AncillariesController {
  constructor(private readonly _deps: AncillariesDeps) {}
  private withOwner(data: unknown, metadata: Metadata): unknown {
    const ownerId = metadata ? context(metadata)?.ownerId : undefined;
    if (!ownerId) throw new DomainError('NOT_FOUND');
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return data;
    return { ...(data as Record<string, unknown>), ownerId };
  }
  private unavailable(metadata: Metadata): never { void context(metadata); throw new RpcException({ code: status.UNIMPLEMENTED, details: 'UNIMPLEMENTED' }); }
  private normalizeReserveSeats(data: unknown): unknown {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return data;
    const request = data as Record<string, unknown>;
    if (!Array.isArray(request.assignments)) return data;
    return {
      ...request,
      assignments: request.assignments.map((value) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
        const { status: assignmentStatus, bookingId: assignmentBookingId, ...assignment } = value as Record<string, unknown>;
        if ((assignmentStatus !== undefined && assignmentStatus !== '') || (assignmentBookingId !== undefined && assignmentBookingId !== '')) throw new DomainError('VALIDATION_FAILED');
        return assignment;
      })
    };
  }
  getSeatMapForOffer(data: unknown, metadata: Metadata) { void context(metadata); return this._deps.seatMap ? this._deps.seatMap.execute(data) : this.unavailable(metadata); }
  reserveSeats(data: unknown, metadata: Metadata) { return this._deps.seats ? this._deps.seats.reserve(this.withOwner(this.normalizeReserveSeats(data), metadata)).then((assignments) => ({ assignments })) : this.unavailable(metadata); }
  confirmSeats(data: unknown, metadata: Metadata) { return this._deps.seats ? this._deps.seats.confirm(this.withOwner(data, metadata)).then((assignments) => ({ assignments })) : this.unavailable(metadata); }
  releaseSeats(data: unknown, metadata: Metadata) { return this._deps.seats ? this._deps.seats.release(this.withOwner(data, metadata)).then(() => ({})) : this.unavailable(metadata); }
  assignSeatAtCheckIn(data: unknown, metadata: Metadata) { return this._deps.seats ? this._deps.seats.assignAtCheckIn(this.withOwner(data, metadata)) : this.unavailable(metadata); }
  getAssignments(data: unknown, metadata: Metadata) { return this._deps.seats ? this._deps.seats.assignments(this.withOwner(data, metadata)).then((assignments) => ({ assignments })) : this.unavailable(metadata); }
  reserveBaggage(data: unknown, metadata: Metadata) { return this._deps.baggage ? this._deps.baggage.reserve(this.withOwner(data, metadata)) : this.unavailable(metadata); }
  registerBaggageAllowance(data: unknown, metadata: Metadata) { requireRole(context(metadata), 'system'); return this._deps.baggage ? this._deps.baggage.registerAllowances(this.withOwner(data, metadata)).then(() => ({})) : this.unavailable(metadata); }
  getBaggageOptions(data: unknown, metadata: Metadata) { return this._deps.baggage ? this._deps.baggage.options(this.withOwner(data, metadata)).then((options) => ({ options })) : this.unavailable(metadata); }
  purchaseBaggage(data: unknown, metadata: Metadata) { return this._deps.baggage ? this._deps.baggage.purchase(this.withOwner(data, metadata)) : this.unavailable(metadata); }
  async releaseAll(data: unknown, metadata: Metadata) {
    if (!this._deps.seats || !this._deps.baggage) return this.unavailable(metadata);
    const owned = this.withOwner(data, metadata);
    await this._deps.seats.assertOwnership(owned);
    requireRole(context(metadata), 'admin', 'system');
    await this._deps.seats.release(owned);
    await this._deps.baggage.releaseAll(owned);
    return {};
  }
}

const methods: Record<string, keyof AncillariesController> = { GetSeatMapForOffer: 'getSeatMapForOffer', ReserveSeats: 'reserveSeats', ConfirmSeats: 'confirmSeats', ReleaseSeats: 'releaseSeats', AssignSeatAtCheckIn: 'assignSeatAtCheckIn', GetAssignments: 'getAssignments', ReserveBaggage: 'reserveBaggage', RegisterBaggageAllowance: 'registerBaggageAllowance', GetBaggageOptions: 'getBaggageOptions', PurchaseBaggage: 'purchaseBaggage', ReleaseAll: 'releaseAll' };
for (const [rpc, key] of Object.entries(methods)) GrpcMethod('AncillariesService', rpc)(AncillariesController.prototype, key, Object.getOwnPropertyDescriptor(AncillariesController.prototype, key)!);
Inject(ANCILLARIES_DEPS)(AncillariesController, undefined as unknown as string, 0);
