import type { PassengerDraft } from '../src/purchase/passenger-rules';

/** Pasajero válido para viajar UIO → GPS (nacional): cédula, mayor de edad. */
export function passengerDraft(base: PassengerDraft, index: number): PassengerDraft {
  const people = [['Ana', 'Pérez', '1990-01-01', '1712345678'], ['Luis', 'Mora', '1988-05-05', '1798765432'], ['Eva', 'Ruiz', '1992-03-03', '1700000019']];
  const [firstName, lastName, birthDate, documentNumber] = people[index % people.length];
  return { ...base, firstName, lastName, birthDate, documentNumber, gender: base.gender || 'F', email: 'ana@example.test', phoneCountry: 'EC', phoneNational: '987654321' };
}
