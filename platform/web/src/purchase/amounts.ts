/**
 * Importes sin coma flotante: las cadenas decimales del contrato ("127.39") se operan como centavos enteros. Sin React ni DOM.
 * El servidor es la autoridad del precio (el hold congela el total); esto solo suma lo que la pantalla debe mostrar.
 */
const DECIMAL = /^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/;

export function toCents(amount: string): number | null {
  const match = DECIMAL.exec(amount.trim());
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return match[1] === '-' ? -cents : cents;
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''; const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Suma de cadenas decimales; una cadena inválida cuenta como 0 y se informa en `valid`. */
export function sumAmounts(values: readonly string[]): { total: string; valid: boolean } {
  let cents = 0; let valid = true;
  for (const value of values) { const parsed = toCents(value); if (parsed === null) valid = false; else cents += parsed; }
  return { total: fromCents(cents), valid };
}

/** `amount × quantity` (cantidad entera ≥ 0). */
export function multiplyAmount(amount: string, quantity: number): string | null {
  const cents = toCents(amount);
  return cents === null || !Number.isInteger(quantity) || quantity < 0 ? null : fromCents(cents * quantity);
}
