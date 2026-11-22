// Las reglas de los pasajeros son ÚNICAS (`packages/shared/src/passenger-rules.ts`, sin importaciones; ADR-F12b1fix-05): Reservation las aplica y la web las adelanta.
// Se reexportan aquí porque la web solo importa paquetes del front (como la tabla de zonas, que entra por `airports.ts`).
export {
  AGE_RANGES, NAME_CHAR_PATTERN, ageAt, ageMessage, checkPassengerFields, checkPassengerSet, DOCUMENT_MAX_LENGTH, DOCUMENT_MIN_LENGTH, DOCUMENT_PATTERN, EMAIL_PATTERN, fieldMessage, isCalendarDate, isValidName, NAME_MAX_LENGTH, NAME_PATTERN,
  normalizeDocument, normalizeName, normalizePhone, PHONE_PATTERN, validAge,
  type PassengerBreakdown, type PassengerFacts, type RuleCode, type RuleIssue
} from '@flight-platform/shared/dist/src/passenger-rules';
