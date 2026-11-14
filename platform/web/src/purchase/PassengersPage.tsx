import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney } from '@flight-platform/format';
import { ReleaseHoldOperation } from '@flight-platform/graphql-schema/generated/operations';
import { usePageTitle } from '../app/page';
import { usePurchase, useServices } from '../app/services';
import { pageClass } from '../components/layout/AppLayout';
import { Button, ButtonLink } from '../components/ui/Button';
import { SelectField, TextField } from '../components/ui/Field';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { newCorrelationId } from '../data/identity';
import { COUNTRIES } from './countries';
import { HoldGate, HoldTimer, useHoldClock } from './HoldTimer';
import { fieldKey, MAX_EXTRA_BAGGAGE, needsSeat, typeLabel, validatePassengers, type PassengerDraft } from './passenger-rules';
import { baggageTotal, optionFor } from './pricing';
import { money, RequireSession, Stepper, SummaryLine } from './Shared';
import s from './purchase.module.css';

/** Datos de los pasajeros, asiento de cada uno y equipaje adicional (diseño F12c-0 §3.6), con la validación de reglas antes de llamar al servidor. */
export function PassengersPage() {
  return <RequireSession><PassengersScreen /></RequireSession>;
}

function PassengersScreen() {
  usePageTitle('Datos de los pasajeros');
  const navigate = useNavigate(); const { client } = useServices(); const { state, store } = usePurchase();
  const { offer, drafts } = state; const back = state.back ?? '/';
  const clock = useHoldClock(state.hold?.holdId ?? null);
  const [submitted, setSubmitted] = useState(false);
  const [sameContact, setSameContact] = useState(true);
  const summary = useRef<HTMLDivElement>(null);

  const segments = useMemo(() => (offer ? offer.itineraries.flatMap((itinerary) => itinerary.segments.map((segment) => ({ departureAt: segment.departure.at, departureIata: segment.departure.iataCode, arrivalIata: segment.arrival.iataCode }))) : []), [offer]);
  const errors = useMemo(() => validatePassengers(drafts, { segments }), [drafts, segments]);

  if (!offer || !state.hold) {
    return (
      <div className={pageClass}>
        <div className={ui.statePage}>
          <h1>Primero elige tus asientos</h1>
          <p>No encontramos una selección en curso. Vuelve a los resultados para empezar.</p>
          <ButtonLink to={back}>Volver a los resultados</ButtonLink>
        </div>
      </div>
    );
  }

  const update = (index: number, patch: Partial<PassengerDraft>): void => {
    const next = drafts.map((draft, position) => (position === index ? { ...draft, ...patch } : draft));
    if (sameContact && index === 0 && ('email' in patch || 'phone' in patch)) for (let i = 1; i < next.length; i += 1) next[i] = { ...next[i], email: next[0].email, phone: next[0].phone };
    store.setDrafts(next);
  };
  const setBaggage = (index: number, itineraryId: string, quantity: number): void => update(index, { extraBaggage: { ...drafts[index].extraBaggage, [itineraryId]: quantity } });
  const shown = (index: number, field: string): string | undefined => (submitted ? errors[fieldKey(index, field)] : undefined);
  const adults = drafts.filter((draft) => draft.passengerType === 'ADULT');
  const seatIndexOf = (draftIndex: number): number => drafts.slice(0, draftIndex).filter((draft) => needsSeat(draft.passengerType)).length;

  const next = (): void => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) { summary.current?.focus(); return; }
    navigate('/compra/pago');
  };
  const changeSeats = async (): Promise<void> => {
    try { await client.execute(ReleaseHoldOperation, { holdId: state.hold!.holdId }, { correlationId: store.correlationId(newCorrelationId) }); } catch { /* ya vencido o liberado */ }
    store.setHold(null); store.intents.clear(); navigate(`/oferta/${encodeURIComponent(offer.offerId)}`);
  };

  const quantities = drafts.map((draft) => draft.extraBaggage);
  const extras = baggageTotal(offer, state.selections, quantities);
  const total = state.hold && clock.hold ? clock.hold.lockedPrice : null;

  return (
    <div className={pageClass}>
      <Stepper current={2} />
      <h1 className={s.heading}>Datos de los pasajeros</h1>
      <p className={s.lead}>Escribe los datos tal como aparecen en el documento de viaje de cada pasajero.</p>
      <HoldGate clock={clock} searchHref={back} />

      <div className={s.twoCol}>
        <form className={s.stack} noValidate onSubmit={(event) => { event.preventDefault(); next(); }} aria-label="Datos de los pasajeros">
          <div ref={summary} tabIndex={-1}>
            {submitted && Object.keys(errors).length > 0 ? <Notice kind="error" title="Revisa los datos marcados."><p>Hay {Object.keys(errors).length} {Object.keys(errors).length === 1 ? 'campo' : 'campos'} por corregir antes de continuar.</p></Notice> : null}
          </div>
          {drafts.map((draft, index) => (
            <section key={draft.passengerId} className={`${ui.card} ${s.paxCard}`} aria-labelledby={`pax-${index}`}>
              <div className={s.paxHead}>
                <h2 id={`pax-${index}`} className={s.paxTitle}>Pasajero {index + 1} · {typeLabel(draft.passengerType)}</h2>
                <span className={ui.tag}>{needsSeat(draft.passengerType) ? `Asientos: ${seatSummary(state.seats, offer.itineraries.flatMap((i) => i.segments.map((sg) => ({ id: sg.segmentId, flight: sg.flightNumber }))), seatIndexOf(index))}` : 'Viaja en brazos, sin asiento'}</span>
              </div>
              <div className={s.fields}>
                <TextField label="Nombres" autoComplete="given-name" value={draft.firstName} onChange={(event) => update(index, { firstName: event.target.value })} error={shown(index, 'firstName')} maxLength={60} />
                <TextField label="Apellidos" autoComplete="family-name" value={draft.lastName} onChange={(event) => update(index, { lastName: event.target.value })} error={shown(index, 'lastName')} maxLength={60} />
                <SelectField label="Tipo de documento" value={draft.documentType} onChange={(event) => update(index, { documentType: event.target.value as PassengerDraft['documentType'] })} error={shown(index, 'documentType')}>
                  <option value="NATIONAL_ID">Cédula de identidad</option>
                  <option value="PASSPORT">Pasaporte</option>
                </SelectField>
                <TextField label="Número de documento" autoComplete="off" value={draft.documentNumber} onChange={(event) => update(index, { documentNumber: event.target.value })} error={shown(index, 'documentNumber')} maxLength={20} />
                <TextField label={draft.documentType === 'PASSPORT' ? 'Vencimiento del pasaporte' : 'Vencimiento del documento (opcional)'} type="date" value={draft.documentExpiryDate} onChange={(event) => update(index, { documentExpiryDate: event.target.value })} error={shown(index, 'documentExpiryDate')} />
                <SelectField label="Nacionalidad" value={draft.nationality} onChange={(event) => update(index, { nationality: event.target.value })} error={shown(index, 'nationality')}>
                  {COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
                </SelectField>
                <TextField label="Fecha de nacimiento" type="date" autoComplete="bday" value={draft.birthDate} onChange={(event) => update(index, { birthDate: event.target.value })} error={shown(index, 'birthDate')} />
                <SelectField label="Género" value={draft.gender} onChange={(event) => update(index, { gender: event.target.value as PassengerDraft['gender'] })} error={shown(index, 'gender')}>
                  <option value="">Elige una opción</option>
                  <option value="F">Femenino</option>
                  <option value="M">Masculino</option>
                  <option value="X">Otro</option>
                </SelectField>
                {index === 0 || !sameContact ? (
                  <>
                    <TextField label="Correo electrónico de contacto" type="email" autoComplete="email" value={draft.email} onChange={(event) => update(index, { email: event.target.value })} error={shown(index, 'email')} />
                    <TextField label="Teléfono de contacto" type="tel" autoComplete="tel" value={draft.phone} onChange={(event) => update(index, { phone: event.target.value })} error={shown(index, 'phone')} hint="Con código de país, por ejemplo +593…" />
                  </>
                ) : null}
                {draft.passengerType === 'INFANT' ? (
                  <SelectField label="Viaja con el adulto" className={s.fieldWide} value={draft.associatedAdultId} onChange={(event) => update(index, { associatedAdultId: event.target.value })} error={shown(index, 'associatedAdultId')}>
                    <option value="">Elige un adulto</option>
                    {adults.map((adult, position) => <option key={adult.passengerId} value={adult.passengerId}>{adult.firstName.trim() ? `${adult.firstName.trim()} ${adult.lastName.trim()}` : `Pasajero ${drafts.indexOf(adult) + 1} (adulto ${position + 1})`}</option>)}
                  </SelectField>
                ) : null}
              </div>
              {index === 0 && drafts.length > 1 ? (
                <label className={s.check}><input type="checkbox" checked={sameContact} onChange={(event) => { setSameContact(event.target.checked); if (event.target.checked) store.setDrafts(drafts.map((d, i) => (i === 0 ? d : { ...d, email: drafts[0].email, phone: drafts[0].phone }))); }} />Usar este contacto para todos los pasajeros</label>
              ) : null}
              {needsSeat(draft.passengerType) ? (
                <div className={s.baggage}>
                  <strong>Equipaje adicional</strong>
                  {offer.itineraries.map((itinerary) => {
                    const option = optionFor(itinerary, state.selections[itinerary.itineraryId]); const unit = option?.extraCheckedBaggagePrice;
                    const id = `bag-${index}-${itinerary.itineraryId}`;
                    return (
                      <SelectField key={itinerary.itineraryId} label={`${itinerary.segments.map((segment) => segment.flightNumber).join(', ')} · maletas adicionales${unit ? ` (${formatMoney(unit)} c/u)` : ''}`} id={id} value={String(draft.extraBaggage[itinerary.itineraryId] ?? 0)} onChange={(event) => setBaggage(index, itinerary.itineraryId, Number(event.target.value))} error={shown(index, `extraBaggage.${itinerary.itineraryId}`)}>
                        {Array.from({ length: MAX_EXTRA_BAGGAGE + 1 }, (_, quantity) => <option key={quantity} value={quantity}>{quantity}</option>)}
                      </SelectField>
                    );
                  })}
                </div>
              ) : null}
            </section>
          ))}
          <div className={s.row}>
            <Button type="submit" disabled={clock.phase === 'expired'}>Continuar al pago</Button>
            <Button variant="secondary" onClick={() => void changeSeats()}>Cambiar asientos</Button>
          </div>
        </form>

        <aside className={`${ui.card} ${s.aside}`} aria-label="Resumen de tu compra">
          <HoldTimer clock={clock} />
          <h2>Resumen</h2>
          <dl className={s.lines}>
            <SummaryLine label="Pasajeros">{drafts.length}</SummaryLine>
            <SummaryLine label="Tarifas y tasas">{money(total)}</SummaryLine>
            <SummaryLine label="Equipaje adicional">{formatMoney({ currency: offer.grandTotal.currency, total: extras })}</SummaryLine>
          </dl>
          <p className={s.muted}>Precio congelado al reservar tus asientos.</p>
        </aside>
      </div>
    </div>
  );
}

/** «FP103: 12A · FP105: 14C» para el pasajero que ocupa la posición `seatIndex` entre quienes tienen asiento. */
function seatSummary(seats: Readonly<Record<string, string[]>>, segments: ReadonlyArray<{ id: string; flight: string }>, seatIndex: number): string {
  return segments.map((segment) => `${segment.flight}: ${seats[segment.id]?.[seatIndex] || '—'}`).join(' · ');
}
