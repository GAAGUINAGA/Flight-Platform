// GENERADO por packages/graphql-schema/scripts/codegen.cjs a partir de schema.graphql y operations/operations.graphql. No editar a mano.

// ───────── Enumeraciones ─────────
export type Role = 'CUSTOMER' | 'ADMIN' | 'PARTNER';
export type CabinClass = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
export type PassengerType = 'ADULT' | 'YOUTH' | 'CHILD' | 'INFANT';
export type DocumentType = 'PASSPORT' | 'NATIONAL_ID';
export type Gender = 'M' | 'F' | 'X';
export type BookingStatus = 'PENDING' | 'PENDING_PAYMENT' | 'TICKET_ISSUING' | 'CONFIRMED' | 'FAILED' | 'CHANGE_PENDING' | 'CANCELLATION_PENDING' | 'CANCELLED';
export type TicketStatus = 'PENDING' | 'ISSUING' | 'ISSUED' | 'FAILED' | 'VOIDED' | 'REFUNDED';
export type HoldStatus = 'HELD' | 'RELEASED' | 'EXPIRED' | 'CONSUMED';
export type SeatStatus = 'AVAILABLE' | 'HELD' | 'BOOKED' | 'TICKETED' | 'CHECKED_IN' | 'BOARDED';
export type CancelReasonCode = 'CUSTOMER_REQUEST' | 'OTHER';
export type RefundStatus = 'CALCULATED' | 'SETTLED' | 'NOT_REFUNDABLE';
export type InventoryRestorationStatus = 'RESTORED' | 'PENDING';
export type SeatCharacteristic = 'WINDOW' | 'AISLE' | 'EXTRA_LEGROOM' | 'EMERGENCY_EXIT';
export type FlightStatusCode = 'SCHEDULED' | 'BOARDING' | 'DEPARTED' | 'DELAYED' | 'ARRIVED' | 'CANCELLED' | 'DIVERTED';
export type CheckInStatus = 'NOT_ELIGIBLE' | 'AVAILABLE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
export type PassengerCheckInStatus = 'CHECKED_IN' | 'NOT_CHECKED_IN' | 'FAILED';
export type BarcodeType = 'AZTEC' | 'PDF417' | 'QR';
export type Outcome = 'COMPLETED' | 'PENDING';
export type ErrorCategory = 'VALIDATION' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'GONE' | 'UNPROCESSABLE' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'INTERNAL';
export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';
export type DependencyStatus = 'UP' | 'DOWN' | 'DEGRADED';

// ───────── Entradas ─────────
export interface PassengerCountsInput { adults?: number; youths?: number | null; children?: number | null; infants?: number | null }
export interface ItineraryQueryInput { origin: string; destination: string; departureDate: string }
export interface SearchInput { itineraries: Array<ItineraryQueryInput>; passengers: PassengerCountsInput }
export interface ItinerarySelectionInput { itineraryId: string; cabinClass: CabinClass; fareBrand: string }
export interface HoldOfferInput { offerId: string; selections: Array<ItinerarySelectionInput>; passengers: PassengerCountsInput; seats?: Array<SeatAssignmentInput> | null; ttlMinutes?: number | null }
export interface ContactInput { email: string; phone: string }
export interface SeatAssignmentInput { segmentId: string; seatNumber: string }
export interface ExtraBaggageInput { itineraryId: string; quantity: number }
export interface PassengerInput { passengerId: string; passengerType: PassengerType; associatedAdultId?: string | null; firstName: string; lastName: string; documentType: DocumentType; documentNumber: string; nationality: string; documentExpiryDate?: string | null; birthDate: string; gender: Gender; contact: ContactInput; assignedSeats?: Array<SeatAssignmentInput> | null; extraBaggage?: Array<ExtraBaggageInput> | null }
export interface CreateBookingInput { holdId: string; passengers: Array<PassengerInput>; paymentReference: string }
export interface BookingFilterInput { pnr?: string | null; status?: BookingStatus | null; createdFrom?: string | null; createdTo?: string | null }
export interface AddBaggageInput { bookingId: string; passengerId: string; itineraryId: string; quantity: number; paymentReference: string }
export interface DateChangeInput { itineraryId: string; newDepartureDate: string }
export interface ConfirmDateChangeInput { bookingId: string; changeOfferId: string; paymentReference?: string | null; assignedSeats?: Array<SeatChangeInput> | null }
export interface SeatChangeInput { passengerId: string; segmentId: string; seatNumber: string }
export interface MoneyInput { currency: string; total: string; baseFare?: string | null; taxes?: string | null }
export interface UpsertFareInput { fareId?: string | null; flightInstanceId: string; cabinClass: CabinClass; fareBrand: string; price: MoneyInput; isRefundable: boolean; isChangeable: boolean; personalItemIncluded?: boolean | null; carryOnIncluded?: number | null; checkedBaggageIncluded?: number | null; extraCheckedBaggagePrice: MoneyInput }
export interface FlightStatusUpdateInput { date: string; status: FlightStatusCode; estimatedDepartureAt?: string | null; estimatedArrivalAt?: string | null; departureGate?: string | null; reason?: string | null }
export interface PromotionAgreementInput { allowsPromotions: boolean; maxDiscountPercent: number; destinations?: Array<string> | null; routes?: Array<string> | null; cabins?: Array<CabinClass> | null; validUntil?: string | null; conditions?: string | null }

