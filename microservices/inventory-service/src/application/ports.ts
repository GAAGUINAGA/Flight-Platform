import { CabinClass } from '../domain/cabin';
import { FlightInstance } from '../domain/flight-instance';
import { HoldStatus, InventoryHold } from '../domain/inventory-hold';

export interface PublicEvent {
  eventType: 'hold.expired';
  ownerId: string;
  holdId: string;
  occurredAt: Date;
  correlationId?: string;
  data: { status: 'EXPIRED' };
}

/** D-16: puerto de eventos p?blicos. Noop mientras Webhooks no est? desplegado. */
export interface EventPublisher {
  publish(event: PublicEvent): Promise<void>;
}

export type CapacityChange = 'hold' | 'release' | 'consume' | 'releaseSold';

export interface ExpiredHold { holdId: string; ownerId: string }

export interface ListFlightsQuery {
  from?: Date;
  to?: Date;
  cursor?: string;
  limit: number;
}

/** Lecturas de vuelos (sin bloqueo). */
export interface FlightReader {
  get(id: string): Promise<FlightInstance | null>;
  find(flightNumber: string, from: Date, to: Date): Promise<FlightInstance | null>;
  list(query: ListFlightsQuery): Promise<FlightInstance[]>;
  search(origin: string, destination: string, from: Date, to: Date): Promise<FlightInstance[]>;
  findByNumberAndDeparture(flightNumber: string, departureAt: Date): Promise<FlightInstance | null>;
}

/** Operaciones dentro de una transacci?n de base de datos. */
export interface InventoryTx {
  getFlights(ids: string[]): Promise<FlightInstance[]>;
  saveFlight(flight: FlightInstance): Promise<void>;
  setClosed(id: string): Promise<boolean>;
  /** UPDATE condicional: solo si sellable - held - sold >= seats y el vuelo no est? cerrado. */
  tryReserve(flightInstanceId: string, cabin: CabinClass, seats: number): Promise<boolean>;
  adjust(change: Exclude<CapacityChange, 'hold'>, flightInstanceId: string, cabin: CabinClass, seats: number): Promise<void>;
  /** B?squeda owner-scoped con bloqueo de fila. */
  findHold(id: string, ownerId: string): Promise<InventoryHold | null>;
  findHoldByKey(ownerId: string, key: string): Promise<InventoryHold | null>;
  insertHold(hold: InventoryHold): Promise<void>;
  /** Cambia el estado solo si el actual es `from` (y, opcionalmente, no vencido). */
  updateHoldStatus(hold: InventoryHold, from: HoldStatus, notExpiredAt?: Date): Promise<boolean>;
  lockDueHolds(now: Date, flightInstanceIds: string[] | undefined, limit: number): Promise<InventoryHold[]>;
  insertReserved(hold: InventoryHold): Promise<void>;
  /** Inventario vendido a?n no liberado de la reserva `ref` del owner, con bloqueo. */
  lockReserved(ref: string, ownerId: string): Promise<ReservedRow[]>;
  markReservedReleased(ids: string[], now: Date): Promise<void>;
}

export interface ReservedRow {
  id: string;
  flightInstanceId: string;
  cabinClass: CabinClass;
  seats: number;
}

export interface UnitOfWork {
  run<T>(fn: (tx: InventoryTx) => Promise<T>): Promise<T>;
}

export interface InventoryConfig {
  holdTtlMinutes: number;
  airlineCode: string;
}
