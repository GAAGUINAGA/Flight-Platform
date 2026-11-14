/**
 * Dinero como CADENAS decimales (el contrato envía `"630.00"`): formato es-EC sin pasar por números de coma flotante y sin redondeos propios.
 */
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

export interface MoneyLike { currency: string; total: string }

/** `"1254.7"` → `"1.254,70"`. Completa a dos decimales; si vienen más, se conservan tal cual. Una cadena no decimal se devuelve sin tocar. */
export function formatAmount(amount: string): string {
  const match = DECIMAL.exec(amount.trim());
  if (!match) return amount;
  const [, sign, whole, fraction = ''] = match;
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign ? '−' : ''}${grouped},${fraction.padEnd(2, '0')}`;
}

/** «USD 254,78». */
export function formatMoney(money: MoneyLike): string {
  return `${money.currency} ${formatAmount(money.total)}`;
}

/** Compara dos importes decimales sin flotantes: negativo si `a < b`, 0 si iguales, positivo si `a > b`. Un valor no decimal ordena al final. */
export function compareAmounts(a: string, b: string): number {
  const left = DECIMAL.exec(a.trim()); const right = DECIMAL.exec(b.trim());
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  const scale = Math.max(left[3]?.length ?? 0, right[3]?.length ?? 0);
  const toInteger = (match: RegExpExecArray): bigint => BigInt(`${match[1]}${match[2]}${(match[3] ?? '').padEnd(scale, '0')}`);
  const x = toInteger(left); const y = toInteger(right);
  return x < y ? -1 : x > y ? 1 : 0;
}
