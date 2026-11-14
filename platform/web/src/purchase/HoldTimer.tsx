import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, TimerOff } from 'lucide-react';
import { HoldOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { HoldQuery } from '@flight-platform/graphql-schema/generated/types';
import { useQuery } from '../app/services';
import { AppError } from '../data/errors';
import { ErrorPanel } from '../components/ErrorPanel';
import { ButtonLink } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import s from './purchase.module.css';

export type HoldData = HoldQuery['hold'];
export interface HoldClock {
  phase: 'loading' | 'active' | 'expired' | 'error';
  /** Segundos que faltan según el servidor (su `remainingSeconds` al consultar, descontando lo transcurrido desde entonces). */
  remaining: number;
  hold: HoldData | null;
  error: AppError | null;
  reload: () => void;
}

/** «09:12». */
export const clockLabel = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * El tiempo del hold SALE DEL SERVIDOR: se toma el `remainingSeconds` (o, si falta, el vencimiento `expiresAt` frente al reloj del
 * servidor implícito en esa misma respuesta) y solo se descuenta el tiempo transcurrido con un reloj monótono, que no depende de la
 * hora del dispositivo. Al llegar a cero se CONSULTA de nuevo: vence cuando el servidor lo confirma (410 / estado distinto de HELD).
 */
export function useHoldClock(holdId: string | null): HoldClock {
  const query = useQuery(HoldOperation, holdId ? { holdId } : null, holdId ?? '');
  const [baseline, setBaseline] = useState<{ at: number; seconds: number; hold: HoldData } | null>(null);
  const [now, setNow] = useState(() => window.performance.now());
  /** Se llegó a cero y se está confirmando con el servidor: mientras tanto NO se declara vencido. */
  const [confirming, setConfirming] = useState(false);
  /** El servidor, ya consultado al llegar a cero, sigue diciendo que no queda tiempo. */
  const [zeroConfirmed, setZeroConfirmed] = useState(false);
  const wasConfirming = useRef(false); wasConfirming.current = confirming;

  useEffect(() => {
    if (query.status !== 'success') return;
    const { remainingSeconds, expiresAt } = query.data.hold;
    const fromExpiry = expiresAt ? Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000)) : 0;
    const seconds = typeof remainingSeconds === 'number' ? remainingSeconds : fromExpiry;
    const at = window.performance.now();
    setBaseline({ at, seconds, hold: query.data.hold });
    setNow(at); setZeroConfirmed(wasConfirming.current && seconds <= 0); setConfirming(false);
  }, [query]);

  const hold = query.status === 'success' ? query.data.hold : null;
  // La línea base pertenece a esta respuesta del servidor; hasta que se fija, el contador no se muestra (evita un «00:00» falso).
  const ready = baseline !== null && baseline.hold === hold;
  const left = ready && baseline ? Math.max(0, baseline.seconds - Math.floor((now - baseline.at) / 1000)) : 0;
  const active = hold?.status === 'HELD' && !zeroConfirmed;

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(window.performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (active && ready && left === 0 && !confirming) { setConfirming(true); query.reload(); }
  }, [active, ready, left, confirming, query]);

  if (query.status === 'error') {
    // Un 410 del servidor es el vencimiento confirmado.
    if (query.error.category === 'GONE') return { phase: 'expired', remaining: 0, hold: null, error: null, reload: query.reload };
    return { phase: 'error', remaining: 0, hold: null, error: query.error, reload: query.reload };
  }
  if (query.status !== 'success') return { phase: 'loading', remaining: 0, hold: null, error: null, reload: query.reload };
  if (hold && hold.status !== 'HELD') return { phase: 'expired', remaining: 0, hold, error: null, reload: query.reload };
  if (zeroConfirmed) return { phase: 'expired', remaining: 0, hold, error: null, reload: query.reload };
  if (!ready || confirming) return { phase: 'loading', remaining: 0, hold: null, error: null, reload: query.reload };
  return { phase: 'active', remaining: left, hold, error: null, reload: query.reload };
}

/** Contador visible del hold. Avisa con cortesía al quedar un minuto. */
export function HoldTimer({ clock }: { clock: HoldClock }) {
  if (clock.phase !== 'active') return null;
  const low = clock.remaining <= 60;
  return (
    <div className={`${s.timer} ${low ? s.timerLow : ''}`}>
      <Clock size={18} aria-hidden="true" />
      <span>Tu selección está reservada durante</span>
      <span role="timer" aria-label="Tiempo restante de tu selección">{clockLabel(clock.remaining)}</span>
      <span className={ui.srOnly} role="status">{clock.remaining <= 60 && clock.remaining > 0 ? 'Queda menos de un minuto para completar la compra.' : ''}</span>
    </div>
  );
}

/** Pantalla del hold vencido: conserva los criterios de búsqueda (el enlace vuelve a los resultados). */
export function HoldExpired({ searchHref }: { searchHref: string }) {
  return (
    <div className={ui.statePage}>
      <span className={ui.stateIcon}><TimerOff size={36} aria-hidden="true" /></span>
      <h1>Tu selección venció</h1>
      <p>Pasó el tiempo para completar la compra y liberamos tus asientos. Vuelve a buscar para elegir de nuevo: conservamos tus criterios.</p>
      <ButtonLink to={searchHref}>Volver a buscar</ButtonLink>
    </div>
  );
}

/** Estado del hold en las pantallas de la compra: error, vencido o nada. */
export function HoldGate({ clock, searchHref }: { clock: HoldClock; searchHref: string }) {
  if (clock.phase === 'error' && clock.error) return <ErrorPanel error={clock.error} onRetry={clock.reload} searchHref={searchHref} />;
  if (clock.phase === 'expired') return <Notice kind="warning" title="Tu selección venció."><p>Vuelve a buscar para elegir de nuevo: conservamos tus criterios.</p><Link to={searchHref}>Volver a buscar</Link></Notice>;
  return null;
}
