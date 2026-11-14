import { useEffect, useRef, useState } from 'react';
import { cityOf, formatDate, formatLocalDate, formatLocalTimeWithZone } from '@flight-platform/format';
import { UpdateFlightStatusOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { FlightStatusCode, UpdateFlightStatusMutation } from '@flight-platform/graphql-schema/generated/types';
import { useServices } from '../app/services';
import { useAction } from '../bookings/useAction';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { SelectField, TextField } from '../components/ui/Field';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { isoToLocal } from './airport-time';
import { confirmationMatches, confirmationNotes, emptyDraft, isIrreversible, STATUS_LABEL, statusSignature, targetsFrom, toStatusInput, validateStatus, REASON_MAX, type StatusContext, type StatusDraft, type StatusErrors } from './status-rules';
import a from './admin.module.css';

export type StatusResult = UpdateFlightStatusMutation['updateFlightStatus'];
export interface StatusTarget { flightNumber: string; origin: string; destination: string; departureAt: string; arrivalAt: string | null; date: string; current: FlightStatusCode | null }

const localLabel = (value: string, iata: string): string => (value ? `${formatDate(value.slice(0, 10))} ${value.slice(11)} · ${cityOf(iata)}` : '—');

/**
 * Cambio de estado de un vuelo en DOS pasos: el formulario y una confirmación clara (avisa a los socios y a los clientes por los webhooks; si es
 * irreversible, exige escribir el número del vuelo). La acción lleva su X-Correlation-Id y su Idempotency-Key por intención: un doble clic no la aplica dos veces.
 */
export function StatusChangePanel({ target, onDone, onCancel }: { target: StatusTarget; onDone: (result: StatusResult, target: StatusTarget) => void; onCancel: () => void }) {
  const { client } = useServices();
  const { busy, error, intent, run, clearError } = useAction();
  const [draft, setDraft] = useState<StatusDraft>(() => emptyDraft(target.current)); const [errors, setErrors] = useState<StatusErrors>({});
  const [step, setStep] = useState<'form' | 'confirm'>('form'); const [typed, setTyped] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const context: StatusContext = { flightNumber: target.flightNumber, date: target.date, current: target.current, origin: target.origin, destination: target.destination, departureAt: target.departureAt };
  useEffect(() => { heading.current?.focus(); }, [step, target.flightNumber]);

  const set = <K extends keyof StatusDraft>(field: K, value: StatusDraft[K]): void => { setDraft((previous) => ({ ...previous, [field]: value })); clearError(); };
  const review = (): void => {
    const found = validateStatus(draft, context); setErrors(found);
    if (Object.keys(found).length === 0) { setTyped(''); setStep('confirm'); }
  };
  const irreversible = draft.status !== '' && isIrreversible(draft.status);
  const confirmed = !irreversible || confirmationMatches(typed, target.flightNumber);
  const input = draft.status ? toStatusInput(draft, context) : null;
  const execute = async (): Promise<void> => {
    if (!input || !confirmed) return;
    const result = await run('flight-status', statusSignature(input, target.flightNumber), (current) =>
      client.execute(UpdateFlightStatusOperation, { flightNumber: target.flightNumber, input, idempotencyKey: current.idempotencyKey }, { correlationId: current.correlationId }));
    if (result) onDone(result.updateFlightStatus, target);
  };
  const notes = draft.status ? confirmationNotes(draft.status) : null;
  const title = `${target.flightNumber} · ${formatLocalDate(target.departureAt, target.origin, { weekday: true })}`;
  const targets = targetsFrom(target.current);

  if (step === 'confirm' && notes && input) {
    return (
      <section className={a.confirm} aria-labelledby="confirm-title" data-testid="status-confirm">
        <h3 id="confirm-title" tabIndex={-1} ref={heading}>Confirma el cambio de estado del vuelo {target.flightNumber}</h3>
        <dl className={a.diff}>
          <div className={a.diffRow}><dt>Estado</dt><dd>{target.current ? STATUS_LABEL[target.current] : 'No disponible'}</dd><dd>{STATUS_LABEL[input.status]}</dd></div>
          {input.estimatedDepartureAt ? <div className={a.diffRow}><dt>Salida estimada</dt><dd>—</dd><dd>{localLabel(draft.estimatedDeparture, target.origin)} ({formatLocalTimeWithZone(input.estimatedDepartureAt, target.origin)})</dd></div> : null}
          {input.estimatedArrivalAt ? <div className={a.diffRow}><dt>Llegada estimada</dt><dd>—</dd><dd>{localLabel(draft.estimatedArrival, target.destination)} ({formatLocalTimeWithZone(input.estimatedArrivalAt, target.destination)})</dd></div> : null}
          {input.departureGate ? <div className={a.diffRow}><dt>Puerta de embarque</dt><dd>—</dd><dd>{input.departureGate}</dd></div> : null}
          {input.reason ? <div className={a.diffRow}><dt>Motivo</dt><dd>—</dd><dd>{input.reason}</dd></div> : null}
        </dl>
        <Notice kind="info" title="A quién avisa este cambio"><p>{notes.notifies}</p></Notice>
        {notes.irreversible ? <Notice kind="warning" title="Este cambio es irreversible"><p>{notes.irreversible}</p></Notice> : null}
        {irreversible ? (
          <TextField label={`Para confirmar, escribe el número del vuelo (${target.flightNumber})`} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        ) : null}
        {error ? <ErrorPanel error={error} idempotencyKey={intent?.idempotencyKey} onRetry={() => void execute()} /> : null}
        <div className={ui.actions}>
          <Button onClick={() => void execute()} loading={busy} disabled={!confirmed}>Confirmar cambio</Button>
          <Button variant="secondary" onClick={() => { clearError(); setStep('form'); }} disabled={busy}>Volver a editar</Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Descartar</Button>
        </div>
      </section>
    );
  }

  return (
    <section className={`${ui.card} ${a.panel}`} aria-labelledby="status-title" data-testid="status-form">
      <div className={a.panelHead}>
        <h3 id="status-title" tabIndex={-1} ref={heading}>Cambiar el estado del vuelo {title}</h3>
        <p className={a.muted}>{cityOf(target.origin)} → {cityOf(target.destination)} · salida programada {formatLocalTimeWithZone(target.departureAt, target.origin)}{target.current ? ` · estado actual: ${STATUS_LABEL[target.current].toLowerCase()}` : ''}</p>
      </div>
      <form className={a.form} onSubmit={(event) => { event.preventDefault(); review(); }} noValidate>
        <SelectField label="Nuevo estado" value={draft.status} onChange={(event) => set('status', event.target.value as FlightStatusCode | '')} error={errors.status}>
          {!target.current ? <option value="">Elige un estado</option> : null}
          {targets.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}{status === target.current ? ' (actual)' : ''}</option>)}
        </SelectField>
        <TextField label="Puerta de embarque" value={draft.gate} onChange={(event) => set('gate', event.target.value)} error={errors.gate} maxLength={8} autoComplete="off" hint="Opcional. Hasta 8 caracteres." />
        {draft.status !== 'CANCELLED' ? (
          <>
            <TextField label={`Salida estimada (hora de ${cityOf(target.origin)})`} type="datetime-local" value={draft.estimatedDeparture} onChange={(event) => set('estimatedDeparture', event.target.value)} error={errors.estimatedDeparture} min={isoToLocal(target.departureAt, target.origin)} hint={draft.status === 'DELAYED' ? 'Obligatoria en un retraso.' : 'Opcional.'} />
            <TextField label={`Llegada estimada (hora de ${cityOf(target.destination)})`} type="datetime-local" value={draft.estimatedArrival} onChange={(event) => set('estimatedArrival', event.target.value)} error={errors.estimatedArrival} hint="Opcional." />
          </>
        ) : null}
        <div className={a.wide}>
          <TextField label="Motivo" value={draft.reason} onChange={(event) => set('reason', event.target.value)} error={errors.reason} maxLength={REASON_MAX} autoComplete="off" hint={`Opcional. Hasta ${REASON_MAX} caracteres.`} />
        </div>
        <div className={`${a.wide} ${ui.actions}`}>
          <Button type="submit">Revisar el cambio</Button>
          <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        </div>
      </form>
    </section>
  );
}
