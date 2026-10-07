import { CabinCapacity } from './cabin-capacity';
import { InventoryError } from './errors';

export interface FlightInstanceProps {
  id: string;
  flightNumber: string;
  departureIata: string;
  arrivalIata: string;
  departureAt: Date;
  arrivalAt: Date;
  aircraft?: string | null;
  closed: boolean;
  cabins: CabinCapacity[];
}

export class FlightInstance {
  constructor(public readonly props: FlightInstanceProps) {
    if (props.arrivalAt <= props.departureAt || props.departureIata === props.arrivalIata) {
      throw new InventoryError('VALIDATION_FAILED');
    }
    if (new Set(props.cabins.map((c) => c.cabinClass)).size !== props.cabins.length) {
      throw new InventoryError('VALIDATION_FAILED');
    }
  }

  get id(): string {
    return this.props.id;
  }

  isSellable(now: Date): boolean {
    return !this.props.closed && this.props.departureAt > now;
  }

  assertSellable(now: Date): void {
    if (!this.isSellable(now)) throw new InventoryError('OFFER_NO_LONGER_AVAILABLE');
  }

  durationMinutes(): number {
    return Math.round((this.props.arrivalAt.getTime() - this.props.departureAt.getTime()) / 60000);
  }

  availableSeats(cabin: string): number {
    return this.props.cabins.find((c) => c.cabinClass === cabin)?.available ?? 0;
  }
}
