import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useServices, useSession } from '../app/services';
import { actionFor, type AppError } from '../data/errors';
import { CALLBACK_PATH } from '../pages/AuthPages';
import { loginPath } from '../session/return-to';
import { Button, ButtonLink } from './ui/Button';
import { Notice } from './ui/Notice';
import styles from './ui/ui.module.css';

/** Segundos que faltan de una espera (`Retry-After`); 0 cuando ya se puede reintentar. */
export function useCountdown(seconds: number | null): number {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => { setLeft(seconds ?? 0); }, [seconds]);
  useEffect(() => {
    if (left <= 0) return undefined;
    const timer = setTimeout(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return left;
}

export interface ErrorPanelProps {
  error: AppError;
  onRetry?: () => void;
  fixHref?: string;
  fixLabel?: string;
  /** A dónde lleva «Buscar de nuevo»: la búsqueda con sus criterios (por omisión, el inicio). */
  searchHref?: string;
  /** SEAT_TAKEN: vuelve a pedir el mapa de asientos. */
  onRefreshSeats?: () => void;
  /** PAYMENT_NOT_AUTHORIZED: ofrece intentar el pago de nuevo. */
  onRetryPayment?: () => void;
  /** Se explica que la selección sigue reservada tras un pago rechazado (solo en la compra). */
  holdStillValid?: boolean;
}

/** Reenvío del correo de confirmación (EMAIL_NOT_VERIFIED): el mismo mensaje exista o no la cuenta. */
function ResendConfirmation() {
  const { session: client } = useServices(); const session = useSession();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const email = session.status === 'authenticated' ? session.user.email : null;
  if (!email) return null;
  const send = (): void => {
    setState('sending');
    void client.resendConfirmation(email, `${window.location.origin}${CALLBACK_PATH}`).then((result) => setState(result.ok ? 'sent' : 'failed'));
  };
  return (
    <>
      {state === 'sent' ? <p role="status">Te enviamos el enlace de confirmación. Revisa tu bandeja de entrada y vuelve a iniciar sesión.</p> : null}
      {state === 'failed' ? <p role="status">No pudimos reenviar el correo ahora. Inténtalo en unos minutos.</p> : null}
      <Button size="small" variant="secondary" loading={state === 'sending'} onClick={send}>Reenviar correo de confirmación</Button>
    </>
  );
}

/**
 * Presenta un error de la capa de datos: el mensaje del catálogo, la acción que corresponde a su `category`/`code`
 * (reintentar, esperar, iniciar sesión, buscar de nuevo, refrescar el mapa, confirmar el correo…) y el `correlationId` en «Detalles».
 */
export function ErrorPanel({ error, onRetry, fixHref, fixLabel = 'Modificar búsqueda', searchHref = '/', onRefreshSeats, onRetryPayment, holdStillValid = false }: ErrorPanelProps) {
  const location = useLocation();
  const action = actionFor(error);
  const waiting = useCountdown(action === 'wait' || action === 'retry' ? error.retryAfterSeconds : null);
  return (
    <Notice kind={action === 'wait' ? 'warning' : 'error'} title={error.message}>
      {error.invalidParams.length > 0 ? <p>Campos por revisar: {error.invalidParams.map((param) => param.name).join(', ')}.</p> : null}
      {action === 'refresh-seats' ? <p>Actualiza el mapa y elige otro asiento; el resto de tu selección se conserva.</p> : null}
      {action === 'retry-payment' && holdStillValid ? <p>Tu selección sigue reservada mientras corra el tiempo. Puedes intentar el pago de nuevo.</p> : null}
      {action === 'confirm-email' ? <p>Te enviamos un enlace de confirmación cuando creaste la cuenta. Ábrelo y vuelve a iniciar sesión.</p> : null}
      {waiting > 0 ? <p aria-live="off">Podrás reintentar en {waiting} s.</p> : null}
      <div className={styles.actions}>
        {(action === 'retry' || action === 'wait') && onRetry ? <Button size="small" variant="secondary" onClick={onRetry} disabled={waiting > 0}>Reintentar</Button> : null}
        {action === 'refresh-seats' && onRefreshSeats ? <Button size="small" onClick={onRefreshSeats}>Actualizar el mapa</Button> : null}
        {action === 'retry-payment' && onRetryPayment ? <Button size="small" onClick={onRetryPayment}>Intentar el pago de nuevo</Button> : null}
        {action === 'login' ? <ButtonLink size="small" to={loginPath(`${location.pathname}${location.search}`)}>Iniciar sesión</ButtonLink> : null}
        {action === 'search-again' ? <ButtonLink size="small" variant="secondary" to={searchHref}>Buscar de nuevo</ButtonLink> : null}
        {action === 'fix-input' && fixHref ? <ButtonLink size="small" variant="secondary" to={fixHref}>{fixLabel}</ButtonLink> : null}
        {action === 'go-home' || action === 'sales-disabled' ? <ButtonLink size="small" variant="secondary" to="/">Ir al inicio</ButtonLink> : null}
        {action === 'account-limit' ? <ButtonLink size="small" variant="secondary" to="/reservas">Ver mis reservas</ButtonLink> : null}
        {action === 'confirm-email' ? <ResendConfirmation /> : null}
        {action === 'reload' ? <Button size="small" variant="secondary" onClick={() => window.location.reload()}>Recargar</Button> : null}
      </div>
      {error.correlationId ? (
        <details className={styles.details}>
          <summary>Detalles técnicos</summary>
          Si contactas a soporte, comparte este identificador: <code>{error.correlationId}</code> ({error.code})
        </details>
      ) : null}
    </Notice>
  );
}
