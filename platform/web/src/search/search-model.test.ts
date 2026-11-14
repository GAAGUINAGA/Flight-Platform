import { describe, expect, it } from 'vitest';
import { availableCabins, cheapestOption, selectOffers, stopsLabel } from './offers';
import { fromSearchParams, legsForTrip, passengersLabel, toSearchInput, toSearchParams, validateSearch, type SearchCriteria } from './search-model';
import { safeReturnTo, loginPath } from '../session/return-to';
import { searchResult } from '../../test/utils';

const NOW = new Date('2026-12-01T15:00:00Z'); // 10:00 del 1-dic en Quito
const base = (patch: Partial<SearchCriteria> = {}): SearchCriteria => ({ trip: 'ida', legs: [{ origin: 'UIO', destination: 'GPS', date: '2026-12-10' }], passengers: { adults: 1, youths: 0, children: 0, infants: 0 }, cabin: null, ...patch });

describe('modelo de búsqueda', () => {
  it('BUS-01 una búsqueda válida no tiene errores (ida, ida y vuelta y multidestino)', () => {
    expect(validateSearch(base(), NOW)).toEqual({});
    expect(validateSearch(base({ trip: 'idavuelta', legs: [{ origin: 'UIO', destination: 'GPS', date: '2026-12-10' }, { origin: 'GPS', destination: 'UIO', date: '2026-12-10' }] }), NOW)).toEqual({});
    expect(validateSearch(base({ trip: 'multi', legs: [{ origin: 'UIO', destination: 'GYE', date: '2026-12-10' }, { origin: 'GYE', destination: 'GPS', date: '2026-12-12' }, { origin: 'GPS', destination: 'UIO', date: '2026-12-20' }] }), NOW)).toEqual({});
  });

  it('BUS-02 origen = destino, aeropuerto desconocido y fecha ausente', () => {
    expect(validateSearch(base({ legs: [{ origin: 'UIO', destination: 'UIO', date: '2026-12-10' }] }), NOW)).toEqual({ 'legs.0.destination': 'El destino debe ser distinto del origen.' });
    expect(Object.keys(validateSearch(base({ legs: [{ origin: 'ZZZ', destination: '', date: '' }] }), NOW))).toEqual(['legs.0.origin', 'legs.0.destination', 'legs.0.date']);
  });

  it('BUS-03 la fecha mínima es HOY en la zona del aeropuerto de origen, no la del dispositivo', () => {
    // 03:00 UTC del 11-dic: en Quito todavía es 10-dic; en Madrid ya es 11-dic.
    const now = new Date('2026-12-11T03:00:00Z');
    expect(validateSearch(base({ legs: [{ origin: 'UIO', destination: 'GPS', date: '2026-12-10' }] }), now)).toEqual({});
    expect(validateSearch(base({ legs: [{ origin: 'MAD', destination: 'UIO', date: '2026-12-10' }] }), now)).toEqual({ 'legs.0.date': 'La fecha ya pasó en el aeropuerto de origen.' });
    expect(validateSearch(base({ legs: [{ origin: 'UIO', destination: 'GPS', date: '2026-12-09' }] }), now)['legs.0.date']).toBeDefined();
  });

  it('BUS-04 la vuelta no puede ser anterior a la ida y los tramos van en orden', () => {
    expect(validateSearch(base({ trip: 'idavuelta', legs: [{ origin: 'UIO', destination: 'GPS', date: '2026-12-10' }, { origin: 'GPS', destination: 'UIO', date: '2026-12-09' }] }), NOW)).toEqual({ 'legs.1.date': 'La vuelta no puede ser anterior a la ida.' });
    expect(validateSearch(base({ trip: 'multi', legs: [{ origin: 'UIO', destination: 'GYE', date: '2026-12-10' }, { origin: 'GYE', destination: 'GPS', date: '2026-12-08' }] }), NOW)['legs.1.date']).toBe('Este tramo no puede ser anterior al tramo previo.');
    const seven = Array.from({ length: 7 }, () => ({ origin: 'UIO', destination: 'GYE', date: '2026-12-10' }));
    expect(validateSearch(base({ trip: 'multi', legs: seven }), NOW).legs).toBe('Elige entre 1 y 6 tramos.');
  });

  it('BUS-05 pasajeros: al menos un adulto, un infante por adulto y máximo 9', () => {
    const passengers = (adults: number, youths: number, children: number, infants: number) => validateSearch(base({ passengers: { adults, youths, children, infants } }), NOW).passengers;
    expect(passengers(0, 1, 0, 0)).toBe('Debe viajar al menos un adulto.');
    expect(passengers(1, 0, 0, 2)).toBe('Cada infante debe viajar con un adulto.');
    expect(passengers(5, 3, 2, 0)).toBe('Puedes buscar hasta 9 pasajeros.');
    expect(passengers(4, 2, 2, 1)).toBeUndefined();
    expect(passengers(1.5, 0, 0, 0)).toBe('Revisa la cantidad de pasajeros.');
    expect(passengersLabel({ adults: 2, youths: 0, children: 1, infants: 1 })).toBe('2 adultos, 1 niño, 1 infante');
  });

  it('BUS-06 la URL de resultados va y vuelve sin pérdida y solo lleva códigos, fechas y cantidades', () => {
    const criteria = base({ trip: 'idavuelta', legs: [{ origin: 'UIO', destination: 'GPS', date: '2026-12-10' }, { origin: 'GPS', destination: 'UIO', date: '2026-12-17' }], passengers: { adults: 2, youths: 0, children: 1, infants: 1 }, cabin: 'BUSINESS' });
    const params = toSearchParams(criteria);
    expect(params.toString()).toBe('tipo=idavuelta&tramos=UIO-GPS-2026-12-10%2CGPS-UIO-2026-12-17&adultos=2&ninos=1&infantes=1&cabina=BUSINESS');
    expect(fromSearchParams(params)).toEqual(criteria);
    expect(toSearchInput(criteria)).toEqual({ itineraries: [{ origin: 'UIO', destination: 'GPS', departureDate: '2026-12-10' }, { origin: 'GPS', destination: 'UIO', departureDate: '2026-12-17' }], passengers: { adults: 2, youths: 0, children: 1, infants: 1 } });
  });

  it('BUS-07 una URL manipulada o incompleta no produce una búsqueda', () => {
    const parse = (query: string) => fromSearchParams(new URLSearchParams(query));
    expect(parse('')).toBeNull();
    expect(parse('tipo=ida')).toBeNull();
    expect(parse('tipo=otro&tramos=UIO-GPS-2026-12-10')).toBeNull();
    expect(parse('tipo=ida&tramos=uio-gps-2026-12-10')).toBeNull();
    expect(parse('tipo=ida&tramos=UIO-GPS-2026-12-10,GPS-UIO-2026-12-11')).toBeNull();
    expect(parse('tipo=idavuelta&tramos=UIO-GPS-2026-12-10')).toBeNull();
    expect(parse('tipo=ida&tramos=UIO-GPS-<script>')).toBeNull();
    expect(parse('tipo=ida&tramos=UIO-GPS-2026-12-10&adultos=abc&cabina=LUJO')).toMatchObject({ passengers: { adults: 1 }, cabin: null });
  });

  it('BUS-08 cambiar el tipo de viaje conserva lo elegido', () => {
    const legs = [{ origin: 'UIO', destination: 'GPS', date: '2026-12-10' }];
    expect(legsForTrip('idavuelta', legs)).toEqual([legs[0], { origin: 'GPS', destination: 'UIO', date: '' }]);
    expect(legsForTrip('multi', legs)).toEqual([legs[0], { origin: 'GPS', destination: '', date: '' }]);
    expect(legsForTrip('ida', [...legs, { origin: 'GPS', destination: 'UIO', date: '2026-12-17' }])).toEqual(legs);
  });
});

