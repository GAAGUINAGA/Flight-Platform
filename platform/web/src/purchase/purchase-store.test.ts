import { describe, expect, it } from 'vitest';
import { counterIds } from '../../test/utils';
import { BACK, ITINERARY_ID, OFFER, SEGMENT_ID } from '../../test/purchase-fixtures';
import { memoryStore } from '../data/identity';
import { IntentBook } from './intent';
import { PurchaseStore, draftsFor, seatedCount } from './purchase-store';

const make = (storage = memoryStore()) => ({ storage, store: new PurchaseStore(storage, new IntentBook(counterIds())) });
const COUNTS = { adults: 2, youths: 0, children: 1, infants: 1 };

describe('estado de la compra en curso', () => {
  it('CMP-01 empezar con una oferta elige la primera tarifa de cada tramo y arma los pasajeros en el orden de la compra', () => {
    const { store } = make(); store.start(OFFER, BACK, COUNTS);
    const state = store.getState();
    expect(state.selections[ITINERARY_ID]).toEqual({ cabinClass: 'ECONOMY', fareBrand: 'Light' });
    expect(state.drafts.map((draft) => [draft.passengerId, draft.passengerType])).toEqual([['PAX-1', 'ADULT'], ['PAX-2', 'ADULT'], ['PAX-3', 'CHILD'], ['PAX-4', 'INFANT']]);
    expect(seatedCount(COUNTS)).toBe(3); expect(draftsFor({ adults: 1, youths: 1, children: 0, infants: 0 }).map((draft) => draft.passengerType)).toEqual(['ADULT', 'YOUTH']);
  });

  it('CMP-02 asignar un asiento ya elegido por otra persona se lo quita; liberar y borrar la cola', () => {
    const { store } = make(); store.start(OFFER, BACK, COUNTS);
    store.setSeat(SEGMENT_ID, 0, '8A'); store.setSeat(SEGMENT_ID, 1, '8B');
    expect(store.getState().seats[SEGMENT_ID]).toEqual(['8A', '8B']);
    store.setSeat(SEGMENT_ID, 1, '8A'); expect(store.getState().seats[SEGMENT_ID]).toEqual(['', '8A']);
    store.setSeat(SEGMENT_ID, 2, '8C'); store.clearSeat(SEGMENT_ID, '8C'); expect(store.getState().seats[SEGMENT_ID]).toEqual(['', '8A']);
    store.setSeat(SEGMENT_ID, 1, null); expect(store.getState().seats[SEGMENT_ID]).toEqual([]);
  });

  it('CMP-03 cambiar de tarifa (otra cabina) descarta los asientos del tramo; elegir la misma no cambia nada', () => {
    const { store } = make(); store.start(OFFER, BACK, COUNTS); store.setSeat(SEGMENT_ID, 0, '8A');
    store.selectFare(ITINERARY_ID, { cabinClass: 'ECONOMY', fareBrand: 'Light' }); expect(store.getState().seats[SEGMENT_ID]).toEqual(['8A']);
    store.selectFare(ITINERARY_ID, { cabinClass: 'BUSINESS', fareBrand: 'Flex' }); expect(store.getState().seats[SEGMENT_ID]).toBeUndefined();
  });

  it('CMP-04 la selección sobrevive a una recarga, pero los datos de los pasajeros NUNCA se guardan en el almacenamiento (§3.0)', () => {
    const { storage, store } = make(); store.start(OFFER, BACK, COUNTS); store.setSeat(SEGMENT_ID, 0, '8A'); store.setHold({ holdId: 'h-1', signature: 's' });
    store.setDrafts(store.getState().drafts.map((draft) => ({ ...draft, firstName: 'Ana', documentNumber: '1712345678', email: 'ana@example.test', phone: '+593987654321' }))); store.setHolder('Ana Pérez');
    const saved = storage.getItem('fp.purchase')!;
    for (const secret of ['1712345678', 'ana@example.test', '+593987654321', 'Ana', 'Pérez', 'documentNumber']) expect(saved).not.toContain(secret);
    expect(Object.keys(JSON.parse(saved) as object).sort()).toEqual(['back', 'correlationId', 'counts', 'hold', 'offer', 'seats', 'selections']);

    const reloaded = new PurchaseStore(storage).getState();
    expect(reloaded.offer?.offerId).toBe('of-1'); expect(reloaded.seats[SEGMENT_ID]).toEqual(['8A']); expect(reloaded.hold?.holdId).toBe('h-1'); expect(reloaded.back).toBe(BACK);
    expect(reloaded.drafts.map((draft) => draft.firstName)).toEqual(['', '', '', '']); // pasajeros vacíos: lo escrito no se recupera de disco
  });

  it('CMP-05 una sesión que vence y se reabre no pierde lo escrito: el almacén vive en la app, no en la pantalla', () => {
    const { store } = make(); store.start(OFFER, BACK, COUNTS);
    store.setDrafts(store.getState().drafts.map((draft, index) => (index === 0 ? { ...draft, firstName: 'Ana' } : draft)));
    expect(store.getState().drafts[0].firstName).toBe('Ana'); // lo que ve la pantalla al volver tras iniciar sesión de nuevo
  });

  it('CMP-06 el correlationId de la compra es uno solo; terminar la compra borra todo, incluidos los pasajeros', () => {
    const { storage, store } = make(); store.start(OFFER, BACK, COUNTS);
    const first = store.correlationId(() => 'corr-A'); expect(store.correlationId(() => 'corr-B')).toBe(first);
    store.reset(); expect(storage.getItem('fp.purchase')).toBeNull(); expect(store.getState().offer).toBeNull(); expect(store.getState().drafts).toEqual([]);
    store.start(OFFER, BACK, COUNTS); expect(store.correlationId(() => 'corr-C')).toBe('corr-C'); // la compra nueva abre su propia correlación
  });

  it('CMP-07 un almacenamiento corrupto o ausente deja una compra vacía sin lanzar', () => {
    const storage = memoryStore(); storage.setItem('fp.purchase', '{no es json');
    expect(new PurchaseStore(storage).getState().offer).toBeNull();
    storage.setItem('fp.purchase', JSON.stringify({ offer: { sinId: true } })); expect(new PurchaseStore(storage).getState().offer).toBeNull();
    const broken = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); }, removeItem: () => undefined };
    const store = new PurchaseStore(broken); store.start(OFFER, BACK, COUNTS); expect(store.getState().offer?.offerId).toBe('of-1');
  });

  it('CMP-08 elegir otra oferta empieza de cero (asientos, hold e intenciones); elegir la misma conserva lo hecho', () => {
    const { store } = make(); store.start(OFFER, BACK, COUNTS); store.setSeat(SEGMENT_ID, 0, '8A'); store.setHold({ holdId: 'h-1', signature: 's' }); store.intents.begin('hold', 'x');
    store.start(OFFER, '/otra', COUNTS); expect(store.getState().seats[SEGMENT_ID]).toEqual(['8A']); expect(store.getState().back).toBe('/otra');
    store.start({ ...OFFER, offerId: 'of-9' }, BACK, COUNTS);
    expect(store.getState().seats).toEqual({}); expect(store.getState().hold).toBeNull(); expect(store.intents.has('hold')).toBe(false);
  });
});
