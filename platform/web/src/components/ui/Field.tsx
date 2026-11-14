import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { CircleAlert } from 'lucide-react';
import styles from './ui.module.css';

interface FieldBase { label: string; error?: string; hint?: string }

function Shell({ id, label, error, hint, children }: FieldBase & { id: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      {children}
      {hint && !error ? <span className={styles.hint} id={`${id}-hint`}>{hint}</span> : null}
      {error ? <span className={styles.fieldError} id={`${id}-error`}><CircleAlert size={14} aria-hidden="true" />{error}</span> : null}
    </div>
  );
}

const describedBy = (id: string, error?: string, hint?: string): string | undefined => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

/** Campo de texto/fecha con etiqueta visible; el error se asocia con `aria-describedby` y `aria-invalid`. */
export function TextField({ label, error, hint, id, className, ...rest }: FieldBase & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId(); const fieldId = id ?? generated;
  return (
    <Shell id={fieldId} label={label} error={error} hint={hint}>
      <input id={fieldId} className={[styles.control, className ?? ''].join(' ').trim()} aria-invalid={error ? true : undefined} aria-describedby={describedBy(fieldId, error, hint)} {...rest} />
    </Shell>
  );
}

export function SelectField({ label, error, hint, id, className, children, ...rest }: FieldBase & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId(); const fieldId = id ?? generated;
  return (
    <Shell id={fieldId} label={label} error={error} hint={hint}>
      <select id={fieldId} className={[styles.control, className ?? ''].join(' ').trim()} aria-invalid={error ? true : undefined} aria-describedby={describedBy(fieldId, error, hint)} {...rest}>{children}</select>
    </Shell>
  );
}
