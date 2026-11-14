import { useEffect, useRef, useState } from 'react';
import { PromotionAgreementOperation, SetPromotionAgreementOperation } from '@flight-platform/graphql-schema/generated/operations';
import type { CabinClass, PromotionFieldsFragment } from '@flight-platform/graphql-schema/generated/types';
import { formatDate, formatLocalTimeWithZone } from '@flight-platform/format';
import { usePageTitle } from '../app/page';
import { useServices } from '../app/services';
import { useAction } from '../bookings/useAction';
import { ErrorPanel } from '../components/ErrorPanel';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { CABIN_LABEL, CABINS } from './fare-rules';
import { useLiveQuery } from './hooks';
import { CONDITIONS_MAX, DISCOUNT_MAX, DISCOUNT_MIN, draftFromAgreement, emptyPromotion, promotionChanges, toPromotionInput, validatePromotion, type PromotionDraft, type PromotionErrors } from './promotion-rules';
import a from './admin.module.css';

const list = (values: readonly string[] | null | undefined): string => (values && values.length > 0 ? values.join(', ') : 'Sin restricción');

function Summary({ agreement }: { agreement: PromotionFieldsFragment }) {
  return (
    <dl className={a.diff} data-testid="agreement">
      <div className={a.diffRow}><dt>Permite promociones</dt><dd>{agreement.allowsPromotions ? 'Sí' : 'No'}</dd><dd /></div>
      <div className={a.diffRow}><dt>Descuento máximo</dt><dd>{agreement.maxDiscountPercent} %</dd><dd /></div>
      <div className={a.diffRow}><dt>Destinos</dt><dd>{list(agreement.destinations)}</dd><dd /></div>
      <div className={a.diffRow}><dt>Rutas</dt><dd>{list(agreement.routes)}</dd><dd /></div>
      <div className={a.diffRow}><dt>Cabinas</dt><dd>{list(agreement.cabins?.map((cabin) => CABIN_LABEL[cabin]))}</dd><dd /></div>
      <div className={a.diffRow}><dt>Vigencia hasta</dt><dd>{agreement.validUntil ? formatDate(agreement.validUntil) : 'Sin fecha límite'}</dd><dd /></div>
      <div className={a.diffRow}><dt>Condiciones</dt><dd>{agreement.conditions ?? '—'}</dd><dd /></div>
      {agreement.updatedAt ? <div className={a.diffRow}><dt>Última actualización</dt><dd>{formatLocalTimeWithZone(agreement.updatedAt, 'UIO')}</dd><dd /></div> : null}
    </dl>
  );
}

