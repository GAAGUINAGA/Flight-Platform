import { useEffect, useState } from 'react';
import { formatMoney } from '@flight-platform/format';
import { CancelBookingOperation, CancellationQuoteOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { CancelBookingMutation, CancellationQuoteQuery } from '@flight-platform/graphql-schema/generated/types';
import { useServices } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { newCorrelationId } from '../data/identity';
import { toAppError, type AppError } from '../data/errors';
import { clockLabel } from '../purchase/HoldTimer';
import { useAction } from './useAction';
import type { Booking } from './useBooking';
import s from '../purchase/purchase.module.css';

type Quote = CancellationQuoteQuery['cancellationQuote'];
type Result = CancelBookingMutation['cancelBooking'];

/** Segundos que faltan de una cotización (vence en `expiresAt`). */
function useQuoteClock(expiresAt: string | null): number {
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!expiresAt) return undefined;
    const timer = window.setInterval(() => redraw((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  // Se calcula en cada dibujo (no se guarda): la primera vez ya sale bien y no hay un instante de «vencida» falso.
  return expiresAt ? Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000)) : 0;
}

/** Postventa · Cancelar (§3.11): cotizar → ver reembolso, penalidad y vencimiento → confirmar con casillas explícitas. */
export function CancelTab({ booking, onDone }: { booking: Booking; onDone: (result: Result) => void }) {
  const { client } = useServices(); const action = useAction();
  const [quote, setQuote] = useState<Quote | null>(null); const [quoting, setQuoting] = useState(false); const [quoteError, setQuoteError] = useState<AppError | null>(null);
  const [definitive, setDefinitive] = useState(false); const [amounts, setAmounts] = useState(false);
  const left = useQuoteClock(quote?.expiresAt ?? null);

  const getQuote = async (): Promise<void> => {
    setQuoting(true); setQuoteError(null); setDefinitive(false); setAmounts(false); action.clearError();
    try { setQuote((await client.execute(CancellationQuoteOperation, { bookingId: booking.bookingId }, { correlationId: newCorrelationId() })).cancellationQuote); }
    catch (failure) { setQuote(null); setQuoteError(toAppError(failure)); } finally { setQuoting(false); }
  };
  const cancel = async (current: Quote): Promise<void> => {
    const result = await action.run('cancel', JSON.stringify({ quote: current.quoteId }), (intent) => client.execute(CancelBookingOperation, { bookingId: booking.bookingId, quoteId: current.quoteId, reasonCode: 'CUSTOMER_REQUEST', idempotencyKey: intent.idempotencyKey }, { correlationId: intent.correlationId }));
    if (result) onDone(result.cancelBooking);
  };

  const expired = quote !== null && left === 0;
  return (
    <div className={s.stack}>
      <p>Antes de cancelar te mostramos cuánto se te reembolsa y cuánto se retiene por penalidad. La cotización tiene un tiempo de validez.</p>
      {!quote ? <div className={s.row}><Button loading={quoting} onClick={() => void getQuote()}>Cotizar la cancelación</Button></div> : null}
      {quoteError ? <ErrorPanel error={quoteError} onRetry={() => void getQuote()} /> : null}
      {quote ? (
        <section className={`${ui.card} ${s.stackSmall}`} aria-label="Cotización de la cancelación">
          <h3>Cotización de la cancelación</h3>
          <dl className={s.lines}>
            <div className={s.line}><dt>¿Es reembolsable?</dt><dd>{quote.isRefundable ? 'Sí' : 'No'}</dd></div>
            <div className={s.line}><dt>Reembolso</dt><dd>{formatMoney({ currency: quote.currency, total: quote.refundAmount })}</dd></div>
            <div className={s.line}><dt>Penalidad</dt><dd>{formatMoney({ currency: quote.currency, total: quote.penaltyAmount })}</dd></div>
          </dl>
          <p className={s.muted}>{expired ? 'La cotización venció.' : <>Cotización válida durante <span role="timer" aria-label="Tiempo restante de la cotización">{clockLabel(left)}</span></>}</p>
          {expired ? <Notice kind="warning" title="La cotización venció."><p>Solicita una nueva para ver los importes vigentes.</p></Notice> : (
            <div className={s.checks}>
              <label className={s.check}><input type="checkbox" checked={definitive} onChange={(event) => setDefinitive(event.target.checked)} />Entiendo que la cancelación es definitiva y que no se puede deshacer.</label>
              <label className={s.check}><input type="checkbox" checked={amounts} onChange={(event) => setAmounts(event.target.checked)} />Acepto el reembolso de {formatMoney({ currency: quote.currency, total: quote.refundAmount })} y la penalidad de {formatMoney({ currency: quote.currency, total: quote.penaltyAmount })}.</label>
            </div>
          )}
          {action.error ? (
            <ErrorPanel error={action.error} onRetry={() => void cancel(quote)} />
          ) : null}
          {action.error?.code === 'QUOTE_EXPIRED' ? <div className={s.row}><Button variant="secondary" onClick={() => void getQuote()}>Cotizar de nuevo</Button></div> : null}
          <div className={s.row}>
            {expired ? <Button onClick={() => void getQuote()} loading={quoting}>Cotizar de nuevo</Button> : <Button loading={action.busy} disabled={!definitive || !amounts} onClick={() => void cancel(quote)}>Cancelar la reserva</Button>}
            <Button variant="secondary" onClick={() => setQuote(null)}>No cancelar</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
