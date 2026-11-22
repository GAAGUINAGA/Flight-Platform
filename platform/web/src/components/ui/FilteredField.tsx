import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CompositionEvent, type InputHTMLAttributes } from 'react';
import type { InputFilter } from '../../purchase/input-filters';
import { describedBy, FieldShell, type FieldBase } from './Field';
import styles from './ui.module.css';

/** Cuánto dura en pantalla la ayuda de «carácter bloqueado» si la persona no sigue escribiendo. */
const HELP_MS = 6000;

/** Mensaje de ayuda que se muestra (y se anuncia) y se borra solo. */
export function useBlockedHelp(): [string, (message: string | null) => void] {
  const [message, setMessage] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = useCallback((next: string | null): void => {
    window.clearTimeout(timer.current); setMessage(next ?? '');
    if (next) timer.current = window.setTimeout(() => setMessage(''), HELP_MS);
  }, []);
  return [message, show];
}

interface FilteredProps { filter: InputFilter; value: string; onValueChange: (value: string) => void; onBlocked?: (message: string | null) => void }

/**
 * Filtra lo que se escribe Y lo que se pega (ambos llegan como un cambio del campo) sin romper la composición de caracteres: durante una composición
 * (tildes con tecla muerta, teclados móviles, IME) NO se toca el valor; al terminarla se filtra. Si se quita algo, se avisa con `onBlocked` (nunca en silencio)
 * y el cursor se queda donde estaba.
 */
export function FilteredInput({ filter, value, onValueChange, onBlocked, className, ...rest }: FilteredProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const composing = useRef(false);
  const apply = (element: HTMLInputElement): void => {
    const raw = element.value; const caret = element.selectionStart ?? raw.length;
    const result = filter(raw);
    if (result.blocked) onBlocked?.(result.blocked); // la ayuda se queda hasta que pasa el tiempo o se sale del campo (no parpadea con el siguiente carácter)
    onValueChange(result.value);
    if (result.value !== raw) {
      // El cursor se queda donde estaba (sin lo bloqueado). Se coloca en una microtarea: corre después de que React confirma el valor (que lo manda al final) y antes de la siguiente tecla.
      const keptBefore = filter(raw.slice(0, caret)).value.length;
      void Promise.resolve().then(() => { try { element.setSelectionRange(keptBefore, keptBefore); } catch { /* tipo de campo sin selección */ } });
    }
  };
  return (
    <input
      {...rest} className={[styles.control, className ?? ''].join(' ').trim()} value={value}
      onChange={(event: ChangeEvent<HTMLInputElement>) => { if (composing.current) onValueChange(event.target.value); else apply(event.target); }}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(event: CompositionEvent<HTMLInputElement>) => { composing.current = false; apply(event.currentTarget); }}
    />
  );
}

/** Campo de texto con etiqueta, filtrado de caracteres y la ayuda breve anunciada junto al campo. */
export function FilteredTextField({ label, error, hint, keepHint, id, filter, value, onValueChange, notice, ...rest }: FieldBase & FilteredProps & { id: string; /** Aviso de un ajuste hecho desde fuera del campo (p. ej. al cambiar el tipo de documento); se anuncia como la ayuda de bloqueo. */ notice?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'>) {
  const [blocked, showBlocked] = useBlockedHelp();
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} keepHint={keepHint} live={blocked || notice || ''}>
      <FilteredInput {...rest} id={id} filter={filter} value={value} onValueChange={onValueChange} onBlocked={showBlocked} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint, keepHint)} onBlur={(event) => { showBlocked(null); rest.onBlur?.(event); }} />
    </FieldShell>
  );
}
