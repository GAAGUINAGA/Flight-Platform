import { CabinClass } from './cabin';
import { InventoryError } from './errors';

export type HoldStatus = 'HELD' | 'RELEASED' | 'EXPIRED' | 'CONSUMED';

export interface HoldSegmentLine {
  flightInstanceId: string;
  cabinClass: CabinClass;
  seats: number;
}

export interface InventoryHoldProps {
  id: string;
  ownerId: string;
  status: HoldStatus;
  expiresAt: Date;
  idempotencyKey: string;
  lines: HoldSegmentLine[];
  /** Reserva que consumi? el hold (idempotencia de ConsumeHold). */
  reservationId?: string | null;
}

/**
 * M?quina de estados BL ?14.2:
 * HELD ? RELEASED | EXPIRED | CONSUMED; los dem?s estados son terminales.
 * `effectiveStatus` aplica el reloj: HELD con now >= expiresAt es EXPIRED.
 */
export class InventoryHold {
  constructor(private props: InventoryHoldProps) {}

  get id(): string { return this.props.id; }
  get ownerId(): string { return this.props.ownerId; }
  get status(): HoldStatus { return this.props.status; }
  get expiresAt(): Date { return this.props.expiresAt; }
  get idempotencyKey(): string { return this.props.idempotencyKey; }
  get lines(): readonly HoldSegmentLine[] { return this.props.lines; }
  get reservationId(): string | null { return this.props.reservationId ?? null; }

  isDue(now: Date): boolean {
    return this.props.status === 'HELD' && now >= this.props.expiresAt;
  }

  effectiveStatus(now: Date): HoldStatus {
    return this.isDue(now) ? 'EXPIRED' : this.props.status;
  }

  /** Marca EXPIRED. Solo v?lida desde un HELD vencido. */
  expire(now: Date): void {
    if (!this.isDue(now)) throw new InventoryError('OFFER_NO_LONGER_AVAILABLE');
    this.props = { ...this.props, status: 'EXPIRED' };
  }

  /**
   * Libera el hold. Devuelve true si cambi? de estado (y por tanto debe
   * restituirse capacidad). RELEASED/EXPIRED son idempotentes; CONSUMED falla.
   */
  release(now: Date): boolean {
    const status = this.effectiveStatus(now);
    if (status === 'CONSUMED') throw new InventoryError('OFFER_NO_LONGER_AVAILABLE');
    if (status !== 'HELD' && this.props.status !== 'HELD') return false;
    this.props = { ...this.props, status: this.isDue(now) ? 'EXPIRED' : 'RELEASED' };
    return true;
  }

  /** Reintento idempotente: el hold ya fue consumido por esta misma reserva. */
  isConsumedBy(reservationId: string): boolean {
    return this.props.status === 'CONSUMED' && this.props.reservationId === reservationId;
  }

  /** Consume el hold para una reserva. Falla si no est? HELD vigente. */
  consume(now: Date, reservationId: string): void {
    if (this.effectiveStatus(now) !== 'HELD') throw new InventoryError('OFFER_NO_LONGER_AVAILABLE');
    this.props = { ...this.props, status: 'CONSUMED', reservationId };
  }
}
