import { DomainError } from '@flight-platform/shared';

/** Ownership is deliberately separate from ancillary rows: a booking can have none. */
export interface BookingOwnershipStore {
  claimOrAssertOwner(bookingId: string, ownerId: string): Promise<void>;
  assertOwner(bookingId: string, ownerId: string): Promise<void>;
}

export const ownershipNotFound = (): never => { throw new DomainError('NOT_FOUND'); };
