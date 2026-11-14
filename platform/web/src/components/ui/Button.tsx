import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import styles from './ui.module.css';

interface Look { variant?: 'primary' | 'secondary'; size?: 'normal' | 'small'; block?: boolean }
const classes = ({ variant = 'primary', size = 'normal', block = false }: Look, extra?: string): string =>
  [styles.button, variant === 'secondary' ? styles.secondary : '', size === 'small' ? styles.small : '', block ? styles.block : '', extra ?? ''].filter(Boolean).join(' ');

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, Look { loading?: boolean; children: ReactNode }

/** Botón de acción. Con `loading` se bloquea y lo anuncia (`aria-busy`): un doble clic no repite la acción. */
export function Button({ variant, size, block, loading = false, disabled, children, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={classes({ variant, size, block }, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({ variant, size, block, className, children, ...rest }: LinkProps & Look) {
  return <Link className={classes({ variant, size, block }, className)} {...rest}>{children}</Link>;
}

export function TextButton({ children, className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={[styles.textButton, className ?? ''].join(' ').trim()} {...rest}>{children}</button>;
}
