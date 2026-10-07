import { CabinClass } from './cabin';
import { InventoryError } from './errors';

/** Capacidad de una cabina: held + sold <= sellable. */
export class CabinCapacity {
  constructor(
    public readonly cabinClass: CabinClass,
    public readonly sellable: number,
    public readonly held = 0,
    public readonly sold = 0
  ) {
    if (![sellable, held, sold].every((n) => Number.isInteger(n) && n >= 0) || held + sold > sellable) {
      throw new InventoryError('VALIDATION_FAILED');
    }
  }

  get available(): number {
    return this.sellable - this.held - this.sold;
  }

  hold(seats: number): CabinCapacity {
    if (seats > this.available) throw new InventoryError('OFFER_NO_LONGER_AVAILABLE');
    return new CabinCapacity(this.cabinClass, this.sellable, this.held + seats, this.sold);
  }

  release(seats: number): CabinCapacity {
    return new CabinCapacity(this.cabinClass, this.sellable, this.held - seats, this.sold);
  }

  consume(seats: number): CabinCapacity {
    return new CabinCapacity(this.cabinClass, this.sellable, this.held - seats, this.sold + seats);
  }

  releaseSold(seats: number): CabinCapacity {
    return new CabinCapacity(this.cabinClass, this.sellable, this.held, this.sold - seats);
  }

  withSellable(sellable: number): CabinCapacity {
    return new CabinCapacity(this.cabinClass, sellable, this.held, this.sold);
  }
}
