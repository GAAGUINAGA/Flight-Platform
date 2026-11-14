import { useEffect, useRef, useState } from 'react';
import { cityOf, formatDate, formatLocalTimeWithZone, formatMoney, isIsoDate, todayAt } from '@flight-platform/format';
import { AdminFaresOperation, AdminFlightsOperation, UpsertFareOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { AdminFareFieldsFragment, AdminFlightsQuery, CabinClass } from '@flight-platform/graphql-schema/generated/types';
import { usePageTitle } from '../app/page';
import { useServices } from '../app/services';
import { useAction } from '../bookings/useAction';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { SelectField, TextField } from '../components/ui/Field';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { CABIN_LABEL, CABINS, derivedBase, draftFromFare, fareChanges, fareKey, toFareInput, validateFare, type FareDraft } from './fare-rules';
import { useLiveQuery, usePagedList } from './hooks';
import { DataTable } from './parts';
import a from './admin.module.css';

type AdminFlight = AdminFlightsQuery['adminFlights']['items'][number];
const PAGE = 200;
const bool = (value: boolean): string => (value ? 'Sí' : 'No');

interface Editing { fare: AdminFareFieldsFragment | null; cabinClass: CabinClass | ''; fareBrand: string }

function FareEditor({ flight, editing, onSaved, onCancel }: { flight: AdminFlight; editing: Editing; onSaved: (fare: AdminFareFieldsFragment) => void; onCancel: () => void }) {
  const { client } = useServices();
  const { busy, error, intent, run, clearError } = useAction();
  const original = useRef<FareDraft>(draftFromFare(editing.fare)).current;
  const [draft, setDraft] = useState<FareDraft>(original); const [identity, setIdentity] = useState({ cabinClass: editing.cabinClass, fareBrand: editing.fareBrand });
  const [errors, setErrors] = useState<ReturnType<typeof validateFare>>({}); const [confirming, setConfirming] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const currency = editing.fare?.price.currency ?? 'USD'; const isNew = editing.fare === null;
  useEffect(() => { heading.current?.focus(); }, [confirming]);
  const set = <K extends keyof FareDraft>(field: K, value: FareDraft[K]): void => { setDraft((previous) => ({ ...previous, [field]: value })); clearError(); };

  const review = (): void => {
    const found = validateFare(draft, isNew ? identity : null); setErrors(found);
    if (Object.keys(found).length > 0) return;
    setConfirming(true);
  };
  const input = identity.cabinClass ? toFareInput(draft, { flightInstanceId: flight.flightInstanceId, cabinClass: identity.cabinClass, fareBrand: identity.fareBrand, fareId: editing.fare?.fareId, currency }) : null;
  const changes = isNew ? fareChanges(draftFromFare(null), draft, currency) : fareChanges(original, draft, currency);
  const save = async (): Promise<void> => {
    if (!input) return;
    // Sin Idempotency-Key en esta operación (el PUT es idempotente por su clave natural vuelo+cabina+marca): el botón queda bloqueado mientras la petición está en curso.
    const signature = JSON.stringify(input);
    const result = await run('fare', signature, (current) => client.execute(UpsertFareOperation, { input }, { correlationId: current.correlationId }));
    if (result) onSaved(result.upsertFare);
  };

  if (confirming && input) {
    const total = changes.find((change) => change.label === 'Importe total');
    return (
      <section className={a.confirm} aria-labelledby="fare-confirm-title" data-testid="fare-confirm">
        <h3 id="fare-confirm-title" tabIndex={-1} ref={heading}>Confirma el cambio de la tarifa {CABIN_LABEL[input.cabinClass]} · {input.fareBrand}</h3>
        <p className={a.muted}>Vuelo {flight.flightNumber} · {formatLocalTimeWithZone(flight.departureAt, flight.departureIata)}. El nuevo importe se usa en las próximas búsquedas y ventas.</p>
        {total ? <p data-testid="fare-total-change"><strong>Importe total:</strong> {total.before} → <strong>{total.after}</strong></p> : <p>El importe total no cambia ({formatMoney({ currency, total: input.price.total })}).</p>}
        {changes.length === 0 ? <Notice kind="info" title="No hay cambios que guardar."><p>Los valores son iguales a los actuales.</p></Notice> : (
          <dl className={a.diff}>
            <div className={a.diffRow}><dt><strong>Campo</strong></dt><dd><strong>Antes</strong></dd><dd><strong>Después</strong></dd></div>
            {changes.map((change) => <div className={a.diffRow} key={change.label}><dt>{change.label}</dt><dd>{change.before}</dd><dd>{change.after}</dd></div>)}
          </dl>
        )}
        {error ? <ErrorPanel error={error} idempotencyKey={intent?.idempotencyKey} onRetry={() => void save()} /> : null}
        <div className={ui.actions}>
          <Button onClick={() => void save()} loading={busy} disabled={changes.length === 0}>Guardar tarifa</Button>
          <Button variant="secondary" onClick={() => { clearError(); setConfirming(false); }} disabled={busy}>Volver a editar</Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Descartar</Button>
        </div>
      </section>
    );
  }

  return (
    <section className={`${ui.card} ${a.panel}`} aria-labelledby="fare-title" data-testid="fare-form">
      <h3 id="fare-title" tabIndex={-1} ref={heading}>{isNew ? 'Nueva tarifa' : `Editar la tarifa ${CABIN_LABEL[editing.cabinClass as CabinClass]} · ${editing.fareBrand}`}</h3>
      <form className={a.form} onSubmit={(event) => { event.preventDefault(); review(); }} noValidate>
        {isNew ? (
          <>
            <SelectField label="Cabina" value={identity.cabinClass} onChange={(event) => setIdentity((previous) => ({ ...previous, cabinClass: event.target.value as CabinClass | '' }))} error={errors.cabinClass}>
              <option value="">Elige una cabina</option>{CABINS.map((cabin) => <option key={cabin} value={cabin}>{CABIN_LABEL[cabin]}</option>)}
            </SelectField>
            <TextField label="Marca tarifaria" value={identity.fareBrand} onChange={(event) => setIdentity((previous) => ({ ...previous, fareBrand: event.target.value }))} error={errors.fareBrand} maxLength={32} autoComplete="off" />
          </>
        ) : null}
        <TextField label={`Importe total (${currency})`} inputMode="decimal" value={draft.total} onChange={(event) => set('total', event.target.value)} error={errors.total} autoComplete="off" hint="Con hasta dos decimales, por ejemplo 127.39" />
        <TextField label="Precio de la maleta extra" inputMode="decimal" value={draft.extraBaggage} onChange={(event) => set('extraBaggage', event.target.value)} error={errors.extraBaggage} autoComplete="off" />
        <TextField label="Tasas incluidas en el total (opcional)" inputMode="decimal" value={draft.taxes} onChange={(event) => set('taxes', event.target.value)} error={errors.taxes} autoComplete="off"
          hint={derivedBase(draft) !== null ? `Tarifa base resultante: ${formatMoney({ currency, total: derivedBase(draft) ?? '0.00' })} (total menos tasas)` : 'La tarifa base es el total menos las tasas'} />
        <TextField label="Equipaje de mano incluido" inputMode="numeric" value={draft.carryOnIncluded} onChange={(event) => set('carryOnIncluded', event.target.value)} error={errors.carryOnIncluded} autoComplete="off" />
        <TextField label="Maletas facturadas incluidas" inputMode="numeric" value={draft.checkedBaggageIncluded} onChange={(event) => set('checkedBaggageIncluded', event.target.value)} error={errors.checkedBaggageIncluded} autoComplete="off" />
        <fieldset className={`${a.checks} ${a.wide}`}>
          <legend>Reglas de la tarifa</legend>
          <label className={a.check}><input type="checkbox" checked={draft.isRefundable} onChange={(event) => set('isRefundable', event.target.checked)} />Reembolsable</label>
          <label className={a.check}><input type="checkbox" checked={draft.isChangeable} onChange={(event) => set('isChangeable', event.target.checked)} />Permite cambios</label>
          <label className={a.check}><input type="checkbox" checked={draft.personalItemIncluded} onChange={(event) => set('personalItemIncluded', event.target.checked)} />Incluye artículo personal</label>
        </fieldset>
        <div className={`${a.wide} ${ui.actions}`}>
          <Button type="submit">Revisar el cambio</Button>
          <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        </div>
      </form>
    </section>
  );
}

/** Tarifas por vuelo, cabina y marca (API interna): leer, validar antes de enviar y guardar con una confirmación que muestra el antes y el después (diseño §3.13). */
export function FaresPage() {
  usePageTitle('Tarifas');
  const { client } = useServices();
  const [date, setDate] = useState(() => todayAt('UIO')); const validDate = isIsoDate(date);
  const [flightId, setFlightId] = useState(''); const [editing, setEditing] = useState<Editing | null>(null); const [saved, setSaved] = useState<AdminFareFieldsFragment | null>(null);
  const flights = usePagedList<AdminFlight>(async (after, correlationId, signal) => {
    const data = await client.execute(AdminFlightsOperation, { date, first: PAGE, after }, { correlationId, signal });
    return { items: data.adminFlights.items, endCursor: data.adminFlights.pageInfo.endCursor ?? null, hasNextPage: data.adminFlights.pageInfo.hasNextPage };
  }, date, { all: true, enabled: validDate });
  const flight = flights.items.find((item) => item.flightInstanceId === flightId) ?? null;
  const fares = useLiveQuery(AdminFaresOperation, { flightInstanceId: flightId }, `fares|${flightId}`, { enabled: flightId !== '' });
  const list = flight && fares.data ? fares.data.adminFares : [];

  const changeDate = (value: string): void => { setDate(value); setFlightId(''); setEditing(null); setSaved(null); };
  const onSaved = (fare: AdminFareFieldsFragment): void => { setSaved(fare); setEditing(null); fares.reload(); };

  return (
    <>
      <div><span className={ui.eyebrow}>Comercial</span><h1>Tarifas</h1></div>
      <form className={`${ui.card} ${a.toolbar}`} aria-label="Elegir el vuelo" onSubmit={(event) => event.preventDefault()} noValidate>
        <TextField label="Fecha de salida" type="date" value={date} onChange={(event) => changeDate(event.target.value)} error={validDate ? undefined : 'Elige una fecha válida.'} hint="Fecha local del aeropuerto de origen" />
        <SelectField label="Vuelo" value={flightId} onChange={(event) => { setFlightId(event.target.value); setEditing(null); setSaved(null); }} disabled={flights.items.length === 0}>
          <option value="">{flights.items.length === 0 ? 'No hay vuelos' : 'Elige un vuelo'}</option>
          {flights.items.map((item) => <option key={item.flightInstanceId} value={item.flightInstanceId}>{item.flightNumber} · {item.departureIata} → {item.arrivalIata} · {formatLocalTimeWithZone(item.departureAt, item.departureIata)}</option>)}
        </SelectField>
      </form>

      {flights.phase === 'loading' && validDate ? <LoadingState phase="normal" label="Cargando los vuelos" /> : null}
      {flights.error ? <ErrorPanel error={flights.error} onRetry={flights.reload} /> : null}
      {flights.phase === 'ready' && flights.items.length === 0 && validDate ? <div className={`${ui.card} ${a.empty}`}><h2>No hay vuelos el {formatDate(date)}</h2><p className={a.muted}>Prueba con otra fecha.</p></div> : null}

      {saved ? <Notice kind="success" title="La tarifa se guardó."><p data-testid="fare-saved">{CABIN_LABEL[saved.cabinClass]} · {saved.fareBrand}: {formatMoney(saved.price)}.</p></Notice> : null}
      {flight && editing ? <FareEditor key={editing.fare ? fareKey(editing.fare) : 'new'} flight={flight} editing={editing} onSaved={onSaved} onCancel={() => setEditing(null)} /> : null}

      {flight ? (
        <>
          {fares.loading ? <LoadingState phase="normal" label="Cargando las tarifas" /> : null}
          {fares.error && !fares.data ? <ErrorPanel error={fares.error} onRetry={fares.reload} /> : null}
          {fares.data ? (
            list.length === 0 ? (
              <div className={`${ui.card} ${a.empty}`}><h2>Este vuelo aún no tiene tarifas</h2><p className={a.muted}>Agrega la primera tarifa del vuelo {flight.flightNumber} ({cityOf(flight.departureIata)} → {cityOf(flight.arrivalIata)}).</p><Button onClick={() => setEditing({ fare: null, cabinClass: '', fareBrand: '' })}>Agregar una tarifa</Button></div>
            ) : (
              <>
                <DataTable caption={`Tarifas del vuelo ${flight.flightNumber}`}>
                  <thead><tr><th scope="col">Cabina</th><th scope="col">Marca</th><th scope="col" className={a.num}>Importe total</th><th scope="col">Reembolsable</th><th scope="col">Cambios</th><th scope="col">Equipaje incluido</th><th scope="col" className={a.num}>Maleta extra</th><th scope="col"><span className={ui.srOnly}>Acciones</span></th></tr></thead>
                  <tbody>
                    {list.map((fare) => (
                      <tr key={fare.fareId}>
                        <th scope="row">{CABIN_LABEL[fare.cabinClass]}</th>
                        <td>{fare.fareBrand}</td>
                        <td className={a.num}>{formatMoney(fare.price)}</td>
                        <td>{bool(fare.fareRules.isRefundable)}</td>
                        <td>{bool(fare.fareRules.isChangeable)}</td>
                        <td>Mano: {fare.baggageAllowance.carryOnIncluded ?? 0} · Facturado: {fare.baggageAllowance.checkedBaggageIncluded ?? 0}</td>
                        <td className={a.num}>{formatMoney(fare.extraCheckedBaggagePrice)}</td>
                        <td><Button size="small" variant="secondary" onClick={() => { setSaved(null); setEditing({ fare, cabinClass: fare.cabinClass, fareBrand: fare.fareBrand }); }} aria-label={`Editar la tarifa ${CABIN_LABEL[fare.cabinClass]} ${fare.fareBrand}`}>Editar</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                <div className={a.row}><Button variant="secondary" onClick={() => { setSaved(null); setEditing({ fare: null, cabinClass: '', fareBrand: '' }); }}>Agregar una tarifa</Button></div>
              </>
            )
          ) : null}
        </>
      ) : null}
    </>
  );
}