// ───────── Fragmentos ─────────
export type MoneyFieldsFragment = { currency: string; total: string; baseFare: string | null; taxes: string | null };
export type SegmentFieldsFragment = { segmentId: string; flightNumber: string; layoverMinutes: number | null; marketingCarrier: string; operatingCarrier: string; aircraft: string | null; durationMinutes: number | null; status: FlightStatusCode | null; departure: { iataCode: string; at: string; terminal: string | null }; arrival: { iataCode: string; at: string; terminal: string | null } };
export type ItineraryFieldsFragment = { itineraryId: string; totalDurationMinutes: number; stopsCount: number; segments: Array<SegmentFieldsFragment>; pricingOptions: Array<{ cabinClass: CabinClass; fareBrand: string; availableSeats: number; fareRules: { isRefundable: boolean; isChangeable: boolean }; baggageAllowance: { personalItemIncluded: boolean | null; carryOnIncluded: number | null; checkedBaggageIncluded: number | null }; extraCheckedBaggagePrice: MoneyFieldsFragment | null; pricePerPassengerType: Array<{ passengerType: PassengerType | null; price: MoneyFieldsFragment | null }> }> };
export type BookingFieldsFragment = { bookingId: string; pnr: string; status: BookingStatus; createdAt: string; updatedAt: string | null; availableActions: Array<string>; grandTotal: MoneyFieldsFragment; itineraries: Array<ItineraryFieldsFragment> | null; passengers: Array<{ passengerId: string; passengerType: PassengerType; firstName: string; lastName: string; documentType: DocumentType; documentNumberMasked: string; nationality: string | null; birthDate: string | null; gender: Gender | null; assignedSeats: Array<{ segmentId: string; seatNumber: string }> | null; extraBaggage: Array<{ itineraryId: string; quantity: number }> | null }> | null; tickets: Array<{ ticketId: string; passengerId: string; eTicketNumber: string | null; status: TicketStatus; issuedAt: string | null; failureReason: string | null; segments: Array<{ segmentId: string; status: string; couponNumber: string | null }> | null }> | null; changes: Array<{ changedAt: string | null; description: string | null }> | null };
export type FlightStatusFieldsFragment = { flightNumber: string; date: string; marketingCarrier: string; operatingCarrier: string; aircraft: string | null; status: FlightStatusCode; delayMinutes: number | null; updatedAt: string | null; departure: { iataCode: string; terminal: string | null; gate: string | null; scheduledAt: string; estimatedAt: string | null; actualAt: string | null }; arrival: { iataCode: string; terminal: string | null; gate: string | null; scheduledAt: string; estimatedAt: string | null; actualAt: string | null } };
export type AdminFareFieldsFragment = { fareId: string; flightInstanceId: string; cabinClass: CabinClass; fareBrand: string; price: MoneyFieldsFragment; fareRules: { isRefundable: boolean; isChangeable: boolean }; baggageAllowance: { personalItemIncluded: boolean | null; carryOnIncluded: number | null; checkedBaggageIncluded: number | null }; extraCheckedBaggagePrice: MoneyFieldsFragment };
export type PromotionFieldsFragment = { allowsPromotions: boolean; maxDiscountPercent: number; destinations: Array<string> | null; routes: Array<string> | null; cabins: Array<CabinClass> | null; validUntil: string | null; conditions: string | null; updatedAt: string | null };

