import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Check } from 'lucide-react';
import { formatLocalDate, formatLocalTime, formatMoney, zoneLabel, type MoneyLike } from '@flight-platform/format';
import type { BookingStatus } from '@flight-platform/graphql-schema/generated/types';
import { useSession } from '../app/services';
import { LoadingState } from '../components/ui/LoadingState';
import ui from '../components/ui/ui.module.css';
import { loginPath } from '../session/return-to';
import s from './purchase.module.css';

/** Todas las pantallas de compra y reservas exigen sesión: sin ella, lleva al inicio de sesión y vuelve al mismo punto. */
export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession(); const location = useLocation();
  if (session.status === 'loading') return <LoadingState phase="normal" label="Verificando tu sesión" />;
  if (session.status === 'anonymous') {
    // Una sesión vencida la atiende el vigilante de sesión (pantalla «Tu sesión expiró»).
    return session.expired ? null : <Navigate to={loginPath(`${location.pathname}${location.search}`)} replace />;
  }
  return <>{children}</>;
}

const STEPS = ['Asientos', 'Pasajeros', 'Pago', 'Confirmación'] as const;
/** Pasos de la compra (1 = asientos … 4 = confirmación). */
export function Stepper({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <ol className={s.stepper} aria-label="Pasos de la compra">
      {STEPS.map((label, index) => {
        const number = index + 1; const done = number < current; const here = number === current;
        return (
          <li key={label} className={`${s.step} ${here ? s.stepCurrent : ''} ${done ? s.stepDone : ''}`} aria-current={here ? 'step' : undefined}>
            <span className={s.stepNum} aria-hidden="true">{done ? <Check size={14} /> : number}</span>
            {label}{done ? <span className={ui.srOnly}> (listo)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function SummaryLine({ label, children }: { label: string; children: ReactNode }) {
  return <div className={s.line}><dt>{label}</dt><dd>{children}</dd></div>;
}

export const money = (value: MoneyLike | null | undefined): string => (value ? formatMoney(value) : '—');

/** «jue 10 dic 2026 · 08:35 · hora de Quito», SIEMPRE en la zona del aeropuerto. */
export function whenAt(instant: string, iata: string): string {
  return `${formatLocalDate(instant, iata, { weekday: true })} · ${formatLocalTime(instant, iata)} · ${zoneLabel(iata)}`;
}

const STATUS: Readonly<Record<BookingStatus, { label: string; tone: 'ok' | 'wait' | 'warn' | 'bad' }>> = {
  PENDING: { label: 'Pendiente', tone: 'wait' },
  PENDING_PAYMENT: { label: 'Pago en proceso', tone: 'wait' },
  TICKET_ISSUING: { label: 'Emitiendo boletos', tone: 'wait' },
  CONFIRMED: { label: 'Confirmada', tone: 'ok' },
  FAILED: { label: 'No completada', tone: 'bad' },
  CHANGE_PENDING: { label: 'Cambio en proceso', tone: 'wait' },
  CANCELLATION_PENDING: { label: 'Cancelación en proceso', tone: 'wait' },
  CANCELLED: { label: 'Cancelada', tone: 'warn' }
};
export const bookingStatusLabel = (status: BookingStatus): string => STATUS[status]?.label ?? status;

/** Estado de la reserva: siempre con texto (nunca solo color). */
export function StatusBadge({ status }: { status: BookingStatus }) {
  const info = STATUS[status] ?? { label: status, tone: 'wait' as const };
  const tone = { ok: s.badgeOk, wait: s.badgeWait, warn: s.badgeWarn, bad: s.badgeBad }[info.tone];
  return <span className={`${s.badge} ${tone}`}>{info.label}</span>;
}
