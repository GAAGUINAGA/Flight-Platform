import { AppError } from '../data/errors';
import { newId } from '../data/identity';

/**
 * Intención de negocio y su idempotencia (diseño F12c-0 §6.5). Sin React ni DOM.
 *   - X-Correlation-Id: el MISMO en el hold y en la reserva de una misma compra; uno nuevo por cada acción de postventa.
 *   - Idempotency-Key: una por INTENCIÓN. Un reintento de la misma acción con los mismos datos (doble clic, reconexión,
 *     «Reintentar» tras un 503) reutiliza la clave; una acción nueva —o la misma con otros datos— usa una nueva.
 *   - Tras un resultado DEFINITIVO (éxito o un rechazo del negocio) la intención se cierra; tras un resultado incierto
 *     (sin red, tiempo agotado, 5xx) se conserva para que el reintento no duplique la compra.
 */
export interface Intent { idempotencyKey: string; correlationId: string; /** Sirve para que la referencia de pago de un reintento sea la misma. */ nonce: string }

/** ¿El resultado es incierto (la operación pudo haberse aplicado)? */
export function isUncertain(error: unknown): boolean {
  if (!(error instanceof AppError)) return true;
  if (error.category === 'UNAVAILABLE' || error.category === 'INTERNAL') return true;
  // «Ya se está procesando»: la misma clave sigue en curso en el servidor.
  return error.code === 'IDEMPOTENCY_KEY_REUSED' && error.retryAfterSeconds !== null;
}

export class IntentBook {
  private readonly entries = new Map<string, { signature: string; intent: Intent }>();
  constructor(private readonly generate: () => string = newId) {}

  /**
   * Devuelve la intención de `action` para estos datos (`signature`). Si ya hay una abierta con la misma firma, es la misma
   * (reintento); si no, se abre una nueva. `correlationId` fija el de la compra en curso (hold y reserva comparten).
   */
  begin(action: string, signature: string, correlationId?: string): Intent {
    const current = this.entries.get(action);
    if (current && current.signature === signature) return current.intent;
    const intent: Intent = { idempotencyKey: this.generate(), correlationId: correlationId ?? this.generate(), nonce: this.generate() };
    this.entries.set(action, { signature, intent });
    return intent;
  }

  /** Cierra la intención tras un éxito o un rechazo definitivo; la conserva si el resultado es incierto. */
  settle(action: string, outcome: { error?: unknown } = {}): void {
    if (outcome.error !== undefined && isUncertain(outcome.error)) return;
    this.entries.delete(action);
  }

  has(action: string): boolean { return this.entries.has(action); }
  clear(): void { this.entries.clear(); }
}

/** Ejecuta `run` con la intención de `action`: el cierre ocurre solo cuando el resultado es definitivo. */
export async function runIntent<T>(book: IntentBook, action: string, signature: string, run: (intent: Intent) => Promise<T>, correlationId?: string): Promise<T> {
  const intent = book.begin(action, signature, correlationId);
  try {
    const result = await run(intent);
    book.settle(action);
    return result;
  } catch (error) {
    book.settle(action, { error });
    throw error;
  }
}

/** Referencia del pago SIMULADO (el único procesamiento que existe): `pay_ok_*` autoriza; los escenarios solo si la configuración los habilita. Máx. 64 caracteres. */
export type PaymentScenario = 'ok' | 'denied' | 'pending';
export const paymentReference = (scenario: PaymentScenario, nonce: string): string => `pay_${scenario}_${nonce}`.slice(0, 64);
