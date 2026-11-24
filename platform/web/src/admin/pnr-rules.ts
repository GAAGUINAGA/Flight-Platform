/** La web NO valida el formato del localizador: todo intento, también el mal escrito, debe llegar al Gateway para quedar registrado (ADR-F12c4-01, adenda). */
export const normalizePnr = (value: string): string => value.trim().toUpperCase();

const STATUS: Record<string, string> = {
  CONFIRMED: 'Confirmada', PENDING: 'Pendiente', PENDING_PAYMENT: 'Pago pendiente', TICKET_ISSUING: 'Emitiendo boletos', FAILED: 'Fallida',
  CHANGE_PENDING: 'Cambio pendiente', CANCELLATION_PENDING: 'Cancelación pendiente', CANCELLED: 'Cancelada'
};
const TICKET: Record<string, string> = { ISSUED: 'Emitido', PENDING: 'Pendiente', VOIDED: 'Anulado', REFUNDED: 'Reembolsado', FAILED: 'Fallido', USED: 'Usado' };
/** Valor explícito del Gateway cuando Operations no respondió (decisión 9, ADR-F12c4-01): NO equivale a «sin check-in». */
export const CHECK_IN_UNKNOWN = 'UNKNOWN';
export const isCheckInUnknown = (status: string): boolean => status === CHECK_IN_UNKNOWN;
const CHECK_IN: Record<string, string> = { NOT_STARTED: 'Sin check-in', IN_PROGRESS: 'En curso', COMPLETED: 'Completado', FAILED: 'Con fallos', CHECKED_IN: 'Con check-in', NOT_CHECKED_IN: 'Sin check-in', [CHECK_IN_UNKNOWN]: 'No se pudo consultar' };
const PASSENGER: Record<string, string> = { ADULT: 'Adulto', YOUTH: 'Joven', CHILD: 'Niño', INFANT: 'Infante' };

export const bookingStatusLabel = (value: string): string => STATUS[value] ?? value;
export const ticketStatusLabel = (value: string): string => TICKET[value] ?? value;
export const checkInStatusLabel = (value: string): string => CHECK_IN[value] ?? value;
export const passengerTypeLabel = (value: string): string => PASSENGER[value] ?? value;
export const channelLabel = (value: string): string => (value === 'WEB' ? 'Web' : 'Socio');

/** `AAAA-MM-DDTHH:mm` (hora local del aeropuerto) → fecha y hora. No convierte zonas: ya viene en la hora local del aeropuerto. */
export function splitLocal(value: string): { date: string; time: string } {
  const [date = '', time = ''] = value.split('T');
  return { date, time };
}
