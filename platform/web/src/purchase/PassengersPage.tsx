import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatMoney } from '@flight-platform/format';
import { ReleaseHoldOperation } from '@flight-platform/graphql-schema/generated/operations';
import { usePageTitle } from '../app/page';
import { usePurchase, useServices } from '../app/services';
import { pageClass } from '../components/layout/AppLayout';
import { Button, ButtonLink } from '../components/ui/Button';
import { CountryCombobox } from '../components/ui/CountryCombobox';
import { DateField } from '../components/ui/DateField';
import { SelectField, TextField } from '../components/ui/Field';
import { FilteredTextField } from '../components/ui/FilteredField';
import { Notice } from '../components/ui/Notice';
import { PhoneField } from '../components/ui/PhoneField';
import ui from '../components/ui/ui.module.css';
import { newCorrelationId } from '../data/identity';
import { HoldGate, HoldTimer, useHoldClock } from './HoldTimer';
import { adjustDocument, filterDocument, filterName } from './input-filters';
import { birthDateRange, documentRule, expiryRange, fieldKey, isNormalizedField, lastTravelDate, needsSeat, normalizeDraft, normalizeField, typeLabel, validatePassengers, type PassengerDraft } from './passenger-rules';
import { baggageTotal, extraBaggageLimits, optionFor } from './pricing';
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
  // Los errores de un campo se muestran al salir de él (o al enviar), nunca mientras se escribe.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  // Si el servidor rechazó el contacto de un pasajero que comparte el del primero, se muestran los campos de cada uno.
  const [sameContact, setSameContact] = useState(() => !Object.keys(state.serverErrors).some((key) => /^[1-9]\d*\.(email|phone)$/.test(key)));
  const summary = useRef<HTMLDivElement>(null);
  const focusedServer = useRef('');
  // Avisos de ajuste del número de documento (índice del pasajero → texto); se retiran solos a los 6 s o al escribir en ese campo.
  const [notices, setNotices] = useState<Readonly<Record<number, string>>>({});
  const noticeCount = Object.keys(notices).length;
  useEffect(() => {
    if (!noticeCount) return undefined;
    const timer = window.setTimeout(() => setNotices({}), 6000);
    return () => window.clearTimeout(timer);
  }, [notices, noticeCount]);

  const segments = useMemo(() => (offer ? offer.itineraries.flatMap((itinerary) => itinerary.segments.map((segment) => ({ departureAt: segment.departure.at, departureIata: segment.departure.iataCode, arrivalIata: segment.arrival.iataCode }))) : []), [offer]);
  const travel = useMemo(() => lastTravelDate(segments), [segments]); const todayIso = new Date().toISOString().slice(0, 10);
  // Máximo de maletas adicionales por tramo con la tarifa elegida (se recalcula al cambiar de tarifa; ver `maxExtraBaggage`).
  const limits = useMemo(() => (offer ? extraBaggageLimits(offer, state.selections) : {}), [offer, state.selections]);
  const errors = useMemo(() => validatePassengers(drafts, { segments, maxExtraBaggage: limits }), [drafts, segments, limits]);
  // Errores que devolvió el servidor al pagar: se enfoca el primer campo con error una sola vez por conjunto de errores.
  const serverSignature = Object.keys(state.serverErrors).join('|');
  useEffect(() => {
    if (!serverSignature) { focusedServer.current = ''; return; }
    if (focusedServer.current === serverSignature) return;
    // El marco de la app lleva el foco a <main> al cambiar de ruta (en un efecto del padre, que corre después de este): se espera un ciclo para que gane el campo.
    const timer = window.setTimeout(() => { focusedServer.current = serverSignature; focusField(firstInOrder(serverSignature.split('|'))); }, 0);
    return () => window.clearTimeout(timer);
  }, [serverSignature]);
  const [adjusted, setAdjusted] = useState(false);
  // Si se cambió de tarifa y una cantidad ya elegida excede el nuevo máximo, se ajusta al máximo y se avisa.
  useEffect(() => {
    let changed = false;
    const next = drafts.map((draft) => {
      const extraBaggage = { ...draft.extraBaggage }; let touched = false;
      for (const [itineraryId, quantity] of Object.entries(extraBaggage)) { const max = limits[itineraryId]; if (max !== undefined && quantity > max) { extraBaggage[itineraryId] = max; touched = true; } }
      if (touched) changed = true;
      return touched ? { ...draft, extraBaggage } : draft;
    });
    if (changed) { store.setDrafts(next); setAdjusted(true); }
  }, [drafts, limits, store]);

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
    // Siempre sobre lo último del almacén (no la copia del render): escribir rápido y salir del campo nunca pisa un valor.
    const next = store.getState().drafts.map((draft, position) => (position === index ? { ...draft, ...patch } : draft));
    if (sameContact && index === 0 && ('email' in patch || 'phoneCountry' in patch || 'phoneNational' in patch)) for (let i = 1; i < next.length; i += 1) next[i] = { ...next[i], email: next[0].email, phoneCountry: next[0].phoneCountry, phoneNational: next[0].phoneNational };
    store.setDrafts(next);
  };
  // Al escribir se borra el error del servidor de ESE campo (ya no es sobre el valor actual); la validación propia espera a que se salga del campo.
  const edit = (index: number, field: string, patch: Partial<PassengerDraft>): void => { store.clearServerError(fieldKey(index, field)); update(index, patch); };
  // El tipo de documento y la nacionalidad definen la regla del número (`documentRule`): al cambiarlos, lo ya escrito se ajusta a la regla nueva y se avisa junto al campo del número.
  const editDocumentRule = (index: number, field: 'documentType' | 'nationality', patch: Partial<PassengerDraft>): void => {
    const current = store.getState().drafts[index]; const merged = { ...current, ...patch };
    const adjustedNumber = adjustDocument(merged.documentType, merged.nationality, current.documentNumber);
    if (adjustedNumber.notice) { setNotices((all) => ({ ...all, [index]: adjustedNumber.notice! })); store.clearServerError(fieldKey(index, 'documentNumber')); edit(index, field, { ...patch, documentNumber: adjustedNumber.value }); }
    else edit(index, field, patch);
  };
  const setBaggage = (index: number, itineraryId: string, quantity: number): void => edit(index, `extraBaggage.${itineraryId}`, { extraBaggage: { ...store.getState().drafts[index].extraBaggage, [itineraryId]: quantity } });
  // Al salir del campo: se normaliza lo escrito (espacios, mayúsculas, separadores del teléfono) y se empieza a mostrar su error.
  const leave = (index: number, field: string): void => {
    setTouched((current) => (current.has(fieldKey(index, field)) ? current : new Set(current).add(fieldKey(index, field))));
    if (isNormalizedField(field)) { const current = store.getState().drafts[index][field]; const value = normalizeField(field, current); if (value !== current) update(index, { [field]: value }); }
  };
  const bind = (index: number, field: string): { id: string; onBlur: () => void } => ({ id: fieldId(index, field), onBlur: () => leave(index, field) });
  const contactShown = (index: number, field: string): boolean => !(sameContact && index > 0 && (field === 'email' || field === 'phone'));
  /** Error visible de un campo: el propio, si ya se salió del campo o se intentó enviar; si no, el que devolvió el servidor. */
  const shown = (index: number, field: string): string | undefined => {
    const key = fieldKey(index, field);
    return (submitted || touched.has(key) ? errors[key] : undefined) ?? state.serverErrors[key];
  };
  // Resumen de lo que hay que corregir: los errores propios tras enviar y los del servidor, solo de campos que se ven.
  const visible = [...new Set([...(submitted ? Object.keys(errors) : []), ...Object.keys(state.serverErrors)])].filter((key) => { const [i, ...rest] = key.split('.'); return contactShown(Number(i), rest.join('.')); });
  const adults = drafts.filter((draft) => draft.passengerType === 'ADULT');
  const seatIndexOf = (draftIndex: number): number => drafts.slice(0, draftIndex).filter((draft) => needsSeat(draft.passengerType)).length;

  const next = (): void => {
    setSubmitted(true);
    // Lo que se valida es lo normalizado (lo mismo que viaja); si el pasajero escribió espacios de más, se deja limpio.
    const clean = drafts.map(normalizeDraft);
    if (JSON.stringify(clean) !== JSON.stringify(drafts)) store.setDrafts(clean);
    const pending = Object.keys(errors).filter((key) => { const [i, ...rest] = key.split('.'); return contactShown(Number(i), rest.join('.')); });
    if (pending.length > 0) { focusField(firstInOrder(pending)); return; }
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
            {adjusted ? <Notice kind="warning" title="Ajustamos tus maletas adicionales."><p>Con la tarifa elegida el máximo de maletas adicionales es menor al que habías indicado; lo dejamos en el máximo permitido. Revisa el total antes de pagar.</p></Notice> : null}
            {visible.length > 0 ? (
              <Notice kind="error" title="Revisa los datos marcados.">
                <p>Hay {visible.length} {visible.length === 1 ? 'campo' : 'campos'} por corregir antes de continuar.</p>
                <ul className={s.errorList} aria-label="Campos por corregir">
                  {[...visible].sort(byFormOrder).map((key) => {
                    const [i, ...rest] = key.split('.'); const index = Number(i); const field = rest.join('.');
                    return <li key={key}><a href={`#${fieldId(index, field)}`} onClick={(event) => { event.preventDefault(); focusField(key); }}>Pasajero {index + 1}: {fieldLabel(field, offer)}</a></li>;
                  })}
                </ul>
              </Notice>
            ) : null}
          </div>
          {drafts.map((draft, index) => (
            <section key={draft.passengerId} className={`${ui.card} ${s.paxCard}`} aria-labelledby={`pax-${index}`}>
              <div className={s.paxHead}>
                <h2 id={`pax-${index}`} className={s.paxTitle}>Pasajero {index + 1} · {typeLabel(draft.passengerType)}</h2>
                <span className={ui.tag}>{needsSeat(draft.passengerType) ? `Asientos: ${seatSummary(state.seats, offer.itineraries.flatMap((i) => i.segments.map((sg) => ({ id: sg.segmentId, flight: sg.flightNumber }))), seatIndexOf(index))}` : 'Viaja en brazos, sin asiento'}</span>
              </div>
              <div className={s.fields}>
                <FilteredTextField label="Nombres" autoComplete="given-name" filter={filterName} value={draft.firstName} onValueChange={(value) => edit(index, 'firstName', { firstName: value })} error={shown(index, 'firstName')} {...bind(index, 'firstName')} />
                <FilteredTextField label="Apellidos" autoComplete="family-name" filter={filterName} value={draft.lastName} onValueChange={(value) => edit(index, 'lastName', { lastName: value })} error={shown(index, 'lastName')} {...bind(index, 'lastName')} />
                <SelectField label="Tipo de documento" value={draft.documentType} onChange={(event) => editDocumentRule(index, 'documentType', { documentType: event.target.value as PassengerDraft['documentType'] })} error={shown(index, 'documentType')} {...bind(index, 'documentType')}>
                  <option value="NATIONAL_ID">Cédula de identidad</option>
                  <option value="PASSPORT">Pasaporte</option>
                </SelectField>
                <FilteredTextField label="Número de documento" autoComplete="off" filter={filterDocument(draft.documentType, draft.nationality)} value={draft.documentNumber} onValueChange={(value) => { setNotices((current) => withoutKey(current, index)); edit(index, 'documentNumber', { documentNumber: value }); }} notice={notices[index]} error={shown(index, 'documentNumber')} hint={documentRule(draft.documentType, draft.nationality).hint} inputMode={documentRule(draft.documentType, draft.nationality).kind === 'ECUADOR_ID' ? 'numeric' : 'text'} {...bind(index, 'documentNumber')} />
                <DateField label={draft.documentType === 'PASSPORT' ? 'Vencimiento del pasaporte' : 'Vencimiento del documento (opcional)'} value={draft.documentExpiryDate} onValueChange={(iso) => edit(index, 'documentExpiryDate', { documentExpiryDate: iso })} {...expiryRange(new Date(), travel)} rangeNote={travel && travel > todayIso ? 'Debe estar vigente el día del último vuelo.' : undefined} error={shown(index, 'documentExpiryDate')} {...bind(index, 'documentExpiryDate')} />
                <CountryCombobox mode="name" label="Nacionalidad" value={draft.nationality} onValueChange={(code) => editDocumentRule(index, 'nationality', { nationality: code })} error={shown(index, 'nationality')} {...bind(index, 'nationality')} />
                <DateField label="Fecha de nacimiento" autoComplete="bday" value={draft.birthDate} onValueChange={(iso) => edit(index, 'birthDate', { birthDate: iso })} {...birthDateRange()} error={shown(index, 'birthDate')} {...bind(index, 'birthDate')} />
                <SelectField label="Género" value={draft.gender} onChange={(event) => edit(index, 'gender', { gender: event.target.value as PassengerDraft['gender'] })} error={shown(index, 'gender')} {...bind(index, 'gender')}>
                  <option value="">Elige una opción</option>
                  <option value="F">Femenino</option>
                  <option value="M">Masculino</option>
                  <option value="X">Otro</option>
                </SelectField>
                {index === 0 || !sameContact ? (
                  <>
                    <TextField label="Correo electrónico de contacto" type="email" autoComplete="email" value={draft.email} onChange={(event) => edit(index, 'email', { email: event.target.value })} error={shown(index, 'email')} {...bind(index, 'email')} />
                    <PhoneField label="Teléfono de contacto" country={draft.phoneCountry} national={draft.phoneNational} onCountryChange={(code) => edit(index, 'phone', { phoneCountry: code })} onNationalChange={(digits) => edit(index, 'phone', { phoneNational: digits })} error={shown(index, 'phone')} {...bind(index, 'phone')} />
                  </>
                ) : null}
                {draft.passengerType === 'INFANT' ? (
                  <SelectField label="Viaja con el adulto" className={s.fieldWide} value={draft.associatedAdultId} onChange={(event) => edit(index, 'associatedAdultId', { associatedAdultId: event.target.value })} error={shown(index, 'associatedAdultId')} {...bind(index, 'associatedAdultId')}>
                    <option value="">Elige un adulto</option>
                    {adults.map((adult, position) => <option key={adult.passengerId} value={adult.passengerId}>{adult.firstName.trim() ? `${adult.firstName.trim()} ${adult.lastName.trim()}` : `Pasajero ${drafts.indexOf(adult) + 1} (adulto ${position + 1})`}</option>)}
                  </SelectField>
                ) : null}
              </div>
              {index === 0 && drafts.length > 1 ? (
                <label className={s.check}><input type="checkbox" checked={sameContact} onChange={(event) => { setSameContact(event.target.checked); if (event.target.checked) store.setDrafts(drafts.map((d, i) => (i === 0 ? d : { ...d, email: drafts[0].email, phoneCountry: drafts[0].phoneCountry, phoneNational: drafts[0].phoneNational }))); }} />Usar este contacto para todos los pasajeros</label>
              ) : null}
              {needsSeat(draft.passengerType) ? (
                <div className={s.baggage}>
                  <strong>Equipaje adicional</strong>
                  {offer.itineraries.map((itinerary) => {
                    const option = optionFor(itinerary, state.selections[itinerary.itineraryId]); const unit = option?.extraCheckedBaggagePrice;
                    const id = fieldId(index, `extraBaggage.${itinerary.itineraryId}`);
                    const max = limits[itinerary.itineraryId] ?? 0; const included = option?.baggageAllowance.checkedBaggageIncluded ?? 0;
                    return (
                      <SelectField key={itinerary.itineraryId} label={`${itinerary.segments.map((segment) => segment.flightNumber).join(', ')} · maletas adicionales${unit ? ` (${formatMoney(unit)} c/u)` : ''}`} id={id} value={String(Math.min(draft.extraBaggage[itinerary.itineraryId] ?? 0, max))} disabled={max === 0} hint={included > 0 ? `Tu tarifa incluye ${included} ${included === 1 ? 'maleta facturada' : 'maletas facturadas'}; ${max === 0 ? 'no admite más' : `puedes agregar hasta ${max}`}.` : undefined} onChange={(event) => setBaggage(index, itinerary.itineraryId, Number(event.target.value))} onBlur={() => leave(index, `extraBaggage.${itinerary.itineraryId}`)} error={shown(index, `extraBaggage.${itinerary.itineraryId}`)}>
                        {Array.from({ length: max + 1 }, (_, quantity) => <option key={quantity} value={quantity}>{quantity}</option>)}
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

/** Id del control de un campo: `pax-<índice>-<campo>`; el equipaje conserva `bag-<índice>-<tramo>`. */
const withoutKey = (record: Readonly<Record<number, string>>, key: number): Readonly<Record<number, string>> => { if (!(key in record)) return record; const { [key]: removed, ...rest } = record; void removed; return rest; };
const fieldId = (index: number, field: string): string => (field.startsWith('extraBaggage.') ? `bag-${index}-${field.slice('extraBaggage.'.length)}` : `pax-${index}-${field}`);
const FORM_ORDER = ['firstName', 'lastName', 'documentType', 'documentNumber', 'documentExpiryDate', 'nationality', 'birthDate', 'gender', 'email', 'phone', 'associatedAdultId'];
const orderOf = (key: string): [number, number] => { const [i, ...rest] = key.split('.'); const field = rest.join('.'); const position = FORM_ORDER.indexOf(field); return [Number(i), position < 0 ? FORM_ORDER.length : position]; };
const byFormOrder = (a: string, b: string): number => { const [ai, ap] = orderOf(a); const [bi, bp] = orderOf(b); return ai - bi || ap - bp || a.localeCompare(b); };
/** El primer campo con error en el orden en que aparecen en pantalla. */
const firstInOrder = (keys: readonly string[]): string => [...keys].sort(byFormOrder)[0];
/** Lleva el foco al control del campo `índice.campo` (si está en pantalla). */
function focusField(key: string | undefined): void {
  if (!key) return;
  const [i, ...rest] = key.split('.');
  document.getElementById(fieldId(Number(i), rest.join('.')))?.focus();
}
const LABELS: Readonly<Record<string, string>> = {
  firstName: 'Nombres', lastName: 'Apellidos', documentType: 'Tipo de documento', documentNumber: 'Número de documento', documentExpiryDate: 'Vencimiento del documento', nationality: 'Nacionalidad',
  birthDate: 'Fecha de nacimiento', gender: 'Género', email: 'Correo electrónico', phone: 'Teléfono', associatedAdultId: 'Viaja con el adulto'
};
function fieldLabel(field: string, offer: { itineraries: ReadonlyArray<{ itineraryId: string; segments: ReadonlyArray<{ flightNumber: string }> }> }): string {
  if (!field.startsWith('extraBaggage.')) return LABELS[field] ?? field;
  const itinerary = offer.itineraries.find((entry) => entry.itineraryId === field.slice('extraBaggage.'.length));
  return `Maletas adicionales${itinerary ? ` (${itinerary.segments.map((segment) => segment.flightNumber).join(', ')})` : ''}`;
}

/** «FP103: 12A · FP105: 14C» para el pasajero que ocupa la posición `seatIndex` entre quienes tienen asiento. */
function seatSummary(seats: Readonly<Record<string, string[]>>, segments: ReadonlyArray<{ id: string; flight: string }>, seatIndex: number): string {
  return segments.map((segment) => `${segment.flight}: ${seats[segment.id]?.[seatIndex] || '—'}`).join(' · ');
}
