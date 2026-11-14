import { describe, expect, it } from 'vitest';
import type { AdminFareFieldsFragment } from '@flight-platform/graphql-schema/generated/types';
import { isoToLocal, isLocalDateTime, localToIso, localToMs } from './airport-time';
import { cents, derivedBase, draftFromFare, fareChanges, normalizeAmount, toFareInput, validateFare } from './fare-rules';
import { summarize, takenSeats, cabinPercent, type OperationFlight } from './operations';
import { draftFromAgreement, emptyPromotion, parseDiscount, promotionChanges, splitList, toPromotionInput, validatePromotion } from './promotion-rules';
import { canTransition, confirmationMatches, confirmationNotes, emptyDraft, isIrreversible, statusSignature, targetsFrom, toStatusInput, validateStatus, type StatusContext } from './status-rules';

const context: StatusContext = { flightNumber: 'FP103', date: '2026-12-10', current: 'SCHEDULED', origin: 'UIO', destination: 'GYE', departureAt: '2026-12-10T08:35:00-05:00' };

describe('horas locales del aeropuerto', () => {
  it('ADM-T01 convierte la hora local de Quito, Galápagos y una zona con horario de verano a un instante con su desplazamiento', () => {
    expect(localToIso('2026-12-10T08:35', 'UIO')).toBe('2026-12-10T08:35:00-05:00');
    expect(localToIso('2026-12-10T08:35', 'GPS')).toBe('2026-12-10T08:35:00-06:00');
    expect(localToIso('2026-12-10T08:35', 'MAD')).toBe('2026-12-10T08:35:00+01:00'); // invierno
    expect(localToIso('2026-07-10T08:35', 'MAD')).toBe('2026-07-10T08:35:00+02:00'); // horario de verano
    expect(localToIso('2026-07-10T08:35', 'MIA')).toBe('2026-07-10T08:35:00-04:00');
    expect(localToIso('2026-12-10T08:35', 'XXX')).toBe('2026-12-10T08:35:00+00:00'); // sin zona: UTC, sin fallar
  });
  it('ADM-T02 es independiente de la zona del navegador y de ida y vuelta', () => {
    const iso = localToIso('2026-12-10T23:50', 'UIO')!;
    expect(Date.parse(iso)).toBe(Date.parse('2026-12-11T04:50:00Z'));
    expect(isoToLocal('2026-12-11T04:50:00Z', 'UIO')).toBe('2026-12-10T23:50');
    expect(isoToLocal(iso, 'UIO')).toBe('2026-12-10T23:50');
    expect(localToMs('2026-12-10T23:50', 'UIO')).toBe(Date.parse(iso));
  });
  it('ADM-T03 rechaza momentos inexistentes o mal formados', () => {
    for (const bad of ['', '2026-12-10', '2026-02-30T10:00', '2026-12-10T25:00', '2026-12-10T10:61', 'hoy']) { expect({ bad, ok: isLocalDateTime(bad) }).toEqual({ bad, ok: false }); expect(localToIso(bad, 'UIO')).toBeNull(); }
    expect(localToMs('x', 'UIO')).toBeNaN(); expect(isoToLocal('nada', 'UIO')).toBe('');
  });
});

