import { Prisma } from './prisma-client/client';

// ADR-F12b1-fix-01 / ADR-F12b-06: único lugar donde el ESB nombra su esquema. Toda consulta a mano califica sus tablas con `table()`
// y no depende del search_path de la conexión (el pooler de Supabase en modo transacción no lo garantiza).
export const SCHEMA = 'esb';
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** Tabla calificada con el esquema del servicio. Solo acepta identificadores constantes del código, nunca datos de entrada. */
export const table = (name: string): Prisma.Sql => {
  if (!IDENTIFIER.test(name)) throw new Error('Invalid table identifier');
  return Prisma.raw(`"${SCHEMA}"."${name}"`);
};
