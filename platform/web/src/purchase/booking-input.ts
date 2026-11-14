import type { PassengerInput } from '@flight-platform/graphql-schema/generated/types';
import { needsSeat, type PassengerDraft } from './passenger-rules';

/**
 * Pasajeros de `createBooking` a partir del formulario y de los asientos elegidos. Sin React ni DOM.
 * Los asientos se reparten en el MISMO orden en que el hold los reservó: la posición entre quienes ocupan asiento.
 */
export function buildPassengerInputs(drafts: readonly PassengerDraft[], segmentIds: readonly string[], seats: Readonly<Record<string, readonly string[]>>): PassengerInput[] {
  let seatPosition = 0;
  return drafts.map((draft) => {
    const position = needsSeat(draft.passengerType) ? seatPosition++ : -1;
    const assignedSeats = position < 0 ? [] : segmentIds.flatMap((segmentId) => { const seatNumber = seats[segmentId]?.[position]; return seatNumber ? [{ segmentId, seatNumber }] : []; });
    const extraBaggage = Object.entries(draft.extraBaggage).filter(([, quantity]) => quantity > 0).map(([itineraryId, quantity]) => ({ itineraryId, quantity }));
    return {
      passengerId: draft.passengerId, passengerType: draft.passengerType,
      ...(draft.passengerType === 'INFANT' && draft.associatedAdultId ? { associatedAdultId: draft.associatedAdultId } : {}),
      firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), documentType: draft.documentType, documentNumber: draft.documentNumber.trim(),
      nationality: draft.nationality, ...(draft.documentExpiryDate ? { documentExpiryDate: draft.documentExpiryDate } : {}),
      birthDate: draft.birthDate, gender: draft.gender as PassengerInput['gender'], contact: { email: draft.email.trim(), phone: draft.phone.trim() },
      ...(assignedSeats.length > 0 ? { assignedSeats } : {}), ...(extraBaggage.length > 0 ? { extraBaggage } : {})
    };
  });
}
