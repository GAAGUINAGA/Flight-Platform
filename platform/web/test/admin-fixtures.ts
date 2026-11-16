import type { AdminBookingByPnrQuery, AdminFaresQuery, AdminFlightsQuery, AdminWebBookingsQuery, FlightOperationsQuery, PlatformHealthQuery, PromotionAgreementQuery, UpdateFlightStatusMutation } from '@flight-platform/graphql-schema/generated/types';
import { customer, fakeSession, type FakeSession } from './utils';

export const adminUser = { ...customer, id: 'a-1', email: 'admin@example.test', name: 'Admin Prueba', role: 'admin' as const };
export const adminSession = (): FakeSession => fakeSession({ status: 'authenticated', user: adminUser, expiresAt: null });
export const customerSession = (): FakeSession => fakeSession({ status: 'authenticated', user: customer, expiresAt: null });

export const FI_1 = '11111111-1111-4111-8111-111111111111'; export const FI_2 = '22222222-2222-4222-8222-222222222222';
const seats = (available: number, held: number, ticketed: number) => ({ AVAILABLE: available, HELD: held, BOOKED: 0, TICKETED: ticketed, CHECKED_IN: 0, BOARDED: 0 });

type Op = FlightOperationsQuery['flightOperations']['items'][number];
export const opFlight = (patch: Partial<Op> = {}): Op => ({
  flightNumber: 'FP103', date: '2026-12-10', origin: 'UIO', destination: 'GYE', departureAt: '2026-12-10T13:35:00Z', status: 'SCHEDULED', aircraft: 'A320', totalSeats: 200, loadFactor: 40, activeHolds: 2, nextHoldExpiryAt: null, checkInOpen: false, alerts: [],
  cabins: [{ cabinClass: 'ECONOMY', totalSeats: 150, seatsByStatus: seats(75, 5, 70) }, { cabinClass: 'BUSINESS', totalSeats: 50, seatsByStatus: seats(50, 0, 0) }], ...patch
});
export const operations = (items: Op[] = [opFlight(), opFlight({ flightNumber: 'FP105', destination: 'GPS', status: 'DELAYED', departureAt: '2026-12-10T17:20:00Z', activeHolds: 0, cabins: [{ cabinClass: 'ECONOMY', totalSeats: 100, seatsByStatus: seats(4, 0, 96) }], alerts: [{ code: 'DELAYED', severity: 'WARNING', message: 'Vuelo demorado 25 minutos.' }, { code: 'LOW_AVAILABILITY', severity: 'WARNING', message: 'Quedan 4 asientos en ECONOMY.' }] })], next: string | null = null): FlightOperationsQuery =>
  ({ flightOperations: { totalFlights: items.length, items, pageInfo: { endCursor: next, hasNextPage: next !== null } } });

export const health = (status: 'HEALTHY' | 'DEGRADED' | 'DOWN' = 'HEALTHY'): PlatformHealthQuery => ({ platformHealth: { status, nodeId: 'NODE_X', version: '2.0.0', uptimeSeconds: 100, latencyMs: 12, timestamp: '2026-12-10T10:00:00Z', dependencies: [{ name: 'inventory-service', status: status === 'DOWN' ? 'DOWN' : 'UP', latencyMs: 4 }, { name: 'pricing-service', status: status === 'DEGRADED' ? 'DEGRADED' : 'UP', latencyMs: 6 }] } });

type Flight = AdminFlightsQuery['adminFlights']['items'][number];
export const adminFlight = (patch: Partial<Flight> = {}): Flight => ({ flightInstanceId: FI_1, flightNumber: 'FP103', departureIata: 'UIO', arrivalIata: 'GYE', departureAt: '2026-12-10T13:35:00Z', arrivalAt: '2026-12-10T14:30:00Z', aircraft: 'A320', closed: false, cabins: [{ cabinClass: 'ECONOMY', capacity: 150 }, { cabinClass: 'BUSINESS', capacity: 50 }], ...patch });
export const adminFlights = (items: Flight[] = [adminFlight(), adminFlight({ flightInstanceId: FI_2, flightNumber: 'FP105', arrivalIata: 'GPS', departureAt: '2026-12-10T17:20:00Z', arrivalAt: '2026-12-10T20:15:00Z' })], next: string | null = null): AdminFlightsQuery =>
  ({ adminFlights: { items, pageInfo: { endCursor: next, hasNextPage: next !== null } } });

