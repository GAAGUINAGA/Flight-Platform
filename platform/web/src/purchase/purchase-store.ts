import type { CabinClass, SearchFlightsQuery } from '@flight-platform/graphql-schema/generated/types';
import type { KeyValueStore } from '../data/identity';
import { IntentBook } from './intent';
import { emptyPassenger, TYPE_ORDER, type PassengerDraft } from './passenger-rules';

/**
 * Estado de la compra en curso (oferta elegida, tarifa, asientos, hold y datos de los pasajeros). Sin React ni DOM.
 *   - La selección (oferta, tarifa, asientos, hold) NO es personal: se guarda en el almacenamiento de la pestaña para sobrevivir a una recarga.
 *   - Los datos de los pasajeros (documentos, contacto) viven SOLO en memoria (diseño §3.0): nunca en el almacenamiento del navegador.
 *     Como la memoria es de la app y no de la pantalla, una sesión vencida y un nuevo inicio de sesión no pierden lo escrito.
 */
export type Offer = SearchFlightsQuery['searchFlights']['offers'][number];
export interface PassengerCounts { adults: number; youths: number; children: number; infants: number }
export interface FareSelection { cabinClass: CabinClass; fareBrand: string }
export interface HoldRef { holdId: string; /** Firma de la selección con que se creó: si cambia, hay que crear otro. */ signature: string }

export interface PurchaseState {
  offer: Offer | null;
  /** Resultados de donde se vino (con los criterios de búsqueda), para volver sin perderlos. */
  back: string | null;
  counts: PassengerCounts;
  selections: Record<string, FareSelection>;
  /** segmentId → asientos elegidos, en el orden de los pasajeros con asiento. */
  seats: Record<string, string[]>;
  hold: HoldRef | null;
  /** Identificador de correlación de ESTA compra: lo comparten el hold y la reserva. */
  correlationId: string | null;
  drafts: PassengerDraft[];
  holder: string;
}

const KEY = 'fp.purchase';
const EMPTY_COUNTS: PassengerCounts = { adults: 1, youths: 0, children: 0, infants: 0 };
const initial = (): PurchaseState => ({ offer: null, back: null, counts: EMPTY_COUNTS, selections: {}, seats: {}, hold: null, correlationId: null, drafts: [], holder: '' });

type Persisted = Pick<PurchaseState, 'offer' | 'back' | 'counts' | 'selections' | 'seats' | 'hold' | 'correlationId'>;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function restore(storage: KeyValueStore): PurchaseState {
  try {
    const raw = storage.getItem(KEY); if (!raw) return initial();
    const data = JSON.parse(raw) as unknown; if (!isRecord(data) || !isRecord(data.offer) || typeof data.offer.offerId !== 'string') return initial();
    const saved = data as unknown as Persisted;
    const counts = isRecord(saved.counts) ? { ...EMPTY_COUNTS, ...saved.counts } : EMPTY_COUNTS;
    return { ...initial(), drafts: draftsFor(counts), offer: saved.offer, back: typeof saved.back === 'string' ? saved.back : null, counts, selections: isRecord(saved.selections) ? saved.selections as PurchaseState['selections'] : {}, seats: isRecord(saved.seats) ? saved.seats as PurchaseState['seats'] : {}, hold: isRecord(saved.hold) && typeof saved.hold.holdId === 'string' ? saved.hold as unknown as HoldRef : null, correlationId: typeof saved.correlationId === 'string' ? saved.correlationId : null };
  } catch { return initial(); }
}

export const seatedCount = (counts: PassengerCounts): number => counts.adults + counts.youths + counts.children;
export const totalCount = (counts: PassengerCounts): number => seatedCount(counts) + counts.infants;

/** Pasajeros vacíos en el orden de la compra: adultos, jóvenes, niños e infantes. */
export function draftsFor(counts: PassengerCounts): PassengerDraft[] {
  const per = { ADULT: counts.adults, YOUTH: counts.youths, CHILD: counts.children, INFANT: counts.infants } as const;
  let n = 0;
  return TYPE_ORDER.flatMap((type) => Array.from({ length: per[type] }, () => { n += 1; return emptyPassenger(`PAX-${n}`, type); }));
}

