import { useEffect, useMemo, useRef, useState } from 'react';
import { AIRPORTS, cityOf, formatDate } from '@flight-platform/format';
import { AdminAircraftCatalogOperation, AdminFaresOperation, CreateFlightOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { CreateFlightMutation } from '@flight-platform/graphql-schema/generated/types';
import { useServices } from '../app/services';
import { useAction } from '../bookings/useAction';
import { newCorrelationId } from '../data/identity';
import { toAppError, type AppError } from '../data/errors';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { SelectField, TextField } from '../components/ui/Field';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { arrivalLocalOf, CABIN_LABEL, copyFares, draftSignature, emptyDraft, emptyFare, FLIGHT_PREFIX, faresFor, flightNumberOf, MAX_FARES_PER_CABIN, parseFactor, reasonText, toCreateInput, totalOf, validateDraft, type Aircraft, type Cabin, type DraftErrors, type FareDraft, type FlightDraft, type StoredFare } from './flight-create-rules';
import { useLiveQuery } from './hooks';
import a from './admin.module.css';

export type CreatedFlight = CreateFlightMutation['createFlight'];
export interface CopySource { flightInstanceId: string; flightNumber: string; aircraft: string | null | undefined }

const localLabel = (value: string, iata: string): string => `${formatDate(value.slice(0, 10))} ${value.slice(11)} · ${cityOf(iata)}`;

/**
 * Crear un vuelo con su tarifa (F12c-4c, ADR-F12c4-01). Formulario → resumen con la advertencia y una confirmación → un solo envío con su Idempotency-Key por intención.
 * El vuelo nace CERRADO; el servidor guarda y relee las tarifas y lo abre solo si todas quedaron guardadas («dejarlo cerrado para revisarlo» lo evita).
 * La hora de salida es la LOCAL del origen y la llegada se calcula y se muestra en la hora local del destino. La autoridad de las reglas es el Gateway.
 */
export function CreateFlightPanel({ sources, onDone, onCancel }: { sources: CopySource[]; onDone: (flight: CreatedFlight) => void; onCancel: () => void }) {
  const { client } = useServices();
  const catalog = useLiveQuery(AdminAircraftCatalogOperation, {}, 'aircraft');
  const aircraftList: Aircraft[] = catalog.data?.adminAircraftCatalog ?? [];
  const { busy, error, intent, run, clearError } = useAction();
  const [draft, setDraft] = useState<FlightDraft>(emptyDraft); const [errors, setErrors] = useState<DraftErrors>({});
  const [step, setStep] = useState<'form' | 'confirm'>('form'); const [acknowledged, setAcknowledged] = useState(false);
  const [copyId, setCopyId] = useState(''); const [factor, setFactor] = useState('1'); const [copyError, setCopyError] = useState<AppError | null>(null); const [copying, setCopying] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);

  const aircraft = aircraftList.find((value) => value.code === draft.aircraft);
  const set = <K extends keyof FlightDraft>(field: K, value: FlightDraft[K]): void => { setDraft((previous) => ({ ...previous, [field]: value })); clearError(); };
  const chooseAircraft = (code: string): void => { setDraft((previous) => ({ ...previous, aircraft: code, fares: faresFor(aircraftList.find((value) => value.code === code)) })); setCopyId(''); clearError(); };
  const setFare = (index: number, change: Partial<FareDraft>): void => { setDraft((previous) => ({ ...previous, fares: previous.fares.map((fare, position) => (position === index ? { ...fare, ...change } : fare)) })); clearError(); };
  const addBrand = (cabin: Cabin): void => { setDraft((previous) => { const last = previous.fares.map((fare) => fare.cabinClass).lastIndexOf(cabin); const next = [...previous.fares]; next.splice(last + 1, 0, emptyFare(cabin, '')); return { ...previous, fares: next }; }); };
  const removeFare = (index: number): void => { setDraft((previous) => ({ ...previous, fares: previous.fares.filter((_, position) => position !== index) })); };
  const arrival = arrivalLocalOf(draft);

  const candidates = useMemo(() => sources.filter((source) => source.aircraft && source.aircraft === draft.aircraft), [sources, draft.aircraft]);
  const copy = async (): Promise<void> => {
    const parsed = parseFactor(factor); if (!parsed || !aircraft || !copyId) { setCopyError(null); setErrors((previous) => ({ ...previous, factor: 'Escribe un factor mayor que 0 (por ejemplo, 1.10).' })); return; }
    setCopying(true); setCopyError(null);
    try {
      const data = await client.execute(AdminFaresOperation, { flightInstanceId: copyId }, { correlationId: newCorrelationId() });
      const rows = copyFares(data.adminFares as unknown as StoredFare[], aircraft, parsed);
      setDraft((previous) => ({ ...previous, fares: rows.length ? rows : previous.fares })); setErrors((previous) => { const { factor: ignored, ...rest } = previous; void ignored; return rest; });
    } catch (failure) { setCopyError(toAppError(failure)); } finally { setCopying(false); }
  };

  const review = (): void => {
    const found = validateDraft(draft, aircraft, new Date()); setErrors(found);
    if (Object.keys(found).length === 0) { setAcknowledged(false); setStep('confirm'); }
  };
  const execute = async (): Promise<void> => {
    if (!acknowledged) return;
    const input = toCreateInput(draft);
    const result = await run('create-flight', draftSignature(draft), (current) => client.execute(CreateFlightOperation, { input, idempotencyKey: current.idempotencyKey }, { correlationId: current.correlationId }));
    if (result) onDone(result.createFlight);
  };
  const serverReasons = error?.invalidParams.filter((param) => param.reason) ?? [];
  const reasonsNotice = serverReasons.length > 0 ? <div className={a.wide}><Notice kind="error" title="El servidor rechazó estos datos"><ul>{serverReasons.map((param, index) => <li key={`${param.name}-${index}`}><code>{param.name}</code>: {reasonText(param.reason)}</li>)}</ul></Notice></div> : null;

  if (step === 'confirm' && aircraft) {
    const input = toCreateInput(draft); const number = flightNumberOf(draft.digits);
    return (
      <section className={a.confirm} aria-labelledby="create-confirm-title" data-testid="create-flight-confirm">
        <h3 id="create-confirm-title" tabIndex={-1} ref={heading}>Confirma la creación del vuelo {number}</h3>
        <dl className={a.diff}>
          <div className={a.diffRow}><dt>Ruta</dt><dd>{cityOf(draft.origin)} ({draft.origin}) → {cityOf(draft.destination)} ({draft.destination})</dd><dd /></div>
          <div className={a.diffRow}><dt>Salida (hora local del origen)</dt><dd>{localLabel(draft.departureLocal, draft.origin)}</dd><dd /></div>
          <div className={a.diffRow}><dt>Llegada (hora local del destino)</dt><dd data-testid="create-arrival">{arrival ? localLabel(arrival, draft.destination) : '—'}</dd><dd /></div>
          <div className={a.diffRow}><dt>Duración</dt><dd>{draft.durationMinutes} minutos</dd><dd /></div>
          <div className={a.diffRow}><dt>Avión</dt><dd>{aircraft.code}: {aircraft.cabins.map((cabin) => `${CABIN_LABEL[cabin.cabinClass] ?? cabin.cabinClass} ${cabin.seats}`).join(' · ')} asientos</dd><dd /></div>
          <div className={a.diffRow}><dt>Estado inicial</dt><dd>{draft.leaveClosed ? 'Cerrado, para revisarlo' : 'Se abrirá a la venta si todas las tarifas quedan guardadas'}</dd><dd /></div>
        </dl>
        <div className={a.tableWrap}>
          <table className={a.table}>
            <caption>Tarifas (USD)</caption>
            <thead><tr><th scope="col">Cabina</th><th scope="col">Marca</th><th scope="col" className={a.num}>Base</th><th scope="col" className={a.num}>Tasas</th><th scope="col" className={a.num}>Total</th><th scope="col">Reglas</th><th scope="col" className={a.num}>Maleta extra</th></tr></thead>
            <tbody>
              {input.fares.map((fare, index) => (
                <tr key={`${fare.cabinClass}-${index}`}>
                  <th scope="row">{CABIN_LABEL[fare.cabinClass] ?? fare.cabinClass}</th><td>{fare.fareBrand}</td><td className={a.num}>{fare.baseFare}</td><td className={a.num}>{fare.taxes}</td><td className={a.num}>{totalOf({ baseFare: fare.baseFare, taxes: fare.taxes })}</td>
                  <td>{fare.isRefundable ? 'Reembolsable' : 'No reembolsable'} · {fare.isChangeable ? 'con cambios' : 'sin cambios'} · mano {fare.carryOnIncluded} · facturadas {fare.checkedBaggageIncluded}</td><td className={a.num}>{fare.extraBaggagePrice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Notice kind="warning" title="Una vez creado, el vuelo no se puede borrar">
          <p>{draft.leaveClosed ? 'El vuelo quedará cerrado: no aparece en la web ni en Booking hasta que lo abras a la venta, pero tampoco se puede eliminar.' : 'Al abrirse a la venta, el vuelo aparecerá de inmediato en la web y en las búsquedas de Booking. No se puede borrar; solo se puede cerrar o cambiar su estado.'}</p>
        </Notice>
        <label className={a.check}><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />Entiendo que el vuelo {number} no se puede borrar</label>
        {error ? (
          <>
            <ErrorPanel error={error} idempotencyKey={intent?.idempotencyKey} onRetry={() => void execute()} />
            {reasonsNotice}
            {error.category === 'UNAVAILABLE' || error.category === 'INTERNAL' ? <Notice kind="info" title="Si el vuelo quedó incompleto"><p>Quedará CERRADO en la lista de vuelos, sin venderse. Pulsa «Reintentar» (usa la misma clave de idempotencia) para completarlo sin duplicarlo.</p></Notice> : null}
          </>
        ) : null}
        <div className={ui.actions}>
          <Button onClick={() => void execute()} loading={busy} disabled={!acknowledged}>Crear el vuelo</Button>
          <Button variant="secondary" onClick={() => { clearError(); setStep('form'); }} disabled={busy}>Volver a editar</Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Descartar</Button>
        </div>
      </section>
    );
  }

  return (
    <section className={`${ui.card} ${a.panel}`} aria-labelledby="create-title" data-testid="create-flight-form">
      <div className={a.panelHead}><h3 id="create-title" tabIndex={-1} ref={heading}>Crear un vuelo</h3><p className={a.muted}>El vuelo nace cerrado: se guardan las tarifas, se comprueban y solo entonces se abre a la venta.</p></div>
      {catalog.loading ? <LoadingState phase="normal" label="Cargando los aviones" skeletons={1} /> : null}
      {catalog.error ? <ErrorPanel error={catalog.error} onRetry={catalog.reload} /> : null}
      <form className={a.form} onSubmit={(event) => { event.preventDefault(); review(); }} noValidate>
        <TextField label={`Número de vuelo (${FLIGHT_PREFIX} + 1 a 4 dígitos)`} value={draft.digits} onChange={(event) => set('digits', event.target.value.replace(/\D/g, '').slice(0, 4))} error={errors.digits} inputMode="numeric" autoComplete="off" hint={`Se creará como ${FLIGHT_PREFIX}${draft.digits || '…'}`} />
        <SelectField label="Avión" value={draft.aircraft} onChange={(event) => chooseAircraft(event.target.value)} error={errors.aircraft} disabled={catalog.loading || aircraftList.length === 0}>
          <option value="">Elige un avión</option>
          {aircraftList.map((value) => <option key={value.code} value={value.code}>{value.code} · {value.cabins.map((cabin) => `${CABIN_LABEL[cabin.cabinClass] ?? cabin.cabinClass} ${cabin.seats}`).join(', ')}</option>)}
        </SelectField>
        <SelectField label="Origen" value={draft.origin} onChange={(event) => set('origin', event.target.value)} error={errors.origin}>
          <option value="">Elige el origen</option>{AIRPORTS.map((airport) => <option key={airport.iata} value={airport.iata}>{airport.city} ({airport.iata})</option>)}
        </SelectField>
        <SelectField label="Destino" value={draft.destination} onChange={(event) => set('destination', event.target.value)} error={errors.destination}>
          <option value="">Elige el destino</option>{AIRPORTS.filter((airport) => airport.iata !== draft.origin).map((airport) => <option key={airport.iata} value={airport.iata}>{airport.city} ({airport.iata})</option>)}
        </SelectField>
        <TextField label={`Salida (hora local de ${draft.origin ? cityOf(draft.origin) : 'origen'})`} type="datetime-local" value={draft.departureLocal} onChange={(event) => set('departureLocal', event.target.value)} error={errors.departureLocal} hint="Anticipación: de 60 minutos a 400 días." />
        <TextField label="Duración (minutos)" value={draft.durationMinutes} onChange={(event) => set('durationMinutes', event.target.value.replace(/\D/g, '').slice(0, 4))} error={errors.durationMinutes} inputMode="numeric" autoComplete="off" hint="De 20 minutos a 20 horas." />
        <p className={`${a.wide} ${a.muted}`} data-testid="create-arrival-preview" aria-live="polite">{arrival ? `Llegada calculada: ${localLabel(arrival, draft.destination)} (hora local de ${cityOf(draft.destination)}).` : 'La llegada se calcula con la salida y la duración.'}</p>

        {aircraft ? (
          <>
            <div className={`${a.wide} ${a.panelHead}`}><h4>Tarifas por cabina y marca</h4><p className={a.muted}>Una por cabina como mínimo; hasta {MAX_FARES_PER_CABIN} marcas por cabina. Importes en USD; el total es base + tasas.</p></div>
            {candidates.length > 0 ? (
              <div className={`${a.wide} ${a.toolbar}`} role="group" aria-label="Copiar las tarifas de otro vuelo">
                <SelectField label="Copiar tarifas de otro vuelo (mismo avión)" value={copyId} onChange={(event) => setCopyId(event.target.value)}>
                  <option value="">No copiar</option>{candidates.map((source) => <option key={source.flightInstanceId} value={source.flightInstanceId}>{source.flightNumber}</option>)}
                </SelectField>
                <TextField label="Factor" value={factor} onChange={(event) => setFactor(event.target.value)} inputMode="decimal" autoComplete="off" error={errors.factor} hint="1.10 sube 10 %" />
                <Button variant="secondary" onClick={() => void copy()} loading={copying} disabled={!copyId}>Copiar tarifas</Button>
              </div>
            ) : null}
            {copyError ? <div className={a.wide}><ErrorPanel error={copyError} onRetry={() => void copy()} /></div> : null}
            {aircraft.cabins.map((cabin) => (
              <fieldset key={cabin.cabinClass} className={`${a.wide} ${a.panel}`} data-testid={`fares-${cabin.cabinClass}`}>
                <legend>{CABIN_LABEL[cabin.cabinClass] ?? cabin.cabinClass} · {cabin.seats} asientos</legend>
                {errors[`cabin.${cabin.cabinClass}`] ? <p role="alert" className={ui.fieldError}>{errors[`cabin.${cabin.cabinClass}`]}</p> : null}
                {draft.fares.map((fare, index) => (fare.cabinClass !== cabin.cabinClass ? null : (
                  <div key={index} className={a.form} role="group" aria-label={`Tarifa ${fare.fareBrand || 'nueva'} de ${CABIN_LABEL[cabin.cabinClass] ?? cabin.cabinClass}`}>
                    <TextField label="Marca" value={fare.fareBrand} onChange={(event) => setFare(index, { fareBrand: event.target.value })} error={errors[`fares.${index}.fareBrand`]} maxLength={32} autoComplete="off" hint="Por ejemplo Basic, Flex" />
                    <TextField label="Tarifa base (USD)" value={fare.baseFare} onChange={(event) => setFare(index, { baseFare: event.target.value })} error={errors[`fares.${index}.baseFare`]} inputMode="decimal" autoComplete="off" />
                    <TextField label="Tasas (USD)" value={fare.taxes} onChange={(event) => setFare(index, { taxes: event.target.value })} error={errors[`fares.${index}.taxes`]} inputMode="decimal" autoComplete="off" hint={`Total: ${totalOf(fare) ?? '—'} USD`} />
                    <TextField label="Maleta extra (USD)" value={fare.extraBaggagePrice} onChange={(event) => setFare(index, { extraBaggagePrice: event.target.value })} error={errors[`fares.${index}.extraBaggagePrice`]} inputMode="decimal" autoComplete="off" />
                    <TextField label="Equipaje de mano incluido" value={fare.carryOnIncluded} onChange={(event) => setFare(index, { carryOnIncluded: event.target.value })} error={errors[`fares.${index}.carryOnIncluded`]} inputMode="numeric" autoComplete="off" />
                    <TextField label="Maletas facturadas incluidas" value={fare.checkedBaggageIncluded} onChange={(event) => setFare(index, { checkedBaggageIncluded: event.target.value })} error={errors[`fares.${index}.checkedBaggageIncluded`]} inputMode="numeric" autoComplete="off" />
                    <div className={`${a.wide} ${a.row}`}>
                      <label className={a.check}><input type="checkbox" checked={fare.isRefundable} onChange={(event) => setFare(index, { isRefundable: event.target.checked })} />Reembolsable</label>
                      <label className={a.check}><input type="checkbox" checked={fare.isChangeable} onChange={(event) => setFare(index, { isChangeable: event.target.checked })} />Permite cambios</label>
                      {draft.fares.filter((value) => value.cabinClass === cabin.cabinClass).length > 1 ? <Button size="small" variant="secondary" onClick={() => removeFare(index)}>Quitar esta marca</Button> : null}
                    </div>
                  </div>
                )))}
                {draft.fares.filter((fare) => fare.cabinClass === cabin.cabinClass).length < MAX_FARES_PER_CABIN ? <div><Button size="small" variant="secondary" onClick={() => addBrand(cabin.cabinClass as Cabin)}>Agregar otra marca en {CABIN_LABEL[cabin.cabinClass] ?? cabin.cabinClass}</Button></div> : null}
              </fieldset>
            ))}
          </>
        ) : null}

        <div className={a.wide}>
          <label className={a.check}><input type="checkbox" checked={draft.leaveClosed} onChange={(event) => set('leaveClosed', event.target.checked)} />Dejarlo cerrado para revisarlo (no se abre a la venta al terminar)</label>
        </div>
        {reasonsNotice}
        <div className={`${a.wide} ${ui.actions}`}>
          <Button type="submit">Revisar el resumen</Button>
          <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        </div>
      </form>
    </section>
  );
}