describe('cambio de estado de un vuelo', () => {
  it('ADM-T04 las transiciones son las del Gateway (repetir el estado vale) y el formulario solo ofrece lo válido', () => {
    expect(canTransition('SCHEDULED', 'DELAYED')).toBe(true); expect(canTransition('SCHEDULED', 'SCHEDULED')).toBe(true); expect(canTransition('SCHEDULED', 'DEPARTED')).toBe(false);
    expect(canTransition('DELAYED', 'BOARDING')).toBe(true); expect(canTransition('DELAYED', 'SCHEDULED')).toBe(false);
    for (const final of ['ARRIVED', 'CANCELLED', 'DIVERTED'] as const) expect(canTransition(final, 'SCHEDULED')).toBe(false);
    expect(targetsFrom('SCHEDULED')).toEqual(['SCHEDULED', 'BOARDING', 'DELAYED', 'CANCELLED']);
    expect(targetsFrom('CANCELLED')).toEqual(['CANCELLED']);
    expect(targetsFrom(null)).toHaveLength(7);
  });
  it('ADM-T05 pasar a DELAYED o a CANCELLED es irreversible y exige escribir el número del vuelo (sin espacios ni mayúsculas)', () => {
    expect(isIrreversible('DELAYED')).toBe(true); expect(isIrreversible('CANCELLED')).toBe(true);
    for (const other of ['SCHEDULED', 'BOARDING', 'DEPARTED', 'ARRIVED', 'DIVERTED'] as const) expect(isIrreversible(other)).toBe(false);
    expect(confirmationMatches(' fp 103 ', 'FP103')).toBe(true); expect(confirmationMatches('FP10', 'FP103')).toBe(false); expect(confirmationMatches('', 'FP103')).toBe(false); expect(confirmationMatches('FP1033', 'FP103')).toBe(false);
  });
  it('ADM-T06 la confirmación dice que avisa a los socios (Booking) y a los clientes por los webhooks, y cuándo no se puede deshacer', () => {
    for (const status of ['SCHEDULED', 'BOARDING', 'DELAYED', 'CANCELLED'] as const) expect(confirmationNotes(status).notifies).toMatch(/socios \(Booking\) y a los clientes mediante los webhooks/);
    expect(confirmationNotes('CANCELLED').irreversible).toMatch(/No se puede deshacer/); expect(confirmationNotes('CANCELLED').irreversible).toMatch(/reservas afectadas/);
    expect(confirmationNotes('DELAYED').irreversible).toMatch(/no se puede deshacer/); expect(confirmationNotes('BOARDING').irreversible).toBeNull();
  });
  it('ADM-T07 valida antes de enviar: transición, hora estimada obligatoria y posterior a la programada, llegada posterior, puerta y motivo', () => {
    const ok = { ...emptyDraft('SCHEDULED'), status: 'DELAYED' as const };
    expect(validateStatus({ ...ok, estimatedDeparture: '' }, context).estimatedDeparture).toMatch(/necesita la nueva hora/);
    expect(validateStatus({ ...ok, estimatedDeparture: '2026-12-10T08:00' }, context).estimatedDeparture).toMatch(/posterior a la hora programada/);
    expect(validateStatus({ ...ok, estimatedDeparture: '2026-12-10T08:35' }, context).estimatedDeparture).toMatch(/posterior/); // igual a la programada
    expect(validateStatus({ ...ok, estimatedDeparture: '2026-12-10T09:10' }, context)).toEqual({});
    expect(validateStatus({ ...ok, estimatedDeparture: 'mañana' }, context).estimatedDeparture).toMatch(/válidas/);
    expect(validateStatus({ ...ok, estimatedDeparture: '2026-12-10T09:10', estimatedArrival: '2026-12-10T09:00' }, context).estimatedArrival).toMatch(/posterior a la salida/);
    expect(validateStatus({ ...ok, estimatedDeparture: '2026-12-10T09:10', estimatedArrival: '2026-12-10T10:10' }, context)).toEqual({});
    expect(validateStatus({ ...ok, estimatedDeparture: '2026-12-10T09:10', gate: 'A 12!' }, context).gate).toMatch(/8 letras/);
    expect(validateStatus({ ...ok, estimatedDeparture: '2026-12-10T09:10', reason: 'x'.repeat(201) }, context).reason).toMatch(/200/);
    expect(validateStatus({ ...emptyDraft(null) }, { ...context, current: null }).status).toMatch(/Elige el estado/);
    expect(validateStatus({ ...emptyDraft('CANCELLED'), status: 'SCHEDULED' }, { ...context, current: 'CANCELLED' }).status).toMatch(/no puede pasar a «programado»/);
  });
  it('ADM-T08 cancelar no exige horas; el desplazamiento de las estimadas viaja con cada aeropuerto; solo se envía lo escrito', () => {
    const cancel = { ...emptyDraft('SCHEDULED'), status: 'CANCELLED' as const, estimatedDeparture: 'basura', reason: ' Falla técnica ' };
    expect(validateStatus(cancel, context)).toEqual({});
    expect(toStatusInput(cancel, context)).toEqual({ date: '2026-12-10', status: 'CANCELLED', reason: 'Falla técnica' });
    const delay = { ...emptyDraft('SCHEDULED'), status: 'DELAYED' as const, estimatedDeparture: '2026-12-10T09:10', estimatedArrival: '2026-12-10T10:10', gate: ' a7 ' };
    expect(toStatusInput(delay, { ...context, destination: 'GPS' })).toEqual({ date: '2026-12-10', status: 'DELAYED', estimatedDepartureAt: '2026-12-10T09:10:00-05:00', estimatedArrivalAt: '2026-12-10T10:10:00-06:00', departureGate: 'A7' });
  });
  it('ADM-T09 la intención: los mismos datos del mismo vuelo comparten firma; otros datos, otra', () => {
    const a = toStatusInput({ ...emptyDraft('SCHEDULED'), status: 'BOARDING' }, context); const b = toStatusInput({ ...emptyDraft('SCHEDULED'), status: 'BOARDING', gate: 'B2' }, context);
    expect(statusSignature(a, 'FP103')).toBe(statusSignature({ ...a }, 'FP103')); expect(statusSignature(a, 'FP103')).not.toBe(statusSignature(b, 'FP103')); expect(statusSignature(a, 'FP103')).not.toBe(statusSignature(a, 'FP104'));
  });
});

