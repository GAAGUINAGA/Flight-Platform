import { describe, expect, it } from 'vitest';
import { OFFER, seatMap, ITINERARY_ID, SEGMENT_ID } from '../../test/purchase-fixtures';
import { passengerDraft } from '../../test/passenger-fixtures';
import { fromCents, multiplyAmount, sumAmounts, toCents } from './amounts';
import { buildPassengerInputs } from './booking-input';
import { baggageTotal, estimateTotal } from './pricing';
import { draftsFor } from './purchase-store';
import { aisleAfter, columnLetters, isSelectable, moveFocus, seatLabel } from './seat-map';
import { toFilter } from '../bookings/BookingsPage';

describe('importes sin coma flotante', () => {
  it('AMT-01 centavos enteros: 0.1 + 0.2 = 0.30 y los importes inválidos se detectan', () => {
    expect(sumAmounts(['0.10', '0.20'])).toEqual({ total: '0.30', valid: true });
    expect(sumAmounts(['127.39', '127.39', '35'])).toEqual({ total: '289.78', valid: true });
    expect(sumAmounts(['1.00', 'abc'])).toEqual({ total: '1.00', valid: false });
    expect(toCents('12.5')).toBe(1250); expect(toCents('-3.07')).toBe(-307); expect(toCents('1,5')).toBeNull(); expect(fromCents(5)).toBe('0.05');
    expect(multiplyAmount('35.00', 3)).toBe('105.00'); expect(multiplyAmount('35.00', -1)).toBeNull(); expect(multiplyAmount('x', 1)).toBeNull();
  });
  it('AMT-02 total estimado y equipaje: precio por tipo de pasajero × cantidad de cada tramo', () => {
    const selections = { [ITINERARY_ID]: { cabinClass: 'ECONOMY' as const, fareBrand: 'Light' } };
    expect(estimateTotal(OFFER, selections, { adults: 2, youths: 0, children: 0, infants: 0 })).toEqual({ currency: 'USD', total: '254.78' });
    expect(estimateTotal(OFFER, selections, { adults: 2, youths: 0, children: 0, infants: 1 })).toEqual({ currency: 'USD', total: '254.78' }); // el infante sin precio propio no suma
    expect(estimateTotal(OFFER, selections, { adults: 1, youths: 1, children: 0, infants: 0 })).toBeNull(); // falta el precio de «joven»: no inventa uno
    expect(estimateTotal(OFFER, {}, { adults: 1, youths: 0, children: 0, infants: 0 })).toBeNull();
    expect(baggageTotal(OFFER, selections, [{ [ITINERARY_ID]: 2 }, { [ITINERARY_ID]: 1 }])).toBe('105.00');
  });
});

describe('mapa de asientos sin pantalla', () => {
  const cabin = seatMap().seatMap.cabins[0];
  it('SMP-01 el estado va siempre en el nombre accesible, con las características del asiento', () => {
    const seats = cabin.rows.flatMap((row) => row.seats);
    const label = (n: string, by?: string) => seatLabel(seats.find((seat) => seat.seatNumber === n)!, by);
    expect(label('8A')).toBe('Asiento 8A, ventana, libre');
    expect(label('8B', 'Pasajero 2')).toBe('Asiento 8B, pasillo, elegido por Pasajero 2');
    expect(label('9A')).toBe('Asiento 9A, ventana, ocupado (con check-in)');
    expect(label('9B')).toBe('Asiento 9B, pasillo, apartado por otro viajero');
    expect(label('9C')).toBe('Asiento 9C, pasillo, ocupado'); expect(label('9D')).toBe('Asiento 9D, ventana, ocupado');
    expect(seats.filter(isSelectable).map((seat) => seat.seatNumber)).toEqual(['8A', '8B', '8C', '8D']);
  });
  it('SMP-02 columnas y pasillo; las flechas se mueven por la cuadrícula sin salirse', () => {
    expect(columnLetters(cabin)).toEqual(['A', 'B', 'C', 'D']);
    expect(aisleAfter(cabin.rows[0], 1)).toBe(true); expect(aisleAfter(cabin.rows[0], 0)).toBe(false); expect(aisleAfter(cabin.rows[0], 3)).toBe(false);
    expect(moveFocus(cabin, [0, 0], 'ArrowRight')).toEqual([0, 1]); expect(moveFocus(cabin, [0, 0], 'ArrowLeft')).toBeNull();
    expect(moveFocus(cabin, [0, 2], 'ArrowDown')).toEqual([1, 2]); expect(moveFocus(cabin, [1, 2], 'ArrowDown')).toBeNull(); expect(moveFocus(cabin, [0, 2], 'ArrowUp')).toBeNull();
    expect(moveFocus(cabin, [0, 2], 'Home')).toEqual([0, 0]); expect(moveFocus(cabin, [0, 1], 'End')).toEqual([0, 3]);
  });
});

describe('pasajeros de la reserva', () => {
  it('BKI-01 los asientos se reparten en el orden de la compra, los infantes no llevan asiento y el equipaje solo si es mayor que 0', () => {
    const drafts = draftsFor({ adults: 2, youths: 0, children: 0, infants: 1 }).map((draft, index) => ({ ...passengerDraft(draft, index), ...(draft.passengerType === 'INFANT' ? { associatedAdultId: 'PAX-1', birthDate: '2026-02-01' } : {}) }));
    drafts[0] = { ...drafts[0], extraBaggage: { [ITINERARY_ID]: 2 } }; drafts[1] = { ...drafts[1], extraBaggage: { [ITINERARY_ID]: 0 } };
    const result = buildPassengerInputs(drafts, [SEGMENT_ID], { [SEGMENT_ID]: ['8A', '8B'] });
    expect(result.map((passenger) => passenger.assignedSeats)).toEqual([[{ segmentId: SEGMENT_ID, seatNumber: '8A' }], [{ segmentId: SEGMENT_ID, seatNumber: '8B' }], undefined]);
    expect(result[0].extraBaggage).toEqual([{ itineraryId: ITINERARY_ID, quantity: 2 }]); expect(result[1].extraBaggage).toBeUndefined();
    expect(result[2]).toMatchObject({ passengerType: 'INFANT', associatedAdultId: 'PAX-1' }); expect(result[0].associatedAdultId).toBeUndefined();
    expect(result[0]).toMatchObject({ passengerId: 'PAX-1', contact: { email: 'ana@example.test', phone: '+593987654321' }, nationality: 'EC' });
  });
});

describe('filtros de mis reservas', () => {
  it('FLT-01 solo se envía lo que se escribió; el PNR se normaliza y los rangos se validan', () => {
    expect(toFilter({ pnr: '', status: '', createdFrom: '', createdTo: '' })).toEqual({ filter: null, errors: {} });
    expect(toFilter({ pnr: ' abc123 ', status: 'CONFIRMED', createdFrom: '2026-11-01', createdTo: '2026-11-30' })).toEqual({ filter: { pnr: 'ABC123', status: 'CONFIRMED', createdFrom: '2026-11-01', createdTo: '2026-11-30' }, errors: {} });
    expect(toFilter({ pnr: '??', status: '', createdFrom: '', createdTo: '' }).errors.pnr).toBeDefined();
    expect(toFilter({ pnr: '', status: '', createdFrom: '2026-12-01', createdTo: '2026-11-01' }).errors.createdTo).toBe('La fecha final no puede ser anterior a la inicial.');
    expect(toFilter({ pnr: '', status: '', createdFrom: '2026-02-30', createdTo: '' }).errors.createdFrom).toBeDefined();
  });
});
