import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { COUNTRIES, countryByCode, searchCountries, type Country } from '@flight-platform/format';
import { flagUrl } from '../../data/flags';
import { describedBy, FieldShell } from './Field';
import styles from './ui.module.css';

interface CountryComboboxProps {
  id: string;
  /** Código ISO-2 del país elegido. */
  value: string; onValueChange: (code: string) => void;
  /** `name`: nacionalidad (muestra el nombre). `dial`: prefijo del teléfono (muestra el código de marcación). */
  mode: 'name' | 'dial';
  /** Con etiqueta visible y errores (campo suelto). Sin ella (`ariaLabel`), es parte de un grupo, como el prefijo del teléfono. */
  label?: string; ariaLabel?: string;
  error?: string; hint?: string; onBlur?: () => void;
  countries?: readonly Country[];
}

const flag = (code: string, className?: string) => { const url = flagUrl(code); return url ? <img className={className} src={url} alt="" width={24} height={18} loading="lazy" /> : null; };

/**
 * Selector de país: combobox accesible (patrón ARIA «editable combobox with list autocomplete») con búsqueda por nombre, por código ISO o por código de marcación,
 * bandera como imagen SVG y teclado completo (flechas, Enter, Escape). Al enfocar se selecciona el texto: escribir reemplaza y filtra la lista.
 */
export function CountryCombobox({ id, value, onValueChange, mode, label, ariaLabel, error, hint, onBlur, countries = COUNTRIES }: CountryComboboxProps) {
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState(false); const [query, setQuery] = useState(''); const [active, setActive] = useState(0);
  const listId = `${id}-list`; const nameId = `${id}-name`; const optionId = (code: string): string => `${id}-opt-${code}`;
  const selected = countryByCode(value);
  const items = useMemo(() => (editing ? searchCountries(query, countries) : countries), [editing, query, countries]);
  const shown = editing ? query : selected ? (mode === 'name' ? selected.name : `+${selected.dial}`) : '';
  const activeItem = open ? items[active] : undefined;

  useEffect(() => { if (activeItem) document.getElementById(optionId(activeItem.code))?.scrollIntoView?.({ block: 'nearest' }); }, [activeItem?.code]);

  const openList = (): void => { if (open) return; setOpen(true); const index = items.findIndex((country) => country.code === value); setActive(index >= 0 ? index : 0); };
  const close = (): void => { setOpen(false); setEditing(false); setQuery(''); };
  const choose = (country: Country): void => { onValueChange(country.code); close(); };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') { event.preventDefault(); if (!open) openList(); else setActive((current) => Math.min(current + 1, items.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (!open) openList(); else setActive((current) => Math.max(current - 1, 0)); }
    else if (event.key === 'Enter' && open && items[active]) { event.preventDefault(); choose(items[active]); }
    else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') close();
  };

  const description = describedBy(id, error, hint) ?? '';
  const control = (
    <div className={styles.combo}>
      <div className={styles.comboBox}>
      {selected ? flag(selected.code, styles.comboFlag) : null}
      <input
        id={id} className={`${styles.control} ${styles.comboInput}`} type="text" role="combobox" autoComplete="off" spellCheck={false}
        aria-label={label ? undefined : ariaLabel} aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-haspopup="listbox" aria-activedescendant={activeItem ? optionId(activeItem.code) : undefined}
        aria-invalid={error ? true : undefined} aria-describedby={[description, selected && mode === 'dial' ? nameId : ''].filter(Boolean).join(' ') || undefined}
        value={shown}
        onFocus={(event) => event.currentTarget.select()}
        onClick={openList}
        onChange={(event) => { setEditing(true); setQuery(event.target.value); setOpen(true); setActive(0); }}
        onKeyDown={onKeyDown}
        onBlur={() => { close(); onBlur?.(); }}
      />
      {selected && mode === 'dial' ? <span id={nameId} className={styles.srOnly}>{selected.name}</span> : null}
      <span className={styles.srOnly} role="status">{open ? `${items.length} ${items.length === 1 ? 'resultado' : 'resultados'}` : ''}</span>
      {open ? (
        items.length > 0 ? (
          <ul id={listId} className={styles.comboList} role="listbox" aria-label={label ?? ariaLabel}>
            {items.map((country, index) => (
              <li
                key={country.code} id={optionId(country.code)} role="option" aria-selected={country.code === value} data-active={index === active ? 'true' : undefined} className={styles.comboOption}
                onMouseDown={(event) => event.preventDefault()} onClick={() => choose(country)} onMouseMove={() => { if (index !== active) setActive(index); }}
              >
                {flag(country.code)}
                <span>{country.name}</span>
                {mode === 'dial' ? <span className={styles.comboDial}>+{country.dial}</span> : null}
              </li>
            ))}
          </ul>
        ) : <ul id={listId} className={styles.comboList} role="listbox" aria-label={label ?? ariaLabel}><li role="option" aria-selected="false" aria-disabled="true" className={styles.comboEmpty}>No encontramos ese país.</li></ul>
      ) : null}
      </div>
    </div>
  );
  return label ? <FieldShell id={id} label={label} error={error} hint={hint}>{control}</FieldShell> : control;
}
