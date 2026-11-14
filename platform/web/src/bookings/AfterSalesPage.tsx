import { useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatMoney } from '@flight-platform/format';
import type { CancelBookingMutation } from '@flight-platform/graphql-schema/generated/types';
import { usePageTitle } from '../app/page';
import { ErrorPanel } from '../components/ErrorPanel';
import { pageClass } from '../components/layout/AppLayout';
import { ButtonLink } from '../components/ui/Button';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { RequireSession, StatusBadge } from '../purchase/Shared';
import { BaggageTab } from './BaggageTab';
import { CancelTab } from './CancelTab';
import { DateTab } from './DateTab';
import { SeatsTab } from './SeatsTab';
import { useBooking } from './useBooking';
import s from '../purchase/purchase.module.css';

type TabId = 'equipaje' | 'asiento' | 'fecha' | 'cancelar';
const TABS: ReadonlyArray<{ id: TabId; label: string; action: string }> = [
  { id: 'equipaje', label: 'Equipaje', action: 'baggage-options' },
  { id: 'asiento', label: 'Asiento', action: 'seats' },
  { id: 'fecha', label: 'Cambiar fecha', action: 'date-change-search' },
  { id: 'cancelar', label: 'Cancelar', action: 'cancellation-quote' }
];

/** Postventa (§3.11): una pantalla con cuatro pestañas; cada una muestra importe y condiciones antes de confirmar. Solo las que el estado permite. */
export function AfterSalesPage() {
  return <RequireSession><AfterSalesScreen /></RequireSession>;
}

function AfterSalesScreen() {
  usePageTitle('Gestionar mi reserva');
  const { bookingId = '' } = useParams(); const [params, setParams] = useSearchParams(); const navigate = useNavigate();
  const state = useBooking(bookingId, { poll: false });
  const [cancelled, setCancelled] = useState<CancelBookingMutation['cancelBooking'] | null>(null);
  const refs = useRef(new Map<TabId, HTMLButtonElement>());

  if (state.loading) return <div className={pageClass}><LoadingState phase="normal" label="Cargando tu reserva" /></div>;
  if (state.error && !state.booking) return <div className={pageClass}><ErrorPanel error={state.error} onRetry={state.reload} /></div>;
  const booking = state.booking!;
  const detail = `/reservas/${encodeURIComponent(booking.bookingId)}`;
  const available = TABS.filter((tab) => booking.availableActions.includes(tab.action));
  const requested = params.get('pestana'); const active = available.find((tab) => tab.id === requested) ?? available[0];
  const select = (id: TabId): void => setParams({ pestana: id }, { replace: true });
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = available[(index + (event.key === 'ArrowRight' ? 1 : available.length - 1)) % available.length];
    select(next.id); refs.current.get(next.id)?.focus();
  };

  if (cancelled) {
    return (
      <div className={pageClass}>
        <div className={`${ui.card} ${s.confirm}`}>
          <h1>{cancelled.outcome === 'PENDING' ? 'Estamos cancelando tu reserva' : 'Tu reserva fue cancelada'}</h1>
          <p>Código de reserva: <strong>{booking.pnr}</strong></p>
          {cancelled.refund ? <p>Reembolso calculado: <strong>{formatMoney({ currency: cancelled.refund.currency ?? booking.grandTotal.currency, total: cancelled.refund.amount ?? '0.00' })}</strong>{cancelled.refund.penaltyAmount ? ` · penalidad ${formatMoney({ currency: cancelled.refund.currency ?? booking.grandTotal.currency, total: cancelled.refund.penaltyAmount })}` : ''}. Se procesa según las condiciones de tu tarifa.</p> : null}
          {cancelled.outcome === 'PENDING' ? <p role="status">La cancelación está en proceso. Revisa el estado en tu reserva en unos minutos.</p> : null}
          {cancelled.message ? <p className={s.muted}>{cancelled.message}</p> : null}
          <ButtonLink to={detail}>Ver mi reserva</ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className={pageClass}>
      <div className={s.between}>
        <div><h1 className={s.heading}>Gestionar mi reserva</h1><p className={s.lead}>Reserva {booking.pnr} <StatusBadge status={booking.status} /></p></div>
        <ButtonLink variant="secondary" to={detail}>Volver a la reserva</ButtonLink>
      </div>
      {available.length === 0 ? (
        <Notice kind="info" title="Por ahora no hay cambios disponibles para esta reserva."><p>Según su estado, esta reserva no admite equipaje, cambios ni cancelación. Vuelve a revisarla más tarde.</p></Notice>
      ) : (
        <>
          <div className={s.tabs} role="tablist" aria-label="Opciones de postventa">
            {available.map((tab, index) => (
              <button key={tab.id} type="button" role="tab" id={`tab-${tab.id}`} aria-selected={tab.id === active.id} aria-controls={`panel-${tab.id}`} tabIndex={tab.id === active.id ? 0 : -1}
                ref={(element) => { if (element) refs.current.set(tab.id, element); else refs.current.delete(tab.id); }}
                className={`${s.tab} ${tab.id === active.id ? s.tabActive : ''}`} onClick={() => select(tab.id)} onKeyDown={(event) => onKeyDown(event, index)}>{tab.label}</button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`}>
            {active.id === 'equipaje' ? <BaggageTab booking={booking} onDone={state.reload} /> : null}
            {active.id === 'asiento' ? <SeatsTab booking={booking} onDone={state.reload} /> : null}
            {active.id === 'fecha' ? <DateTab booking={booking} searchHref={`?pestana=fecha`} onDone={(outcome) => navigate(detail, { state: { notice: outcome === 'PENDING' ? 'change-pending' : 'change-done' } })} /> : null}
            {active.id === 'cancelar' ? <CancelTab booking={booking} onDone={setCancelled} /> : null}
          </div>
        </>
      )}
    </div>
  );
}
