import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

// ADR-F12b1-fix-01: reproduce el incidente de Supabase (pooler en modo transacción sin search_path del esquema).
// Una conexión única cuyo search_path es solo `public` hace fallar cualquier consulta a mano con tabla sin esquema (42P01).

interface RawClient {
  $executeRawUnsafe(query: string): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
}

/** Carga el .env del propio servicio (sin imprimir valores) y devuelve su DATABASE_URL; falla rápido si falta. */
export function serviceDatabaseUrl(service: string): string {
  const env = join(process.cwd(), service, '.env');
  if (!process.env.DATABASE_URL && existsSync(env)) process.loadEnvFile(env);
  if (!process.env.DATABASE_URL) throw new Error(`DATABASE_URL is required for ${service} integration tests`);
  return process.env.DATABASE_URL;
}

/** Misma URL con un único socket, para que el SET de search_path afecte a todas las consultas del cliente. */
export function singleConnectionUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('connection_limit', '1');
  parsed.searchParams.set('pool_timeout', '30');
  return parsed.toString();
}

/** Deja la única conexión del cliente con `search_path = public` y comprueba que la tabla sin esquema ya no se resuelve. */
export async function pinPublicSearchPath(prisma: RawClient, schema: string, unqualifiedTable: string): Promise<void> {
  await prisma.$executeRawUnsafe('SET search_path TO public');
  const [row] = await prisma.$queryRawUnsafe<Array<{ search_path: string }>>('SHOW search_path');
  if (row?.search_path !== 'public') throw new Error('search_path was not pinned to public');
  const visible = await prisma.$queryRawUnsafe<Array<{ found: string | null }>>(
    `SELECT to_regclass('${unqualifiedTable.replace(/[^a-z0-9_]/g, '')}')::text AS found`
  );
  if (visible[0]?.found !== null) throw new Error(`precondition failed: ${unqualifiedTable} resolves without schema (${schema})`);
}
