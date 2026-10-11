import { DomainError } from '@flight-platform/shared';

export type PassengerMix = { adults: number; youths: number; children: number; infants: number };
export type Money = { currency: 'USD'; amountMinor: number };

const multiplier: Record<keyof PassengerMix, number> = { adults: 100, youths: 90, children: 75, infants: 10 };

export function validateMix(mix: PassengerMix): void {
  const seated = mix.adults + mix.youths + mix.children;
  if (!Number.isInteger(seated) || Object.values(mix).some((n) => !Number.isInteger(n) || n < 0) || mix.adults < 1 || mix.infants > mix.adults || seated > 9) {
    throw new DomainError('VALIDATION_FAILED');
  }
}

export function calculateFare(baseFareMinor: number, taxesMinor: number, mix: PassengerMix): { total: Money; perType: Record<keyof PassengerMix, Money> } {
  validateMix(mix);
  if (!Number.isInteger(baseFareMinor) || !Number.isInteger(taxesMinor) || baseFareMinor < 0 || taxesMinor < 0) throw new DomainError('VALIDATION_FAILED');
  const price = (type: keyof PassengerMix): Money => ({ currency: 'USD', amountMinor: Math.round((baseFareMinor + taxesMinor) * multiplier[type] / 100) });
  const perType = { adults: price('adults'), youths: price('youths'), children: price('children'), infants: price('infants') };
  return { perType, total: { currency: 'USD', amountMinor: (Object.keys(mix) as Array<keyof PassengerMix>).reduce((sum, key) => sum + perType[key].amountMinor * mix[key], 0) } };
}

export type Segment = { departureAt: Date; arrivalAt: Date };
export function validConnection(segments: Segment[]): boolean {
  return segments.every((segment, index) => segment.arrivalAt > segment.departureAt && (index === 0 || segment.departureAt.getTime() - segments[index - 1].arrivalAt.getTime() >= 60 * 60_000));
}