const fare = (patch: Partial<AdminFareFieldsFragment> = {}): AdminFareFieldsFragment => ({
  fareId: 'f-1', flightInstanceId: 'fi-1', cabinClass: 'ECONOMY', fareBrand: 'LIGHT', price: { currency: 'USD', total: '127.39', baseFare: null, taxes: '12.00' },
  fareRules: { isRefundable: false, isChangeable: true }, baggageAllowance: { personalItemIncluded: true, carryOnIncluded: 1, checkedBaggageIncluded: 0 }, extraCheckedBaggagePrice: { currency: 'USD', total: '35.00', baseFare: null, taxes: null }, ...patch
});

describe('tarifas', () => {
  it('ADM-T10 los importes son cadenas con dos decimales; la coma se acepta y lo ambiguo se rechaza; se compara en centavos', () => {
    expect(normalizeAmount('12,5')).toBe('12.50'); expect(normalizeAmount(' 127.39 ')).toBe('127.39'); expect(normalizeAmount('9')).toBe('9.00'); expect(normalizeAmount('0.1')).toBe('0.10');
    for (const bad of ['', '-1', '1.234', '1e3', 'abc', '12,5,1', '12345678', '.5']) expect({ bad, v: normalizeAmount(bad) }).toEqual({ bad, v: null });
    expect(cents('127.39')).toBe(12739); expect(cents('0.10')).toBe(10); expect(cents('1.1')).toBe(110);
  });
  it('ADM-T10b el total es siempre tarifa base + tasas (Pricing): la base se DERIVA del total y de las tasas, sin coma flotante', () => {
    expect(derivedBase({ total: '225.00', taxes: '45.00' })).toBe('180.00'); expect(derivedBase({ total: '225,5', taxes: '' })).toBe('225.50'); expect(derivedBase({ total: '0.30', taxes: '0.10' })).toBe('0.20'); expect(derivedBase({ total: '100', taxes: '100' })).toBe('0.00');
    expect(derivedBase({ total: '10.00', taxes: '10.01' })).toBeNull(); expect(derivedBase({ total: 'x', taxes: '' })).toBeNull(); expect(derivedBase({ total: '10.00', taxes: 'x' })).toBeNull();
  });
  it('ADM-T11 valida antes de enviar: total mayor que cero, base y tasas sin superar al total, maletas 0–9, y la marca de una tarifa nueva', () => {
    const base = draftFromFare(fare());
    expect(validateFare(base)).toEqual({});
    expect(validateFare({ ...base, total: '' }).total).toMatch(/hasta dos decimales/); expect(validateFare({ ...base, total: '0.00' }).total).toMatch(/mayor que cero/);
    expect(validateFare({ ...base, taxes: '200.00' }).taxes).toMatch(/no pueden superarlo/); expect(validateFare({ ...base, taxes: 'x' }).taxes).toMatch(/tasas válidas/); expect(validateFare({ ...base, taxes: '' })).toEqual({});
    expect(validateFare({ ...base, extraBaggage: '' }).extraBaggage).toMatch(/maleta extra/); expect(validateFare({ ...base, extraBaggage: '0.00' })).toEqual({});
    expect(validateFare({ ...base, carryOnIncluded: '10' }).carryOnIncluded).toMatch(/0 a 9/); expect(validateFare({ ...base, checkedBaggageIncluded: '-1' }).checkedBaggageIncluded).toMatch(/0 a 9/);
    expect(validateFare(base, { cabinClass: '', fareBrand: '' })).toMatchObject({ cabinClass: expect.any(String), fareBrand: expect.any(String) });
    expect(validateFare(base, { cabinClass: 'BUSINESS', fareBrand: 'FLEX 1' })).toEqual({});
  });
  it('ADM-T12 la entrada conserva la clave natural y el fareId; USD; lo opcional solo si se escribió', () => {
    const base = draftFromFare(fare());
    const input = toFareInput({ ...base, total: '130,5' }, { flightInstanceId: 'fi-1', cabinClass: 'ECONOMY', fareBrand: 'LIGHT', fareId: 'f-1', currency: 'USD' });
    expect(input).toMatchObject({ fareId: 'f-1', flightInstanceId: 'fi-1', cabinClass: 'ECONOMY', fareBrand: 'LIGHT', price: { currency: 'USD', total: '130.50', baseFare: '118.50', taxes: '12.00' }, extraCheckedBaggagePrice: { currency: 'USD', total: '35.00' }, carryOnIncluded: 1, checkedBaggageIncluded: 0 });
    // Sin tasas solo viaja el total (Pricing toma base = total y tasas = 0); con tasas, base + tasas = total SIEMPRE.
    expect(toFareInput({ ...base, taxes: '' }, { flightInstanceId: 'fi-1', cabinClass: 'ECONOMY', fareBrand: 'LIGHT', currency: 'USD' }).price).toEqual({ currency: 'USD', total: '127.39' });
    expect(toFareInput(base, { flightInstanceId: 'fi-1', cabinClass: 'BUSINESS', fareBrand: ' FLEX ', currency: 'USD' })).not.toHaveProperty('fareId');
  });
  it('ADM-T13 el antes y el después muestran solo lo que cambia, con el importe total primero; sin cambios, nada', () => {
    const before = draftFromFare(fare()); const after = { ...before, total: '130.50', isChangeable: false };
    expect(fareChanges(before, after, 'USD')).toEqual([{ label: 'Importe total', before: 'USD 127,39', after: 'USD 130,50' }, { label: 'Tarifa base (total − tasas)', before: 'USD 115,39', after: 'USD 118,50' }, { label: 'Permite cambios', before: 'Sí', after: 'No' }]);
    expect(fareChanges(before, { ...before }, 'USD')).toEqual([]);
  });
});

