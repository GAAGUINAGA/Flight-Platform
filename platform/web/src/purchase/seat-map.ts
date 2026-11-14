import type { SeatCharacteristic, SeatMapQuery, SeatStatus } from '@flight-platform/graphql-schema/generated/types';

/** Lógica del mapa de asientos sin pantalla: textos de estado, nombre accesible y navegación con flechas. */
export type SeatMapCabin = SeatMapQuery['seatMap']['cabins'][number];
export type MapSeat = SeatMapCabin['rows'][number]['seats'][number];

/** El estado SIEMPRE se comunica por texto (no solo por color). */
export const SEAT_STATUS_LABEL: Readonly<Record<SeatStatus, string>> = {
  AVAILABLE: 'libre', HELD: 'apartado por otro viajero', BOOKED: 'ocupado', TICKETED: 'ocupado', CHECKED_IN: 'ocupado (con check-in)', BOARDED: 'ocupado'
};
export const SEAT_FEATURE_LABEL: Readonly<Record<SeatCharacteristic, string>> = { WINDOW: 'ventana', AISLE: 'pasillo', EXTRA_LEGROOM: 'más espacio para las piernas', EMERGENCY_EXIT: 'salida de emergencia' };

export const isSelectable = (seat: Pick<MapSeat, 'status'>): boolean => seat.status === 'AVAILABLE';
export const seatLetter = (seatNumber: string): string => seatNumber.replace(/^\d+/, '');

/** «Asiento 8A, ventana, libre» / «Asiento 8B, pasillo, elegido por Pasajero 2». */
export function seatLabel(seat: MapSeat, chosenBy?: string): string {
  const features = seat.characteristics.map((feature) => SEAT_FEATURE_LABEL[feature]).join(', ');
  const status = chosenBy ? `elegido por ${chosenBy}` : SEAT_STATUS_LABEL[seat.status];
  return `Asiento ${seat.seatNumber}${features ? `, ${features}` : ''}, ${status}`;
}

/** Letras de las columnas, en el orden de la fila más completa. */
export function columnLetters(cabin: SeatMapCabin): string[] {
  const widest = cabin.rows.reduce((best, row) => (row.seats.length > best.seats.length ? row : best), cabin.rows[0] ?? { seats: [] });
  return widest.seats.map((seat) => seatLetter(seat.seatNumber));
}

/** ¿Hay pasillo entre este asiento y el siguiente de la fila? */
export const aisleAfter = (row: SeatMapCabin['rows'][number], index: number): boolean =>
  index < row.seats.length - 1 && row.seats[index].characteristics.includes('AISLE') && row.seats[index + 1].characteristics.includes('AISLE');

export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';
/** Posición `[fila, columna]` a la que lleva una flecha (o `null` si no hay a dónde ir). Las filas pueden tener distinto ancho. */
export function moveFocus(cabin: SeatMapCabin, from: [row: number, col: number], key: Arrow): [number, number] | null {
  const [row, col] = from; const rows = cabin.rows;
  if (key === 'Home') return [row, 0];
  if (key === 'End') return [row, Math.max(0, rows[row].seats.length - 1)];
  if (key === 'ArrowLeft') return col > 0 ? [row, col - 1] : null;
  if (key === 'ArrowRight') return col < rows[row].seats.length - 1 ? [row, col + 1] : null;
  const next = key === 'ArrowUp' ? row - 1 : row + 1;
  if (next < 0 || next >= rows.length) return null;
  return [next, Math.min(col, rows[next].seats.length - 1)];
}