function Editor({ current, onSaved, onCancel }: { current: PromotionFieldsFragment | null; onSaved: (agreement: PromotionFieldsFragment) => void; onCancel: () => void }) {
  const { client } = useServices();
  const { busy, error, intent, run, clearError } = useAction();
  const before = useRef<PromotionDraft | null>(current ? draftFromAgreement(current) : null).current;
  const [draft, setDraft] = useState<PromotionDraft>(before ?? emptyPromotion()); const [errors, setErrors] = useState<PromotionErrors>({}); const [confirming, setConfirming] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [confirming]);
  const set = <K extends keyof PromotionDraft>(field: K, value: PromotionDraft[K]): void => { setDraft((previous) => ({ ...previous, [field]: value })); clearError(); };
  const toggleCabin = (cabin: CabinClass): void => set('cabins', draft.cabins.includes(cabin) ? draft.cabins.filter((entry) => entry !== cabin) : [...draft.cabins, cabin]);

  const review = (): void => { const found = validatePromotion(draft); setErrors(found); if (Object.keys(found).length === 0) setConfirming(true); };
  const changes = promotionChanges(before, draft);
  const save = async (): Promise<void> => {
    const input = toPromotionInput(draft);
    const result = await run('promotion', JSON.stringify(input), (intentNow) => client.execute(SetPromotionAgreementOperation, { input, idempotencyKey: intentNow.idempotencyKey }, { correlationId: intentNow.correlationId }));
    if (result) onSaved(result.setPromotionAgreement);
  };

  if (confirming) {
    return (
      <section className={a.confirm} aria-labelledby="promo-confirm-title" data-testid="promotion-confirm">
        <h3 id="promo-confirm-title" tabIndex={-1} ref={heading}>{before ? 'Confirma el cambio del acuerdo de promociones' : 'Confirma la creación del acuerdo de promociones'}</h3>
        <p className={a.muted}>El acuerdo es único para toda la aerolínea y se aplica a las promociones de los socios.</p>
        {changes.length === 0 ? <Notice kind="info" title="No hay cambios que guardar."><p>Los valores son iguales a los del acuerdo vigente.</p></Notice> : (
          <dl className={a.diff}>
            <div className={a.diffRow}><dt><strong>Campo</strong></dt><dd><strong>Antes</strong></dd><dd><strong>Después</strong></dd></div>
            {changes.map((change) => <div className={a.diffRow} key={change.label}><dt>{change.label}</dt><dd>{change.before}</dd><dd>{change.after}</dd></div>)}
          </dl>
        )}
        {error ? <ErrorPanel error={error} idempotencyKey={intent?.idempotencyKey} onRetry={() => void save()} /> : null}
        <div className={ui.actions}>
          <Button onClick={() => void save()} loading={busy} disabled={changes.length === 0}>{before ? 'Guardar el acuerdo' : 'Crear el acuerdo'}</Button>
          <Button variant="secondary" onClick={() => { clearError(); setConfirming(false); }} disabled={busy}>Volver a editar</Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Descartar</Button>
        </div>
      </section>
    );
  }

  return (
    <section className={`${ui.card} ${a.panel}`} aria-labelledby="promo-title" data-testid="promotion-form">
      <h3 id="promo-title" tabIndex={-1} ref={heading}>{before ? 'Editar el acuerdo de promociones' : 'Crear el acuerdo de promociones'}</h3>
      <form className={a.form} onSubmit={(event) => { event.preventDefault(); review(); }} noValidate>
        <fieldset className={`${a.checks} ${a.wide}`}>
          <legend>Promociones</legend>
          <label className={a.check}><input type="checkbox" checked={draft.allowsPromotions} onChange={(event) => set('allowsPromotions', event.target.checked)} />Permite promociones</label>
        </fieldset>
        <TextField label="Descuento máximo (%)" inputMode="decimal" value={draft.maxDiscountPercent} onChange={(event) => set('maxDiscountPercent', event.target.value)} error={errors.maxDiscountPercent} autoComplete="off" hint={`De ${DISCOUNT_MIN} a ${DISCOUNT_MAX}`} />
        <TextField label="Vigencia hasta" type="date" value={draft.validUntil} onChange={(event) => set('validUntil', event.target.value)} error={errors.validUntil} hint="Opcional" />
        <TextField label="Rutas habilitadas" value={draft.routes} onChange={(event) => set('routes', event.target.value)} error={errors.routes} autoComplete="off" hint="Separadas por comas, por ejemplo UIO-GYE, GYE-UIO. Vacío = todas" />
        <TextField label="Destinos habilitados" value={draft.destinations} onChange={(event) => set('destinations', event.target.value)} error={errors.destinations} autoComplete="off" hint="Separados por comas. Vacío = todos" />
        <fieldset className={`${a.checks} ${a.wide}`}>
          <legend>Cabinas habilitadas (ninguna marcada = todas)</legend>
          {CABINS.map((cabin) => <label className={a.check} key={cabin}><input type="checkbox" checked={draft.cabins.includes(cabin)} onChange={() => toggleCabin(cabin)} />{CABIN_LABEL[cabin]}</label>)}
        </fieldset>
        <div className={a.wide}><TextField label="Condiciones" value={draft.conditions} onChange={(event) => set('conditions', event.target.value)} error={errors.conditions} maxLength={CONDITIONS_MAX} autoComplete="off" hint={`Opcional. Hasta ${CONDITIONS_MAX} caracteres.`} /></div>
        <div className={`${a.wide} ${ui.actions}`}>
          <Button type="submit">Revisar el cambio</Button>
          <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        </div>
      </form>
    </section>
  );
}

/** Acuerdo de promociones único de la aerolínea (v2): verlo, crearlo si no existe y guardarlo con su validación y una confirmación (diseño §3.13). */
export function PromotionsPage() {
  usePageTitle('Promociones');
  const query = useLiveQuery(PromotionAgreementOperation, {}, 'promotion');
  const [editing, setEditing] = useState(false); const [saved, setSaved] = useState(false);
  const agreement = query.data?.promotionAgreement ?? null;
  const onSaved = (): void => { setSaved(true); setEditing(false); query.reload(); };

  return (
    <>
      <div><span className={ui.eyebrow}>Comercial</span><h1>Promociones</h1></div>
      {query.loading ? <LoadingState phase="normal" label="Cargando el acuerdo" skeletons={1} /> : null}
      {query.error && !query.data ? <ErrorPanel error={query.error} onRetry={query.reload} /> : null}
      {saved ? <Notice kind="success" title="El acuerdo de promociones se guardó."><p>Los cambios ya rigen para las nuevas promociones.</p></Notice> : null}
      {query.data && !editing ? (
        agreement ? (
          <section className={`${ui.card} ${a.panel}`} aria-labelledby="agreement-title">
            <div className={a.between}><h2 id="agreement-title">Acuerdo vigente</h2><Button onClick={() => { setSaved(false); setEditing(true); }}>Editar el acuerdo</Button></div>
            <Summary agreement={agreement} />
          </section>
        ) : (
          <div className={`${ui.card} ${a.empty}`}>
            <h2>Aún no hay acuerdo de promociones</h2>
            <p className={a.muted}>Crea el acuerdo único de la aerolínea: el descuento máximo, las rutas y las cabinas que admite.</p>
            <Button onClick={() => { setSaved(false); setEditing(true); }}>Crear el acuerdo</Button>
          </div>
        )
      ) : null}
      {query.data && editing ? <Editor current={agreement} onSaved={onSaved} onCancel={() => setEditing(false)} /> : null}
    </>
  );
}
