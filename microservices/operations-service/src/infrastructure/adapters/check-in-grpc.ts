import { DomainError, ERROR_CODES, ErrorCode, GRPC_STATUS_BY_CODE, GrpcClientOptions, withGrpcCallContext } from '@flight-platform/shared';
import { status } from '@grpc/grpc-js';
import { firstValueFrom, Observable } from 'rxjs';
import { CheckInReservationGateway, CheckInSeatGateway, CheckInSnapshot, CheckInTicketingGateway, Coupon } from '../../application/check-in-ports';
import { DependencyUnavailable } from '../../application/ports';

async function translate<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      if (error.code === status.UNAVAILABLE || error.code === status.DEADLINE_EXCEEDED) throw new DependencyUnavailable();
      if (error.code === status.NOT_FOUND) throw new DomainError('NOT_FOUND');
      if ('details' in error && typeof error.details === 'string' && ERROR_CODES.includes(error.details as ErrorCode) && GRPC_STATUS_BY_CODE[error.details as ErrorCode] === error.code) throw new DomainError(error.details as ErrorCode);
    }
    throw error;
  }
}

interface ReservationClient { getReservationSnapshot(input: { bookingId: string; ownerId: string }): Observable<CheckInSnapshot> }
interface TicketingClient { getCouponsForBooking(input: { bookingId: string; ownerId: string }): Observable<{ coupons: Coupon[] }> }
interface AncillariesClient { assignSeatAtCheckIn(input: Parameters<CheckInSeatGateway['assign']>[0]): Observable<{ seatNumber: string; status: string }> }

export class GrpcCheckInReservation implements CheckInReservationGateway {
  constructor(private readonly client: ReservationClient, private readonly options: GrpcClientOptions) {}
  getSnapshot(ownerId: string, bookingId: string): Promise<CheckInSnapshot> {
    return translate(firstValueFrom(withGrpcCallContext(this.client, { ...this.options, ownerId }).getReservationSnapshot({ ownerId, bookingId })));
  }
}
export class GrpcCheckInTicketing implements CheckInTicketingGateway {
  constructor(private readonly client: TicketingClient, private readonly options: GrpcClientOptions) {}
  async getCoupons(ownerId: string, bookingId: string): Promise<Coupon[]> {
    const result = await translate(firstValueFrom(withGrpcCallContext(this.client, { ...this.options, ownerId }).getCouponsForBooking({ ownerId, bookingId })));
    return result.coupons;
  }
}
export class GrpcCheckInSeats implements CheckInSeatGateway {
  constructor(private readonly client: AncillariesClient, private readonly options: GrpcClientOptions) {}
  assign(input: Parameters<CheckInSeatGateway['assign']>[0]): Promise<{ seatNumber: string; status: string }> {
    return translate(firstValueFrom(withGrpcCallContext(this.client, { ...this.options, ownerId: input.ownerId }).assignSeatAtCheckIn(input)));
  }
}
