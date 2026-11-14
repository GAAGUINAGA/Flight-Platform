import { useCallback, useEffect, useRef, useState } from 'react';
import { Luggage } from 'lucide-react';
import { formatDate, formatMoney, isIsoDate } from '@flight-platform/format';
import { MyBookingsOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { BookingFilterInput, BookingStatus, MyBookingsQuery } from '@flight-platform/graphql-schema/generated/types';
import { usePageTitle } from '../app/page';
import { useServices } from '../app/services';
import { ErrorPanel } from '../components/ErrorPanel';
import { pageClass } from '../components/layout/AppLayout';
import { Button, ButtonLink } from '../components/ui/Button';
import { SelectField, TextField } from '../components/ui/Field';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { newCorrelationId } from '../data/identity';
import { toAppError, type AppError } from '../data/errors';
import { bookingStatusLabel, RequireSession, StatusBadge } from '../purchase/Shared';
import s from '../purchase/purchase.module.css';

type Node = MyBookingsQuery['myBookings']['edges'][number]['node'];
export const PAGE_SIZE = 10;
const STATUSES: BookingStatus[] = ['CONFIRMED', 'PENDING_PAYMENT', 'TICKET_ISSUING', 'CHANGE_PENDING', 'CANCELLATION_PENDING', 'CANCELLED', 'FAILED'];

interface Draft { pnr: string; status: string; createdFrom: string; createdTo: string }
const EMPTY: Draft = { pnr: '', status: '', createdFrom: '', createdTo: '' };

/** Filtros que admite la lista v2: PNR, estado y rango de fechas de creación. Devuelve errores por campo y el filtro a enviar. */
export function toFilter(draft: Draft): { filter: BookingFilterInput | null; errors: Partial<Record<keyof Draft, string>> } {
  const errors: Partial<Record<keyof Draft, string>> = {};
  const pnr = draft.pnr.trim().toUpperCase();
  if (pnr && !/^[A-Z0-9]{4,10}$/.test(pnr)) errors.pnr = 'El código de reserva tiene entre 4 y 10 letras o números.';
  if (draft.createdFrom && !isIsoDate(draft.createdFrom)) errors.createdFrom = 'Escribe una fecha válida.';
  if (draft.createdTo && !isIsoDate(draft.createdTo)) errors.createdTo = 'Escribe una fecha válida.';
  if (!errors.createdFrom && !errors.createdTo && draft.createdFrom && draft.createdTo && draft.createdTo < draft.createdFrom) errors.createdTo = 'La fecha final no puede ser anterior a la inicial.';
  const filter: BookingFilterInput = {
    ...(pnr ? { pnr } : {}), ...(draft.status ? { status: draft.status as BookingStatus } : {}),
    ...(draft.createdFrom ? { createdFrom: draft.createdFrom } : {}), ...(draft.createdTo ? { createdTo: draft.createdTo } : {})
  };
  return { filter: Object.keys(errors).length > 0 ? null : (Object.keys(filter).length > 0 ? filter : null), errors };
}

/** Mis reservas (diseño §3.9): de la más reciente a la más antigua, «cargar más» y los filtros de la lista v2. */
export function BookingsPage() {
  return <RequireSession><BookingsScreen /></RequireSession>;
}

function BookingsScreen() {
  usePageTitle('Mis reservas');
  const { client } = useServices();
  const [draft, setDraft] = useState<Draft>(EMPTY); const [applied, setApplied] = useState<BookingFilterInput | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [items, setItems] = useState<Node[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [hasNext, setHasNext] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading'); const [more, setMore] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (filter: BookingFilterInput | null, after: string | null): Promise<void> => {
    const mine = ++generation.current;
    if (after) setMore(true); else setPhase('loading');
    try {
      const data = await client.execute(MyBookingsOperation, { filter, first: PAGE_SIZE, after }, { correlationId: newCorrelationId() });
      if (mine !== generation.current) return;
      const nodes = data.myBookings.edges.map((edge) => edge.node);
      setItems((previous) => { const base = after ? previous : []; const seen = new Set(base.map((node) => node.bookingId)); return [...base, ...nodes.filter((node) => !seen.has(node.bookingId))]; });
      setCursor(data.myBookings.pageInfo.endCursor ?? null); setHasNext(data.myBookings.pageInfo.hasNextPage); setError(null); setPhase('ready');
    } catch (failure) { if (mine === generation.current) { setError(toAppError(failure)); setPhase(after ? 'ready' : 'error'); } } finally { if (mine === generation.current) setMore(false); }
  }, [client]);

  useEffect(() => { void load(applied, null); }, [applied, load]);

  const submit = (): void => {
    const { filter, errors: found } = toFilter(draft); setErrors(found);
    if (Object.keys(found).length === 0) setApplied(filter);
  };
  const clear = (): void => { setDraft(EMPTY); setErrors({}); setApplied(null); };
  const set = (field: keyof Draft) => (event: { target: { value: string } }): void => setDraft((previous) => ({ ...previous, [field]: event.target.value }));

  return (
    <div className={pageClass}>
      <h1 className={s.heading}>Mis reservas</h1>
      <p className={s.lead}>Aquí aparecen las reservas hechas en este sitio, de la más reciente a la más antigua.</p>
      <Notice kind="info" title="¿Compraste por una agencia o con un socio?">
        <p>Gestiona tu reserva con quien te la vendió. Aquí solo aparecen las reservas hechas en este sitio.</p>
      </Notice>

      <form className={`${ui.card} ${s.filters}`} onSubmit={(event) => { event.preventDefault(); submit(); }} aria-label="Filtrar reservas" noValidate>
        <TextField label="Código de reserva" value={draft.pnr} onChange={set('pnr')} error={errors.pnr} maxLength={10} autoComplete="off" />
        <SelectField label="Estado" value={draft.status} onChange={set('status')}>
          <option value="">Todos</option>
          {STATUSES.map((status) => <option key={status} value={status}>{bookingStatusLabel(status)}</option>)}
        </SelectField>
        <TextField label="Creada desde" type="date" value={draft.createdFrom} onChange={set('createdFrom')} error={errors.createdFrom} />
        <TextField label="Creada hasta" type="date" value={draft.createdTo} onChange={set('createdTo')} error={errors.createdTo} />
        <div className={s.row}><Button type="submit">Filtrar</Button><Button variant="secondary" onClick={clear}>Limpiar</Button></div>
      </form>

      <div className={s.top}>
        {phase === 'loading' ? <LoadingState phase="normal" label="Cargando tus reservas" skeletons={3} /> : null}
        {phase === 'error' && error ? <ErrorPanel error={error} onRetry={() => void load(applied, null)} /> : null}
        {phase === 'ready' && items.length === 0 ? (
          <div className={ui.statePage}>
            <span className={ui.stateIcon}><Luggage size={36} aria-hidden="true" /></span>
            <h2>{applied ? 'No encontramos reservas con esos filtros' : 'Aún no tienes reservas'}</h2>
            <p>{applied ? 'Prueba con otros filtros.' : 'Cuando compres un vuelo, tu reserva aparecerá aquí.'}</p>
            <ButtonLink to="/">Buscar vuelos</ButtonLink>
          </div>
        ) : null}
        {phase === 'ready' && items.length > 0 ? (
          <>
            <ul className={s.list} aria-label="Reservas">
              {items.map((node) => (
                <li key={node.bookingId}>
                  <article className={`${ui.card} ${s.bookingItem}`} aria-label={`Reserva ${node.pnr}`}>
                    <div className={s.bookingMain}>
                      <span className={s.bookingPnr}>{node.pnr}</span>
                      <span>{node.origin && node.destination ? `${node.origin} → ${node.destination}` : 'Itinerario no disponible'}{node.departureDate ? ` · sale el ${formatDate(node.departureDate)}` : ''}</span>
                      <span className={s.row}><StatusBadge status={node.status} />{node.grandTotal ? <strong>{formatMoney(node.grandTotal)}</strong> : null}</span>
                    </div>
                    <ButtonLink size="small" variant="secondary" to={`/reservas/${encodeURIComponent(node.bookingId)}`} aria-label={`Ver reserva ${node.pnr}`}>Ver reserva</ButtonLink>
                  </article>
                </li>
              ))}
            </ul>
            {error ? <ErrorPanel error={error} onRetry={() => void load(applied, cursor)} /> : null}
            {hasNext ? <div className={`${s.row} ${s.top}`}><Button variant="secondary" loading={more} onClick={() => void load(applied, cursor)}>Cargar más</Button></div> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
