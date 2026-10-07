export interface Money { currency: string; amountMinor: number }

export function minorToDecimal(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError('amountMinor must be a safe integer');
  const sign = amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(amountMinor);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function decimalToMinor(value: string): number {
  if (!/^-?(0|[1-9]\d*)\.\d{2}$/.test(value)) throw new RangeError('Money must have two decimals');
  const sign = value.startsWith('-') ? -1 : 1;
  const [major, minor] = value.replace('-', '').split('.');
  const result = sign * (Number(major) * 100 + Number(minor));
  if (!Number.isSafeInteger(result)) throw new RangeError('Money exceeds safe range');
  return result;
}