type Fare = AdminFaresQuery['adminFares'][number];
export const fare = (patch: Partial<Fare> = {}): Fare => ({
  fareId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', flightInstanceId: FI_1, cabinClass: 'ECONOMY', fareBrand: 'LIGHT', price: { currency: 'USD', total: '127.39', baseFare: null, taxes: '12.00' },
  fareRules: { isRefundable: false, isChangeable: true }, baggageAllowance: { personalItemIncluded: true, carryOnIncluded: 1, checkedBaggageIncluded: 0 }, extraCheckedBaggagePrice: { currency: 'USD', total: '35.00', baseFare: null, taxes: null }, ...patch
});
export const fares = (items: Fare[] = [fare(), fare({ fareId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', cabinClass: 'BUSINESS', fareBrand: 'FLEX', price: { currency: 'USD', total: '420.00', baseFare: '380.00', taxes: '40.00' }, fareRules: { isRefundable: true, isChangeable: true } })]): AdminFaresQuery => ({ adminFares: items });

export const agreement = (patch: Partial<NonNullable<PromotionAgreementQuery['promotionAgreement']>> = {}): PromotionAgreementQuery => ({ promotionAgreement: { allowsPromotions: true, maxDiscountPercent: 15, destinations: ['Quito'], routes: ['UIO-GYE'], cabins: ['ECONOMY'], validUntil: '2026-12-31', conditions: 'Solo combos', updatedAt: '2026-11-12T15:00:00Z', ...patch } });

type Row = AdminWebBookingsQuery['adminWebBookings']['items'][number];
export const webRow = (n: number, patch: Partial<Row> = {}): Row => ({ bookingId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, channel: 'WEB', createdAt: `2026-11-1${n}T15:00:00Z`, owner: `h4sh${n}opaco`, passengers: n, test: true, ...patch });
export const webBookings = (items: Row[] = [webRow(2), webRow(1)], next: string | null = null): AdminWebBookingsQuery => ({ adminWebBookings: { items, pageInfo: { endCursor: next, hasNextPage: next !== null } } });

export const statusUpdate = (patch: Partial<UpdateFlightStatusMutation['updateFlightStatus']> = {}): UpdateFlightStatusMutation => ({ updateFlightStatus: {
  previousStatus: 'SCHEDULED', affectedBookings: 3, eventId: 'evt-123',
  flight: { flightNumber: 'FP103', date: '2026-12-10', marketingCarrier: 'FP', operatingCarrier: 'FP', aircraft: 'A320', status: 'DELAYED', delayMinutes: 35, updatedAt: '2026-12-10T10:00:00Z', departure: { iataCode: 'UIO', terminal: null, gate: null, scheduledAt: '2026-12-10T13:35:00Z', estimatedAt: '2026-12-10T14:10:00Z', actualAt: null }, arrival: { iataCode: 'GYE', terminal: null, gate: null, scheduledAt: '2026-12-10T14:30:00Z', estimatedAt: null, actualAt: null } }, ...patch
} });

/** F12c-4a: reserva encontrada por PNR (ya sin datos personales; los nombres sí). */
export const bookingByPnr = (patch: Partial<NonNullable<AdminBookingByPnrQuery['adminBookingByPnr']>> = {}): AdminBookingByPnrQuery => ({ adminBookingByPnr: {
  bookingId: '00000000-0000-4000-8000-0000000000c1', pnr: 'J4R8GZ', status: 'CONFIRMED', channel: 'PARTNER', partnerRef: 'a1b2c3d4e5f6', createdAt: '2026-11-14T15:00:00.000Z', grandTotal: { currency: 'USD', total: '210.00' },
  segments: [{ segmentId: 'seg-1', flightNumber: 'FP210', origin: 'UIO', destination: 'GPS', departureAt: '2026-11-15T15:00:00.000Z', arrivalAt: '2026-11-15T17:00:00.000Z', departureLocal: '2026-11-15T10:00', arrivalLocal: '2026-11-15T11:00', status: 'SCHEDULED', cabinClass: 'ECONOMY' }],
  passengers: [{ passengerId: 'p-1', passengerType: 'ADULT', firstName: 'Ana', lastName: 'Pérez', seats: [{ segmentId: 'seg-1', seatNumber: '12A', status: 'TICKETED' }], extraBaggage: [{ itineraryId: 'it-1', quantity: 2 }] }],
  tickets: [{ passengerId: 'p-1', status: 'ISSUED', eTicketLast4: '7890', segments: [{ segmentId: 'seg-1', status: 'ISSUED' }] }],
  checkIn: { status: 'COMPLETED', passengers: [{ passengerId: 'p-1', status: 'CHECKED_IN', segments: [{ segmentId: 'seg-1', status: 'CHECKED_IN', seat: '12A' }] }] },
  ...patch
} });
