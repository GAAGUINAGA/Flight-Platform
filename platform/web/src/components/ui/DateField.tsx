import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { displayToIso, filterDateText, isoToDisplay, maskDate } from '../../purchase/input-filters';
import { describedBy, FieldShell } from './Field';
import { useBlockedHelp } from './FilteredField';
import styles from './ui.module.css';

interface DateFieldProps {
  label: string; id: string;
  /** Fecha elegida (AAAA-MM-DD, como la pide el contrato) o ''. */
  value: string; onValueChange: (iso: string) => void;
  /** Rango PERMITIDO (AAAA-MM-DD, ambos inclusive): fuera de él no se acepta ninguna fecha, ni escrita ni elegida en el calendario. */
  min: string; max: string;
  error?: string; /** Frase sobre el rango (p. ej. «No puede ser anterior al último vuelo»). */ rangeNote?: string;
  onBlur?: () => void; autoComplete?: string;
}

/**
 * Fecha en formato LOCAL dd/mm/aaaa (se escribe y se muestra así; sale como AAAA-MM-DD) con máscara, rango bloqueado y calendario del navegador (`min`/`max`).
 *   - Solo dígitos (y `/`, `-`, `.` como separadores): lo demás se bloquea con una ayuda anunciada. Pegar «aaaa-mm-dd» también funciona.
 *   - Una fecha completa fuera del rango o que no existe NO se acepta: el valor queda vacío y el campo explica el rango. Nunca se corrige en silencio.
 */
export function DateField({ label, id, value, onValueChange, min, max, error, rangeNote, onBlur, autoComplete }: DateFieldProps) {
  const [text, setText] = useState(() => isoToDisplay(value));
  const [local, setLocal] = useState<string | null>(null);
  const [blocked, showBlocked] = useBlockedHelp();
  const native = useRef<HTMLInputElement>(null);
  const range = `entre ${isoToDisplay(min)} y ${isoToDisplay(max)}`;

  // Un cambio de fuera (restaurar, limpiar) se refleja; lo que la persona escribe a medias no se pisa.
  useEffect(() => { if (value && value !== displayToIso(text)) { setText(isoToDisplay(value)); setLocal(null); } }, [value]);

  const commit = (display: string): void => {
    if (display.length < 10) { setLocal(null); onValueChange(''); return; }
    const iso = displayToIso(display);
    if (!iso) { setLocal('Esa fecha no existe. Escríbela como dd/mm/aaaa.'); onValueChange(''); return; }
    if (iso < min || iso > max) { setLocal(`La fecha debe estar ${range}.`); onValueChange(''); return; }
    setLocal(null); onValueChange(iso);
  };

  const change = (raw: string): void => {
    const trimmed = raw.trim();
    const pasted = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? isoToDisplay(trimmed) : raw; // «1990-03-14» pegado → 14/03/1990
    const filtered = filterDateText(pasted);
    const digits = filtered.value.replace(/\D/g, '');
    const help = filtered.blocked ?? (digits.length > 8 ? 'Máximo 8 dígitos: dd/mm/aaaa.' : null);
    if (help) showBlocked(help);
    const masked = maskDate(filtered.value); setText(masked); commit(masked);
  };

  const shownError = local ?? error;
  const hint = `Formato dd/mm/aaaa, ${range}.${rangeNote ? ` ${rangeNote}` : ''}`;
  return (
    <FieldShell id={id} label={label} error={shownError} hint={hint} keepHint live={blocked}>
      <div className={styles.dateWrap}>
        <div className={styles.inline}>
          <input
            id={id} className={styles.control} type="text" inputMode="numeric" autoComplete={autoComplete ?? 'off'} placeholder="dd/mm/aaaa" value={text}
            aria-invalid={shownError ? true : undefined} aria-describedby={describedBy(id, shownError, hint, true)}
            onChange={(event) => change(event.target.value)}
            onBlur={() => { showBlocked(null); if (text.length > 0 && text.length < 10) { setLocal('Escribe la fecha completa: dd/mm/aaaa.'); } onBlur?.(); }}
          />
          <button type="button" className={styles.iconButton} aria-label={`Abrir calendario: ${label}`} onClick={() => { const input = native.current; if (!input) return; try { if (typeof input.showPicker === 'function') input.showPicker(); else input.focus(); } catch { input.focus(); } }}>
            <CalendarDays size={20} aria-hidden="true" />
          </button>
        </div>
        {/* El selector de calendario del navegador: solo deja elegir dentro del rango (`min`/`max`). No se muestra ni se enfoca: la persona escribe o usa el botón. */}
        <input ref={native} className={styles.nativeDate} type="date" tabIndex={-1} aria-hidden="true" min={min} max={max} value={value} onChange={(event) => { const iso = event.target.value; if (iso && iso >= min && iso <= max) { setText(isoToDisplay(iso)); setLocal(null); onValueChange(iso); } }} />
      </div>
    </FieldShell>
  );
}