const agreement = { allowsPromotions: true, maxDiscountPercent: 15, destinations: ['Quito'], routes: ['UIO-GYE'], cabins: ['ECONOMY' as const], validUntil: '2026-12-31', conditions: 'Combos', updatedAt: null };

describe('promociones', () => {
  it('ADM-T14 el descuento va de 0 a 100 (la coma se acepta); fuera de rango o no numérico se rechaza antes de enviar', () => {
    expect(parseDiscount('12,5')).toBe(12.5); expect(parseDiscount('100')).toBe(100); expect(parseDiscount('abc')).toBeNull(); expect(parseDiscount('')).toBeNull(); expect(parseDiscount('-3')).toBeNull();
    const ok = { ...emptyPromotion(), maxDiscountPercent: '15' };
    expect(validatePromotion(ok)).toEqual({}); expect(validatePromotion({ ...ok, maxDiscountPercent: '0' })).toEqual({}); expect(validatePromotion({ ...ok, maxDiscountPercent: '100' })).toEqual({});
    expect(validatePromotion({ ...ok, maxDiscountPercent: '100.5' }).maxDiscountPercent).toMatch(/entre 0 y 100/); expect(validatePromotion({ ...ok, maxDiscountPercent: '120' }).maxDiscountPercent).toMatch(/entre 0 y 100/);
    expect(validatePromotion({ ...ok, maxDiscountPercent: '' }).maxDiscountPercent).toMatch(/porcentaje/);
  });
  it('ADM-T15 valida rutas, destinos, vigencia y condiciones; las rutas se normalizan a mayúsculas', () => {
    const ok = { ...emptyPromotion(), maxDiscountPercent: '10' };
    expect(validatePromotion({ ...ok, routes: 'uio-gye, GYE-UIO' })).toEqual({}); expect(validatePromotion({ ...ok, routes: 'UIO GYE' }).routes).toMatch(/UIO-GYE/); expect(validatePromotion({ ...ok, routes: 'UIO-GYEX' }).routes).toBeDefined();
    expect(validatePromotion({ ...ok, destinations: 'x'.repeat(61) }).destinations).toMatch(/60/); expect(validatePromotion({ ...ok, validUntil: '2026-02-30' }).validUntil).toMatch(/válida/); expect(validatePromotion({ ...ok, conditions: 'x'.repeat(501) }).conditions).toMatch(/500/);
    expect(splitList('UIO-GYE, GYE-UIO;\nCUE-UIO ,,')).toEqual(['UIO-GYE', 'GYE-UIO', 'CUE-UIO']);
  });
  it('ADM-T16 la entrada y el antes/después: lo que cambia; sin acuerdo previo, todo es nuevo', () => {
    const before = draftFromAgreement(agreement); const after = { ...before, maxDiscountPercent: '20', routes: 'uio-gye, gye-uio' };
    expect(toPromotionInput(after)).toEqual({ allowsPromotions: true, maxDiscountPercent: 20, destinations: ['Quito'], routes: ['UIO-GYE', 'GYE-UIO'], cabins: ['ECONOMY'], validUntil: '2026-12-31', conditions: 'Combos' });
    expect(promotionChanges(before, after)).toEqual([{ label: 'Descuento máximo', before: '15 %', after: '20 %' }, { label: 'Rutas', before: 'UIO-GYE', after: 'UIO-GYE, GYE-UIO' }]);
    expect(promotionChanges(before, { ...before })).toEqual([]);
    expect(promotionChanges(null, { ...emptyPromotion(), maxDiscountPercent: '10' }).map((change) => change.label)).toContain('Descuento máximo');
    expect(toPromotionInput({ ...emptyPromotion(), maxDiscountPercent: '10' })).toEqual({ allowsPromotions: true, maxDiscountPercent: 10, destinations: [], routes: [], cabins: [] });
  });
});

