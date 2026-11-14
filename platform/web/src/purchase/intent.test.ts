import { describe, expect, it } from 'vitest';
import { counterIds } from '../../test/utils';
import { AppError } from '../data/errors';
import { IntentBook, isUncertain, paymentReference, runIntent } from './intent';

const fail = (category: ConstructorParameters<typeof AppError>[0]['category'], code: string, retryAfterSeconds?: number): AppError => new AppError({ category, code, retryAfterSeconds });

describe('intención de negocio e idempotencia (§6.5)', () => {
  it('INT-01 un reintento de la misma acción con los mismos datos reutiliza la clave; otros datos, una clave nueva', () => {
    const book = new IntentBook(counterIds());
    const first = book.begin('booking', 'datos-1'); const retry = book.begin('booking', 'datos-1');
    expect(retry).toEqual(first);
    const changed = book.begin('booking', 'datos-2');
    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(book.begin('hold', 'datos-1').idempotencyKey).not.toBe(first.idempotencyKey); // acciones distintas, claves distintas
  });

  it('INT-02 el hold y la reserva de una misma compra comparten el X-Correlation-Id; cada acción de postventa abre uno nuevo', () => {
    const book = new IntentBook(counterIds());
    const hold = book.begin('hold', 'a', 'compra-1'); const booking = book.begin('booking', 'b', 'compra-1');
    expect(hold.correlationId).toBe('compra-1'); expect(booking.correlationId).toBe('compra-1');
    expect(hold.idempotencyKey).not.toBe(booking.idempotencyKey);
    const cancel = book.begin('cancel', 'q1'); const baggage = book.begin('baggage', 'x');
    expect(new Set([cancel.correlationId, baggage.correlationId, 'compra-1']).size).toBe(3);
  });

  it('INT-03 un resultado incierto (sin red, tiempo agotado, 5xx, 503, «en curso») conserva la clave; uno definitivo la cierra', () => {
    for (const error of [fail('UNAVAILABLE', 'NETWORK_ERROR'), fail('UNAVAILABLE', 'CLIENT_TIMEOUT'), fail('UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 5), fail('INTERNAL', 'INTERNAL_ERROR'), fail('CONFLICT', 'IDEMPOTENCY_KEY_REUSED', 3), new TypeError('x')]) {
      expect(isUncertain(error), error.constructor.name).toBe(true);
    }
    for (const error of [fail('CONFLICT', 'SEAT_TAKEN'), fail('UNPROCESSABLE', 'PAYMENT_NOT_AUTHORIZED'), fail('GONE', 'HOLD_EXPIRED'), fail('VALIDATION', 'VALIDATION_FAILED'), fail('RATE_LIMITED', 'WEB_ACTIVE_BOOKINGS_LIMIT'), fail('CONFLICT', 'IDEMPOTENCY_KEY_REUSED')]) {
      expect(isUncertain(error), String(error.code)).toBe(false);
    }
  });

  it('INT-04 tras un 503 el reintento reutiliza clave y referencia de pago; tras un rechazo del negocio, el siguiente intento es nuevo', async () => {
    const book = new IntentBook(counterIds()); const seen: Array<{ key: string; reference: string }> = [];
    const attempt = (outcome: 'ok' | AppError) => runIntent(book, 'booking', 'mismos-datos', async (intent) => {
      seen.push({ key: intent.idempotencyKey, reference: paymentReference('ok', intent.nonce) });
      if (outcome !== 'ok') throw outcome; return 'listo';
    }, 'compra');
    await expect(attempt(fail('UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 2))).rejects.toBeInstanceOf(AppError);
    await expect(attempt(fail('UNAVAILABLE', 'CLIENT_TIMEOUT'))).rejects.toBeInstanceOf(AppError);
    expect(seen[1]).toEqual(seen[0]);
    await expect(attempt(fail('UNPROCESSABLE', 'PAYMENT_NOT_AUTHORIZED'))).rejects.toBeInstanceOf(AppError);
    expect(seen[2]).toEqual(seen[0]); // el rechazo llegó con la misma clave…
    expect(await attempt('ok')).toBe('listo');
    expect(seen[3].key).not.toBe(seen[0].key); // …y el siguiente intento ya es otra intención
    expect(seen[3].reference).not.toBe(seen[0].reference);
    expect(book.has('booking')).toBe(false); // un éxito cierra la intención: una compra nueva no reutiliza la clave
  });

  it('INT-05 la referencia del pago simulado respeta el prefijo y el máximo de 64 caracteres', () => {
    expect(paymentReference('ok', 'abc')).toBe('pay_ok_abc');
    expect(paymentReference('denied', 'abc')).toBe('pay_denied_abc'); expect(paymentReference('pending', 'abc')).toBe('pay_pending_abc');
    expect(paymentReference('ok', 'x'.repeat(200))).toHaveLength(64);
  });
});
