// La lista de países es ÚNICA (`packages/shared/src/countries.ts`, sin importaciones; ADR-F12b1fix-05): nacionalidad y prefijo del teléfono.
// Se reexporta aquí porque la web solo importa paquetes del front.
export {
  COUNTRIES, countryByCode, DEFAULT_COUNTRY, E164_MAX_DIGITS, searchCountries, searchKey,
  type Country
} from '@flight-platform/shared/dist/src/countries';
