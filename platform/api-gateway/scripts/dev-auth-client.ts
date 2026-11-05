/**
 * Alta, baja y reactivación de clientes `client_credentials` del dev-auth (F12a).
 *
 *   npm run dev-auth:client -- create --client-id booking --scopes flights:read,flights:book --out platform/api-gateway/.local/booking.secret
 *   npm run dev-auth:client -- disable --client-id booking
 *   npm run dev-auth:client -- enable --client-id booking
 *   npm run dev-auth:client -- delete --client-id journey-local --yes     (solo journey-*; otro id exige además --allow-any-id; solo base local)
 *   npm run dev-auth:client -- check-local                                (falla si DATABASE_URL no es 127.0.0.1/localhost + flight_platform)
 *
 * Usa DATABASE_URL del entorno del Gateway. El secreto se genera aquí, solo se guarda su hash (scrypt) y se entrega
 * UNA vez: por defecto a un archivo (modo 0600) que queda fuera de git; solo con --print se escribe en la terminal.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import process from 'node:process';
import { PrismaClient } from '../generated/prisma-client';
import { DEV_AUTH_SCOPES, generateClientSecret, hashClientSecret, isValidClientId } from '../src/v2/dev-auth';
import { assertDeletableClient, assertLocalDatabase } from '../src/v2/local-db-guard';
import { PrismaDevAuthClientStore } from '../src/v2/prisma-dev-auth-store';

const args = process.argv.slice(2);
const command = args[0];
const option = (name: string): string | undefined => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };

async function main(): Promise<void> {
  if (command === 'check-local') { assertLocalDatabase(process.env.DATABASE_URL); process.stdout.write('la base es la local\n'); return; }
  const clientId = option('client-id');
  if (!['create', 'disable', 'enable', 'delete'].includes(command ?? '') || !clientId) throw new Error('Uso: create|disable|enable|delete|check-local --client-id <id> [--scopes a,b] [--out archivo | --print] [--yes [--allow-any-id]]');
  if (command === 'delete') {
    if (!args.includes('--yes')) throw new Error('delete exige confirmación explícita: agregue --yes');
    assertDeletableClient(clientId, args.includes('--allow-any-id'));
    assertLocalDatabase(process.env.DATABASE_URL);
  }
  const prisma = new PrismaClient(); const store = new PrismaDevAuthClientStore(prisma);
  try {
    if (command === 'delete') { const removed = await store.deleteWithDependents(clientId); process.stdout.write(`cliente ${clientId}: borrado ${JSON.stringify(removed)}\n`); return; }
    if (command !== 'create') { await store.setActive(clientId, command === 'enable'); process.stdout.write(`cliente ${clientId}: ${command}\n`); return; }
    if (!isValidClientId(clientId)) throw new Error('client-id debe usar solo [A-Za-z0-9_-], de 3 a 40 caracteres, y no puede tener forma de UUID');
    const scopes = (option('scopes') ?? DEV_AUTH_SCOPES.join(',')).split(',').map((scope) => scope.trim()).filter(Boolean);
    const invalid = scopes.filter((scope) => !(DEV_AUTH_SCOPES as readonly string[]).includes(scope));
    if (invalid.length) throw new Error(`scopes desconocidos: ${invalid.join(', ')}`);
    const out = option('out'); const print = args.includes('--print');
    if (!out && !print) throw new Error('Indique --out <archivo> (recomendado) o --print para recibir el secreto');
    if (await store.find(clientId)) throw new Error(`el cliente ${clientId} ya existe`);
    const secret = generateClientSecret();
    await store.create({ clientId, secretHash: await hashClientSecret(secret), scopes, active: true, name: option('name') });
    if (out) {
      if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `client_id=${clientId}\nclient_secret=${secret}\n`, { mode: 0o600 }); chmodSync(out, 0o600);
      process.stdout.write(`cliente ${clientId} creado con scopes [${scopes.join(', ')}]; el secreto se escribió en ${out}\n`);
    } else process.stdout.write(`cliente ${clientId} creado con scopes [${scopes.join(', ')}]\nclient_secret=${secret}\n`);
  } finally { await prisma.$disconnect(); }
}
main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : 'error'}\n`); process.exitCode = 1; });
