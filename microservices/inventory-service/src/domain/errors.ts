export type InventoryErrorCode = 'VALIDATION_FAILED' | 'OFFER_NO_LONGER_AVAILABLE' | 'NOT_FOUND';

export class InventoryError extends Error {
  constructor(public readonly code: InventoryErrorCode) {
    super(code);
    this.name = 'InventoryError';
  }
}
