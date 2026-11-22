import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { CircleAlert } from 'lucide-react';
import styles from './ui.module.css';

/**
 * `keepHint`: la ayuda sigue visible aunque haya error (p. ej. «incluye el código de país»); por omisión el error la reemplaza.
 * `live`: ayuda breve ANUNCIADA a lectores de pantalla (región `status`, siempre presente para que el anuncio funcione); `''` = nada que decir.
 */
export interface FieldBase { label: string; error?: string; hint?: string; keepHint?: boolean; live?: string }

const hintShown = (error: string | undefined, hint: string | undefined, keepHint: boolean | undefined): boolean => Boolean(hint) && (!error || Boolean(keepHint));

/** Marco de un campo: etiqueta, control (`children`), ayuda, ayuda anunciada y error. Lo usan los campos y los controles compuestos (fecha, país, teléfono). */
export function FieldShell({ id, label, error, hint, keepHint, live, children }: FieldBase & { id: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      {children}
      {hintShown(error, hint, keepHint) ? <span className={styles.hint} id={`${id}-hint`}>{hint}</span> : null}
      {live !== undefined ? <span className={styles.liveHint} id={`${id}-live`} role="status">{live}</span> : null}
      {error ? <span className={styles.fieldError} id={`${id}-error`}><CircleAlert size={14} aria-hidden="true" />{error}</span> : null}
    </div>
  );
}

/** El error va primero; la ayuda, si sigue visible, después. */
export const describedBy = (id: string, error?: string, hint?: string, keepHint?: boolean): string | undefined => {
  const ids = [error ? `${id}-error` : '', hintShown(error, hint, keepHint) ? `${id}-hint` : ''].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
};

/** Campo de texto/fecha con etiqueta visible; el error se asocia con `aria-describedby` y `aria-invalid`. */
export function TextField({ label, error, hint, keepHint, live, id, className, ...rest }: FieldBase & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId(); const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} keepHint={keepHint} live={live}>
      <input id={fieldId} className={[styles.control, className ?? ''].join(' ').trim()} aria-invalid={error ? true : undefined} aria-describedby={describedBy(fieldId, error, hint, keepHint)} {...rest} />
    </FieldShell>
  );
}

export function SelectField({ label, error, hint, keepHint, live, id, className, children, ...rest }: FieldBase & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId(); const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} error={error} hint={hint} keepHint={keepHint} live={live}>
      <select id={fieldId} className={[styles.control, className ?? ''].join(' ').trim()} aria-invalid={error ? true : undefined} aria-describedby={describedBy(fieldId, error, hint, keepHint)} {...rest}>{children}</select>
    </FieldShell>
  );
}
