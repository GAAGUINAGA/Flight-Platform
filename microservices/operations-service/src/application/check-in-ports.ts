export interface CheckInPassenger {
  passengerId: string;
  passengerType: 'ADULT' | 'YOUTH' | 'CHILD' | 'INFANT';
  associatedAdultId?: string;
  documentType: string;
  documentExpiryDate?: string;
}
export interface CheckInSegment {
  segmentId: string;
  flightInstanceId: string;
  flightNumber: string;
  departure: { at: string };
  status?: string;
}
export interface CheckInSnapshot {
  bookingId: string;
  pnr: string;
  status: string;
  passengers: CheckInPassenger[];
  itineraries: Array<{ itineraryId: string; segments: CheckInSegment[]; pricingOptions: Array<{ cabinClass: string }> }>;
}
export interface CheckInReservationGateway { getSnapshot(ownerId: string, bookingId: string): Promise<CheckInSnapshot> }
export interface Coupon { passengerId: string; segmentId: string; status: string }
export interface CheckInTicketingGateway { getCoupons(ownerId: string, bookingId: string): Promise<Coupon[]> }
export interface CheckInSeatGateway {
  assign(input: { ownerId: string; bookingId: string; passengerId: string; segmentId: string; passengerType: string; cabinClass: string }): Promise<{ seatNumber: string; status: string }>;
}
export interface CheckInResult {
  bookingId: string;
  status: 'COMPLETED' | 'FAILED';
  checkedInPassengers: Array<{ passengerId: string; status: 'CHECKED_IN' | 'NOT_CHECKED_IN' | 'FAILED'; segments: Array<{ segmentId: string; seat?: string; status: 'CHECKED_IN' | 'NOT_CHECKED_IN' | 'FAILED' }> }>;
}
export interface CheckInPass { passengerId: string; segmentId: string; seat: string; barcode: string; barcodeType: 'QR' }
export interface CheckInStore {
  find(ownerId: string, bookingId: string): Promise<{ status: string; result: CheckInResult | null; eventPublished: boolean } | null>;
  begin(ownerId: string, bookingId: string): Promise<boolean>;
  resume(ownerId: string, bookingId: string): Promise<boolean>;
  savePass(ownerId: string, bookingId: string, pass: CheckInPass): Promise<void>;
  complete(ownerId: string, result: CheckInResult): Promise<void>;
  abort(ownerId: string, bookingId: string): Promise<void>;
  restore(ownerId: string, result: CheckInResult): Promise<void>;
  listPasses(ownerId: string, bookingId: string): Promise<CheckInPass[]>;
  claimStale(now: Date, staleBefore: Date, limit: number): Promise<Array<{ ownerId: string; bookingId: string }>>;
  releaseRecoveryClaim(ownerId: string, bookingId: string): Promise<void>;
  markBlocked(ownerId: string, bookingId: string): Promise<void>;
  listUnpublished(limit: number): Promise<Array<{ ownerId: string; bookingId: string }>>;
  markEventPublished(ownerId: string, bookingId: string): Promise<void>;
}
