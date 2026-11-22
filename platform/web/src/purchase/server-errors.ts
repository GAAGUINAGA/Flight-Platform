import { ageMessage, fieldMessage } from '@flight-platform/format';
import { draftField, fieldKey, type PassengerDraft, type PassengerErrors } from './passenger-rules';

/**
 * Errores del servidor → campo y pasajero del formulario (ADR-F12b1fix-05). Sin React ni DOM.
 *
 * Qué llega: la reserva falla con `VALIDATION_FAILED` y `invalidParams[].name` (+ `reason`, de una lista cerrada, sin valores: Reservation → ESB → Gateway → GraphQL, ADR-F12b1fix-05 punto 12).
 * Esos nombres siguen el contrato: `passengers.<índice>.<campo>`
 * (GraphQL los antepone con `input.`), con `contact.email` / `contact.phone` y `extraBaggage.<n>.quantity` (n = posición en la lista de maletas ENVIADA, que
 * solo incluye los tramos con cantidad > 0). Los errores de negocio que nombran un campo pero no al pasajero (`BAGGAGE_LIMIT_EXCEEDED`, `INFANT_WITHOUT_ADULT`,
 * `PASSPORT_REQUIRED_INTERNATIONAL`, `DOCUMENT_EXPIRED`) se marcan en todos los pasajeros a los que podrían referirse. Límites: lo que no es un dato del formulario
 * (`passengerId`, `assignedSeats`, el hold) queda como no mapeado y la pantalla muestra el panel de error general. El texto lo pone la web (los motivos del servidor
 * no se muestran: no son texto para personas) y nunca incluye el valor escrito.
 */
export const BAGGAGE_OVER_MESSAGE = 'Superaste el máximo de maletas permitido para este tramo. Reduce las maletas adicionales.';
export interface ServerErrorLike { code: string; invalidParams: ReadonlyArray<{ name: string; reason?: string }> }
export interface MappedServerErrors { errors: PassengerErrors; unmapped: number }

const PARAM = /(?:^|\.)passengers(?:\.|\[)(\d+)\]?\.(.+)$/;
const FORM_FIELDS = new Set(['firstName', 'lastName', 'documentType', 'documentNumber', 'nationality', 'documentExpiryDate', 'birthDate', 'gender', 'associatedAdultId', 'contact.email', 'contact.phone']);
const sentBaggage = (draft: PassengerDraft): string[] => Object.entries(draft.extraBaggage).filter(([, quantity]) => quantity > 0).map(([itineraryId]) => itineraryId);

/**
 * Texto del campo según el motivo del servidor (lista CERRADA de Reservation, sin valores). Solo se usan los motivos que cambian el mensaje con certeza;
 * cualquier otro (o un motivo libre de un servicio antiguo) cae en la regla del campo. El motivo nunca se muestra tal cual.
 */
function messageFor(field: string, reason: string | undefined, draft: PassengerDraft): string {
  if (reason === 'REQUIRED') return 'Completa este dato.';
  if (reason === 'AGE_NOT_ALLOWED_FOR_TYPE' && field === 'birthDate') return ageMessage(draft.passengerType);
  return fieldMessage(field);
}

export function mapServerErrors(error: ServerErrorLike, drafts: readonly PassengerDraft[]): MappedServerErrors {
  const errors: PassengerErrors = {}; let unmapped = 0;
  const set = (index: number, field: string, message: string): void => { errors[fieldKey(index, field)] ??= message; };

  for (const param of error.invalidParams) {
    const match = PARAM.exec(param.name); const index = match ? Number(match[1]) : -1;
    if (!match || index >= drafts.length) { unmapped += 1; continue; }
    const field = match[2]; const bag = /^extraBaggage\.(\d+)(?:\.quantity)?$/.exec(field);
    if (bag) {
      const itineraryId = sentBaggage(drafts[index])[Number(bag[1])];
      if (itineraryId) set(index, `extraBaggage.${itineraryId}`, BAGGAGE_OVER_MESSAGE); else unmapped += 1;
    } else if (FORM_FIELDS.has(field)) set(index, draftField(field), messageFor(field, param.reason, drafts[index]));
    else unmapped += 1;
  }

  // Errores de negocio que nombran el campo pero no al pasajero: solo si el propio servidor no dijo cuál.
  if (Object.keys(errors).length === 0) {
    drafts.forEach((draft, index) => {
      if (error.code === 'BAGGAGE_LIMIT_EXCEEDED') for (const itineraryId of sentBaggage(draft)) set(index, `extraBaggage.${itineraryId}`, BAGGAGE_OVER_MESSAGE);
      if (error.code === 'INFANT_WITHOUT_ADULT' && draft.passengerType === 'INFANT') set(index, 'associatedAdultId', 'Indica el adulto con el que viaja el infante.');
      if (error.code === 'PASSPORT_REQUIRED_INTERNATIONAL' && draft.documentType !== 'PASSPORT') set(index, 'documentType', 'Los vuelos internacionales requieren pasaporte.');
      if (error.code === 'DOCUMENT_EXPIRED' && draft.documentExpiryDate) set(index, 'documentExpiryDate', 'El documento vence antes del último vuelo del viaje.');
    });
  }
  return { errors, unmapped };
}

/** Códigos con los que `mapServerErrors` puede llevar el error a los campos. */
export const FIELD_ERROR_CODES: ReadonlySet<string> = new Set(['VALIDATION_FAILED', 'BAGGAGE_LIMIT_EXCEEDED', 'INFANT_WITHOUT_ADULT', 'PASSPORT_REQUIRED_INTERNATIONAL', 'DOCUMENT_EXPIRED']);