// ───────── Operaciones ─────────
export type SearchFlightsQueryVariables = { input: SearchInput };
export type SearchFlightsQuery = { searchFlights: { totalOffers: number; offers: Array<{ offerId: string; airline: { code: string | null; name: string | null }; grandTotal: MoneyFieldsFragment; itineraries: Array<ItineraryFieldsFragment> }> } };
export type SeatMapQueryVariables = { offerId: string; segmentId: string };
export type SeatMapQuery = { seatMap: { segmentId: string; cabins: Array<{ cabinClass: CabinClass; rows: Array<{ rowNumber: number; seats: Array<{ seatNumber: string; status: SeatStatus; isAvailable: boolean; characteristics: Array<SeatCharacteristic> }> }> }> } };
export type FlightStatusQueryVariables = { flightNumber: string; date: string };
export type FlightStatusQuery = { flightStatus: FlightStatusFieldsFragment };
export type PlatformHealthQueryVariables = Record<string, never>;
export type PlatformHealthQuery = { platformHealth: { status: HealthStatus; nodeId: string; version: string; uptimeSeconds: number | null; latencyMs: number | null; timestamp: string; dependencies: Array<{ name: string; status: DependencyStatus; latencyMs: number | null }> } };
export type ViewerQueryVariables = Record<string, never>;
export type ViewerQuery = { viewer: { userId: string; role: Role } | null };
export type HoldQueryVariables = { holdId: string };
export type HoldQuery = { hold: { holdId: string; status: HoldStatus; expiresAt: string | null; remainingSeconds: number | null; ttlMinutes: number | null; lockedPrice: MoneyFieldsFragment } };
export type MyBookingsQueryVariables = { filter?: BookingFilterInput | null; first?: number | null; after?: string | null };
export type MyBookingsQuery = { myBookings: { edges: Array<{ cursor: string; node: { bookingId: string; pnr: string; status: BookingStatus; origin: string | null; destination: string | null; departureDate: string | null; availableActions: Array<string>; grandTotal: MoneyFieldsFragment | null } }>; pageInfo: { endCursor: string | null; hasNextPage: boolean } } };
export type BookingQueryVariables = { bookingId: string };
export type BookingQuery = { booking: BookingFieldsFragment };
export type BoardingPassesQueryVariables = { bookingId: string };
export type BoardingPassesQuery = { boardingPasses: Array<{ passengerId: string; segmentId: string; seat: string; boardingGroup: string | null; boardingPosition: string | null; gate: string | null; barcode: string; barcodeType: BarcodeType }> };
export type BaggageOptionsQueryVariables = { bookingId: string };
export type BaggageOptionsQuery = { baggageOptions: Array<{ passengerId: string; itineraryId: string; maxAllowed: number | null; alreadyPurchased: number | null; price: MoneyFieldsFragment | null }> };
export type SearchDateChangeQueryVariables = { bookingId: string; changes: Array<DateChangeInput> };
export type SearchDateChangeQuery = { searchDateChange: Array<{ changeOfferId: string; expiresAt: string; segments: Array<SegmentFieldsFragment>; priceDifference: { fareDifference: string | null; taxDifference: string | null; changeFee: string | null; totalToPay: string | null } }> };
export type CancellationQuoteQueryVariables = { bookingId: string };
export type CancellationQuoteQuery = { cancellationQuote: { quoteId: string; isRefundable: boolean; refundAmount: string; penaltyAmount: string; currency: string; expiresAt: string } };
export type AdminFlightsQueryVariables = { date?: string | null; first?: number | null; after?: string | null };
export type AdminFlightsQuery = { adminFlights: { items: Array<{ flightInstanceId: string; flightNumber: string; departureIata: string; arrivalIata: string; departureAt: string; arrivalAt: string; aircraft: string | null; closed: boolean; cabins: Array<{ cabinClass: CabinClass; capacity: number }> }>; pageInfo: { endCursor: string | null; hasNextPage: boolean } } };
export type AdminFaresQueryVariables = { flightInstanceId?: string | null };
export type AdminFaresQuery = { adminFares: Array<AdminFareFieldsFragment> };
export type FlightOperationsQueryVariables = { date: string; origin?: string | null; destination?: string | null; status?: FlightStatusCode | null; first?: number | null; after?: string | null };
export type FlightOperationsQuery = { flightOperations: { totalFlights: number; items: Array<{ flightNumber: string; date: string; origin: string; destination: string; departureAt: string; status: FlightStatusCode; aircraft: string | null; totalSeats: number; loadFactor: number; activeHolds: number; nextHoldExpiryAt: string | null; checkInOpen: boolean; cabins: Array<{ cabinClass: CabinClass; totalSeats: number; seatsByStatus: { AVAILABLE: number | null; HELD: number | null; BOOKED: number | null; TICKETED: number | null; CHECKED_IN: number | null; BOARDED: number | null } }>; alerts: Array<{ code: string; severity: string; message: string | null }> }>; pageInfo: { endCursor: string | null; hasNextPage: boolean } } };
export type PromotionAgreementQueryVariables = Record<string, never>;
export type PromotionAgreementQuery = { promotionAgreement: PromotionFieldsFragment | null };
export type HoldOfferMutationVariables = { input: HoldOfferInput; idempotencyKey: string };
export type HoldOfferMutation = { holdOffer: { holdId: string; status: HoldStatus; expiresAt: string | null; remainingSeconds: number | null; ttlMinutes: number | null; lockedPrice: MoneyFieldsFragment } };
export type ReleaseHoldMutationVariables = { holdId: string };
export type ReleaseHoldMutation = { releaseHold: boolean };
export type CreateBookingMutationVariables = { input: CreateBookingInput; idempotencyKey: string };
export type CreateBookingMutation = { createBooking: { outcome: Outcome; booking: BookingFieldsFragment } };
export type AddBaggageMutationVariables = { input: AddBaggageInput; idempotencyKey: string };
export type AddBaggageMutation = { addBaggage: { passengerId: string; itineraryId: string; totalBaggage: number } };
export type ConfirmDateChangeMutationVariables = { input: ConfirmDateChangeInput; idempotencyKey: string };
export type ConfirmDateChangeMutation = { confirmDateChange: { outcome: Outcome; booking: BookingFieldsFragment | null } };
export type CancelBookingMutationVariables = { bookingId: string; quoteId: string; reasonCode?: CancelReasonCode | null; reason?: string | null; idempotencyKey: string };
export type CancelBookingMutation = { cancelBooking: { outcome: Outcome; status: BookingStatus; cancelledAt: string | null; ticketsVoided: Array<string> | null; message: string | null; refund: { refundId: string | null; amount: string | null; penaltyAmount: string | null; currency: string | null; percentage: number | null; status: RefundStatus | null } | null; inventoryRestoration: { status: InventoryRestorationStatus | null; seatsReleased: number | null } | null } };
export type ChangeSeatsMutationVariables = { bookingId: string; seats: Array<SeatChangeInput>; idempotencyKey: string };
export type ChangeSeatsMutation = { changeSeats: { seats: Array<{ passengerId: string; segmentId: string; previousSeatNumber: string | null; seatNumber: string; status: SeatStatus }> } };
export type IssueTicketsMutationVariables = { bookingId: string };
export type IssueTicketsMutation = { issueTickets: { issued: number; booking: BookingFieldsFragment } };
export type CheckInMutationVariables = { bookingId: string };
export type CheckInMutation = { checkIn: { bookingId: string; status: CheckInStatus; checkedInPassengers: Array<{ passengerId: string; status: PassengerCheckInStatus; segments: Array<{ segmentId: string; seat: string | null; status: PassengerCheckInStatus }> | null }> } };
export type UpdateFlightStatusMutationVariables = { flightNumber: string; input: FlightStatusUpdateInput; idempotencyKey?: string | null };
export type UpdateFlightStatusMutation = { updateFlightStatus: { previousStatus: FlightStatusCode | null; affectedBookings: number; eventId: string | null; flight: FlightStatusFieldsFragment } };
export type UpsertFareMutationVariables = { input: UpsertFareInput };
export type UpsertFareMutation = { upsertFare: AdminFareFieldsFragment };
export type SetPromotionAgreementMutationVariables = { input: PromotionAgreementInput; idempotencyKey: string };
export type SetPromotionAgreementMutation = { setPromotionAgreement: PromotionFieldsFragment };
