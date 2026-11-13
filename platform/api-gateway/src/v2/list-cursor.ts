import { Buffer } from 'node:buffer';

/**
 * Cursor compuesto (fecha de creación, id) de las listas ordenadas de la más reciente a la más antigua (F12c-1, punto 0). Es opaco para el cliente; mismo formato que el de
 * «mis reservas» en Reservation (`encodeListCursor`), que se mantiene aparte porque cada servicio es independiente. El desempate por id evita que dos filas con la misma fecha
 * (precisión de milisegundos) se repitan o se salten en el borde de una página.
 */
const PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export interface CreatedCursor { createdAt: Date; id: string }
export const encodeCreatedCursor = (createdAt: Date, id: string): string => Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
/** `undefined` si el texto no es un cursor válido (el llamador responde 400). */
export function decodeCreatedCursor(cursor: string): CreatedCursor | undefined {
  if (cursor.length === 0 || cursor.length > 200) return undefined;
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  if (Buffer.from(text, 'utf8').toString('base64url') !== cursor) return undefined; // forma canónica: Node ignora caracteres ajenos al alfabeto, y un cursor alterado no debe valer
  const match = PATTERN.exec(text); if (!match) return undefined;
  const createdAt = new Date(match[1]); return Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== match[1] ? undefined : { createdAt, id: match[2].toLowerCase() };
}
export const isAfterCreatedCursor = (createdAt: Date, id: string, cursor: CreatedCursor): boolean => createdAt.getTime() < cursor.createdAt.getTime() || (createdAt.getTime() === cursor.createdAt.getTime() && id < cursor.id);
