import { URL } from 'node:url';
/**
 * Guardas de las herramientas de desarrollo que escriben o borran datos (dev-auth-client delete, local:journey).
 * Nunca incluyen la cadena de conexión ni sus partes en los mensajes de error.
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
export const LOCAL_DATABASE_NAME = 'flight_platform';
export const DISPOSABLE_CLIENT_PREFIX = 'journey-';

/** Acepta solo host 127.0.0.1/localhost y base exactamente `flight_platform` (no `flight_platform_integracion`, no Supabase). */
export function assertLocalDatabase(databaseUrl: string | undefined): void {
  if (!databaseUrl) throw new Error('DATABASE_URL no está definida: se aborta sin hacer nada');
  let parsed: URL;
  try { parsed = new URL(databaseUrl); } catch { throw new Error('DATABASE_URL no se pudo interpretar: se aborta sin hacer nada'); }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!LOCAL_HOSTS.has(parsed.hostname.toLowerCase()) || database !== LOCAL_DATABASE_NAME) {
    throw new Error(`la base no es la local (se exige host 127.0.0.1/localhost y base ${LOCAL_DATABASE_NAME}): se aborta sin hacer nada`);
  }
}

/** Solo se borran clientes `journey-*` salvo que se pase además --allow-any-id. */
export function assertDeletableClient(clientId: string, allowAnyId: boolean): void {
  if (!allowAnyId && !clientId.startsWith(DISPOSABLE_CLIENT_PREFIX)) {
    throw new Error(`solo se borran clientes que empiezan por "${DISPOSABLE_CLIENT_PREFIX}"; para otro id agregue --allow-any-id`);
  }
}
