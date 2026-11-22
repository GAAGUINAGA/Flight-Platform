import { filterPhoneNational } from '../../purchase/input-filters';
import { CountryCombobox } from './CountryCombobox';
import { describedBy, FieldShell } from './Field';
import { FilteredInput, useBlockedHelp } from './FilteredField';
import styles from './ui.module.css';

interface PhoneFieldProps {
  label: string; id: string;
  /** País del prefijo (ISO-2) y número NACIONAL (solo dígitos). El E.164 lo compone `libphonenumber-js` (`purchase/phone.ts`). */
  country: string; national: string;
  onCountryChange: (code: string) => void; onNationalChange: (digits: string) => void;
  error?: string; onBlur?: () => void;
}

/**
 * Teléfono: selector de país con bandera y código de marcación (Ecuador por omisión) + el número NACIONAL, solo con dígitos (lo demás se bloquea con una ayuda
 * anunciada, también al pegar). La etiqueta, el error y la ayuda son los del número; el selector tiene su propio nombre accesible.
 */
export function PhoneField({ label, id, country, national, onCountryChange, onNationalChange, error, onBlur }: PhoneFieldProps) {
  const [blocked, showBlocked] = useBlockedHelp();
  const hint = 'Elige el país y escribe solo tu número, sin el código de país.';
  return (
    <FieldShell id={id} label={label} error={error} hint={hint} keepHint live={blocked}>
      <div className={styles.phoneGroup} role="group" aria-label={`${label}: país y número`}>
        <CountryCombobox id={`${id}-country`} mode="dial" ariaLabel="País del teléfono" value={country} onValueChange={(code) => { onCountryChange(code); showBlocked(null); }} />
        <FilteredInput
          id={id} type="tel" inputMode="numeric" autoComplete="tel-national" value={national} filter={filterPhoneNational(country)} onValueChange={onNationalChange} onBlocked={showBlocked} onBlur={() => { showBlocked(null); onBlur?.(); }}
          aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint, true)}
        />
      </div>
    </FieldShell>
  );
}
