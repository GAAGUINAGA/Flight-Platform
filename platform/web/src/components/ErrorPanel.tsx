import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { actionFor, type AppError } from '../data/errors';
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

/**
 * Presenta un error de la capa de datos: el mensaje del catálogo, la acción que corresponde a su `category`/`code`
 * (reintentar, esperar, iniciar sesión, buscar de nuevo, corregir) y el `correlationId` en «Detalles» para soporte.
 */
export function ErrorPanel({ error, onRetry, fixHref, fixLabel = 'Modificar búsqueda' }: { error: AppError; onRetry?: () => void; fixHref?: string; fixLabel?: string }) {
  const location = useLocation();
  const action = actionFor(error);
  const waiting = useCountdown(action === 'wait' || action === 'retry' ? error.retryAfterSeconds : null);
  return (
    <Notice kind={action === 'wait' ? 'warning' : 'error'} title={error.message}>
      {error.invalidParams.length > 0 ? <p>Campos por revisar: {error.invalidParams.map((param) => param.name).join(', ')}.</p> : null}
      {waiting > 0 ? <p aria-live="off">Podrás reintentar en {waiting} s.</p> : null}
      <div className={styles.actions}>
        {(action === 'retry' || action === 'wait') && onRetry ? <Button size="small" variant="secondary" onClick={onRetry} disabled={waiting > 0}>Reintentar</Button> : null}
        {action === 'login' ? <ButtonLink size="small" to={loginPath(`${location.pathname}${location.search}`)}>Iniciar sesión</ButtonLink> : null}
        {action === 'search-again' ? <ButtonLink size="small" variant="secondary" to="/">Buscar de nuevo</ButtonLink> : null}
        {action === 'fix-input' && fixHref ? <ButtonLink size="small" variant="secondary" to={fixHref}>{fixLabel}</ButtonLink> : null}
        {action === 'go-home' ? <ButtonLink size="small" variant="secondary" to="/">Ir al inicio</ButtonLink> : null}
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