const flight = (patch: Partial<OperationFlight>): OperationFlight => ({
  flightNumber: 'FP103', date: '2026-12-10', origin: 'UIO', destination: 'GYE', departureAt: '2026-12-10T13:35:00Z', status: 'SCHEDULED', aircraft: 'A320', totalSeats: 200, loadFactor: 0, activeHolds: 2, nextHoldExpiryAt: null, checkInOpen: false, alerts: [],
  cabins: [
    { cabinClass: 'ECONOMY', totalSeats: 150, seatsByStatus: { AVAILABLE: 75, HELD: 5, BOOKED: 0, TICKETED: 70, CHECKED_IN: 0, BOARDED: 0 } },
    { cabinClass: 'BUSINESS', totalSeats: 50, seatsByStatus: { AVAILABLE: 50, HELD: 0, BOOKED: 0, TICKETED: 0, CHECKED_IN: 0, BOARDED: 0 } }
  ], ...patch
});

describe('resumen del dashboard', () => {
  it('ADM-T17 la ocupación se calcula por cabina y la media se pondera por asientos (no es un promedio de promedios)', () => {
    const f = flight({}); expect(takenSeats(f.cabins[0])).toBe(75); expect(cabinPercent(f.cabins[0])).toBe(50); expect(cabinPercent(f.cabins[1])).toBe(0);
    const small = flight({ flightNumber: 'FP200', activeHolds: 1, cabins: [{ cabinClass: 'ECONOMY', totalSeats: 10, seatsByStatus: { AVAILABLE: 0, HELD: 0, BOOKED: 0, TICKETED: 10, CHECKED_IN: 0, BOARDED: 0 } }], alerts: [{ code: 'LOW_AVAILABILITY', severity: 'CRITICAL', message: null }, { code: 'CHECKIN_OPEN', severity: 'INFO', message: null }] });
    // (75 + 10) / (200 + 10) = 40,5 % → 40; el promedio de 37,5 % y 100 % daría 69.
    expect(summarize([flight({}), small])).toEqual({ flights: 2, averageOccupancy: 40, activeHolds: 3, alerts: 1 });
    expect(summarize([])).toEqual({ flights: 0, averageOccupancy: 0, activeHolds: 0, alerts: 0 });
  });
});