describe('ofertas · filtros y orden en el cliente (H-10)', () => {
  const offers = searchResult().searchFlights.offers;
  const ids = (list: typeof offers) => list.map((offer) => offer.offerId);

  it('OFE-01 orden por precio (exacto, sin flotantes) y por hora de salida, sin modificar la lista original', () => {
    const shuffled = [offers[2], offers[0], offers[1]];
    expect(ids(selectOffers(shuffled, { directOnly: false, cabin: null }, 'price'))).toEqual(['of-1', 'of-2', 'of-3']);
    expect(ids(selectOffers(shuffled, { directOnly: false, cabin: null }, 'departure'))).toEqual(['of-3', 'of-1', 'of-2']);
    expect(ids(shuffled)).toEqual(['of-3', 'of-1', 'of-2']);
  });

  it('OFE-02 solo directos y cabina; los filtros se combinan', () => {
    expect(ids(selectOffers(offers, { directOnly: true, cabin: null }, 'price'))).toEqual(['of-1', 'of-2']);
    expect(ids(selectOffers(offers, { directOnly: false, cabin: 'BUSINESS' }, 'price'))).toEqual(['of-2']);
    expect(ids(selectOffers(offers, { directOnly: true, cabin: 'FIRST' }, 'price'))).toEqual([]);
    expect(availableCabins(offers).sort()).toEqual(['BUSINESS', 'ECONOMY']);
  });

  it('OFE-03 la tarifa más económica del tramo, también dentro de una cabina', () => {
    const itinerary = offers[1].itineraries[0];
    expect(cheapestOption(itinerary)?.fareBrand).toBe('Standard');
    expect(cheapestOption(itinerary, 'BUSINESS')?.fareBrand).toBe('Flex');
    expect(cheapestOption(itinerary, 'FIRST')).toBeNull();
    expect([stopsLabel(0), stopsLabel(1), stopsLabel(2)]).toEqual(['Directo', '1 escala', '2 escalas']);
  });
});

describe('returnTo · solo rutas internas', () => {
  it('RET-01 acepta rutas internas con su consulta', () => {
    expect(safeReturnTo('/resultados?tipo=ida&tramos=UIO-GPS-2026-12-10')).toBe('/resultados?tipo=ida&tramos=UIO-GPS-2026-12-10');
    expect(safeReturnTo('/oferta/abc')).toBe('/oferta/abc');
    expect(loginPath('/oferta/abc')).toBe('/acceso?returnTo=%2Foferta%2Fabc');
    expect(loginPath('/')).toBe('/acceso');
  });

  it('RET-02 rechaza todo lo que saldría de la app o volvería a una pantalla de acceso', () => {
    for (const value of ['https://malo.example/robo', '//malo.example', '/\\malo.example', 'javascript:alert(1)', 'malo', '', null, undefined, '/\tmalo', '/acceso', '/acceso/retorno?code=1', '/registro', '/sesion-expirada']) {
      expect(safeReturnTo(value)).toBe('/');
    }
    expect(loginPath('https://malo.example')).toBe('/acceso');
  });
});