export class PurchaseStore {
  private state: PurchaseState;
  private readonly listeners = new Set<() => void>();
  /** Intenciones de la compra y de la postventa (claves de idempotencia). Solo en memoria. */
  readonly intents: IntentBook;

  constructor(private readonly storage: KeyValueStore, intents: IntentBook = new IntentBook()) { this.state = restore(storage); this.intents = intents; }

  getState = (): PurchaseState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private set(next: PurchaseState): void {
    this.state = next;
    const { offer, back, counts, selections, seats, hold, correlationId } = next;
    try {
      if (offer) this.storage.setItem(KEY, JSON.stringify({ offer, back, counts, selections, seats, hold, correlationId } satisfies Persisted)); else this.storage.removeItem(KEY);
    } catch { /* sin almacenamiento: la compra sigue en memoria */ }
    for (const listener of this.listeners) listener();
  }

  /** Empieza una compra con la oferta elegida. Elegir la misma oferta de nuevo conserva lo ya hecho. */
  start(offer: Offer, back: string | null, counts: PassengerCounts): void {
    if (this.state.offer?.offerId === offer.offerId) { this.set({ ...this.state, back: back ?? this.state.back }); return; }
    const selections: Record<string, FareSelection> = {};
    for (const itinerary of offer.itineraries) {
      const first = itinerary.pricingOptions[0];
      if (first) selections[itinerary.itineraryId] = { cabinClass: first.cabinClass, fareBrand: first.fareBrand };
    }
    this.intents.clear();
    this.set({ ...initial(), offer, back, counts, selections, drafts: draftsFor(counts) });
  }

  selectFare(itineraryId: string, selection: FareSelection): void {
    const current = this.state.selections[itineraryId];
    if (current && current.cabinClass === selection.cabinClass && current.fareBrand === selection.fareBrand) return;
    // Cambiar de tarifa cambia de cabina: los asientos elegidos ya no valen.
    const seats = { ...this.state.seats };
    const itinerary = this.state.offer?.itineraries.find((entry) => entry.itineraryId === itineraryId);
    for (const segment of itinerary?.segments ?? []) delete seats[segment.segmentId];
    this.set({ ...this.state, selections: { ...this.state.selections, [itineraryId]: selection }, seats });
  }

  /** Asigna (o libera con `null`) el asiento de la persona `index` (entre las que ocupan asiento) en un tramo. */
  setSeat(segmentId: string, index: number, seatNumber: string | null): void {
    const row = [...(this.state.seats[segmentId] ?? [])];
    while (row.length < index) row.push('');
    if (seatNumber === null) row[index] = ''; else {
      const other = row.indexOf(seatNumber); if (other >= 0 && other !== index) row[other] = '';
      row[index] = seatNumber;
    }
    while (row.length > 0 && row[row.length - 1] === '') row.pop();
    this.set({ ...this.state, seats: { ...this.state.seats, [segmentId]: row } });
  }

  clearSeat(segmentId: string, seatNumber: string): void {
    const row = (this.state.seats[segmentId] ?? []).map((seat) => (seat === seatNumber ? '' : seat));
    while (row.length > 0 && row[row.length - 1] === '') row.pop();
    this.set({ ...this.state, seats: { ...this.state.seats, [segmentId]: row } });
  }

  /** El identificador de correlación de la compra: se crea con el primer uso y lo comparten hold y reserva. */
  correlationId(create: () => string): string {
    if (this.state.correlationId) return this.state.correlationId;
    const id = create(); this.set({ ...this.state, correlationId: id }); return id;
  }

  setHold(hold: HoldRef | null): void { this.set({ ...this.state, hold }); }
  setDrafts(drafts: PassengerDraft[]): void { this.set({ ...this.state, drafts }); }
  setHolder(holder: string): void { this.set({ ...this.state, holder }); }

  /** Termina la compra (reserva creada o abandonada): borra todo, incluidos los datos de los pasajeros. */
  reset(): void { this.intents.clear(); this.set(initial()); }
}
