import type { BookingFieldsFragment, BoardingPassesQuery, HoldQuery, SeatMapQuery } from '@flight-platform/graphql-schema/generated/types';
import { IntentBook } from '../src/purchase/intent';
import { memoryStore } from '../src/data/identity';
import { PurchaseStore, type Offer } from '../src/purchase/purchase-store';
import { passengerDraft } from './passenger-fixtures';
import { counterIds, customer, fakeSession, itinerary, searchResult, type FakeSession } from './utils';

/** Datos de ejemplo de la compra y de las reservas (UIO → GPS, 10-dic-2026, FP103). */
export const OFFER: Offer = searchResult().searchFlights.offers[0];
export const SEGMENT_ID = OFFER.itineraries[0].segments[0].segmentId;
export const ITINERARY_ID = OFFER.itineraries[0].itineraryId;
export const BACK = '/resultados?tipo=ida&tramos=UIO-GPS-2026-12-10&adultos=2';
export const signedIn = (): FakeSession => fakeSession({ status: 'authenticated', user: customer, expiresAt: null });

const seat = (seatNumber: string, status: SeatMapQuery['seatMap']['cabins'][number]['rows'][number]['seats'][number]['status'], characteristics: Array<'WINDOW' | 'AISLE'> = []) => ({ seatNumber, status, isAvailable: status === 'AVAILABLE', characteristics });
export function seatMap(segmentId = SEGMENT_ID): SeatMapQuery {
  return { seatMap: { segmentId, cabins: [{ cabinClass: 'ECONOMY', rows: [
    { rowNumber: 8, seats: [seat('8A', 'AVAILABLE', ['WINDOW']), seat('8B', 'AVAILABLE', ['AISLE']), seat('8C', 'AVAILABLE', ['AISLE']), seat('8D', 'AVAILABLE', ['WINDOW'])] },
    { rowNumber: 9, seats: [seat('9A', 'CHECKED_IN', ['WINDOW']), seat('9B', 'HELD', ['AISLE']), seat('9C', 'BOOKED', ['AISLE']), seat('9D', 'TICKETED', ['WINDOW'])] }
  ] }] } };
}

export const hold = (overrides: Partial<HoldQuery['hold']> = {}): HoldQuery => ({ hold: { holdId: 'h-1', status: 'HELD', expiresAt: '2026-12-01T15:10:00Z', remainingSeconds: 600, ttlMinutes: 10, lockedPrice: { currency: 'USD', total: '254.78', baseFare: '230.00', taxes: '24.78' }, ...overrides } });

/** Compra en curso: oferta elegida, 2 adultos, asientos 8A y 8B y (si se pide) el hold creado. */
export function startedPurchase(options: { withHold?: boolean; withPassengers?: boolean } = {}): { purchase: PurchaseStore; ids: () => string } {
  const ids = counterIds(); const purchase = new PurchaseStore(memoryStore(), new IntentBook(ids));
  purchase.start(OFFER, BACK, { adults: 2, youths: 0, children: 0, infants: 0 });
  purchase.setSeat(SEGMENT_ID, 0, '8A'); purchase.setSeat(SEGMENT_ID, 1, '8B');
  if (options.withHold) purchase.setHold({ holdId: 'h-1', signature: 'firma' });
  if (options.withPassengers) purchase.setDrafts(purchase.getState().drafts.map((draft, index) => passengerDraft(draft, index)));
  return { purchase, ids };
}

const itineraryFor = () => itinerary({ id: ITINERARY_ID, flight: 'FP103', from: 'UIO', to: 'GPS', departure: '2026-12-10T13:35:00Z', arrival: '2026-12-10T16:30:00Z', minutes: 175 });

export function booking(overrides: Partial<BookingFieldsFragment> = {}): BookingFieldsFragment {
  return {
    bookingId: 'b-1', pnr: 'ABC123', status: 'CONFIRMED', createdAt: '2026-12-01T15:00:00Z', updatedAt: null,
    availableActions: ['tickets', 'baggage-options', 'date-change-search', 'seats', 'check-in', 'boarding-passes', 'cancellation-quote', 'cancel'],
    grandTotal: { currency: 'USD', total: '254.78', baseFare: null, taxes: '24.78' }, itineraries: [itineraryFor()],
    passengers: [
      { passengerId: 'PAX-1', passengerType: 'ADULT', firstName: 'Ana', lastName: 'Pérez', documentType: 'NATIONAL_ID', documentNumberMasked: '******6789', nationality: 'EC', birthDate: '1990-01-01', gender: 'F', assignedSeats: [{ segmentId: SEGMENT_ID, seatNumber: '8A' }], extraBaggage: [] },
      { passengerId: 'PAX-2', passengerType: 'ADULT', firstName: 'Luis', lastName: 'Mora', documentType: 'NATIONAL_ID', documentNumberMasked: '******1234', nationality: 'EC', birthDate: '1988-05-05', gender: 'M', assignedSeats: [{ segmentId: SEGMENT_ID, seatNumber: '8B' }], extraBaggage: [] }
    ],
    tickets: [
      { ticketId: 't-1', passengerId: 'PAX-1', eTicketNumber: '1234567890123', status: 'ISSUED', issuedAt: '2026-12-01T15:01:00Z', failureReason: null, segments: [{ segmentId: SEGMENT_ID, status: 'OPEN', couponNumber: '1' }] },
      { ticketId: 't-2', passengerId: 'PAX-2', eTicketNumber: '1234567890124', status: 'ISSUED', issuedAt: '2026-12-01T15:01:00Z', failureReason: null, segments: [{ segmentId: SEGMENT_ID, status: 'OPEN', couponNumber: '1' }] }
    ],
    changes: [{ changedAt: '2026-12-01T15:01:00Z', description: 'Boletos emitidos' }],
    ...overrides
  };
}

export const passes = (): BoardingPassesQuery => ({ boardingPasses: [
  { passengerId: 'PAX-1', segmentId: SEGMENT_ID, seat: '8A', boardingGroup: '2', boardingPosition: '14', gate: 'A4', barcode: 'M1PEREZ/ANA ABC123 UIOGPS FP103 0345 8A', barcodeType: 'AZTEC' },
  { passengerId: 'PAX-2', segmentId: SEGMENT_ID, seat: '8B', boardingGroup: '2', boardingPosition: '15', gate: null, barcode: 'M1MORA/LUIS ABC123 UIOGPS FP103 0345 8B', barcodeType: 'AZTEC' }
] });
