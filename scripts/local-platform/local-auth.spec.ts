/* global require, fetch, URL, __dirname */
import { afterAll, beforeAll } from '@jest/globals';
import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { importSPKI, jwtVerify } from 'jose';
import { createMemoryStorage, createSessionClient, type SessionClient } from '../../packages/session/src';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createAuthServer, AUDIENCE } = require('./local-auth.cjs') as { createAuthServer: (options: { port: number; privateKeyPem: string; origins: string[] }) => { server: Server; issuer: string }; AUDIENCE: string };

const ORIGIN = 'http://localhost:5173';
const freePort = (): Promise<number> => new Promise((resolve) => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address() as AddressInfo; probe.close(() => resolve(port)); }); });

describe('plataforma local · servicio de acceso de pruebas con el cliente de sesión real (F12c-2a)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  let server: Server | undefined; let base = ''; let issuer = ''; const clients: SessionClient[] = [];
  const client = (): SessionClient => { const made = createSessionClient({ supabaseUrl: base, anonKey: 'local-anon', storage: createMemoryStorage(), autoRefresh: false }); clients.push(made); return made; };

  beforeAll(async () => {
    const port = await freePort(); const made = createAuthServer({ port, privateKeyPem: privateKey, origins: [ORIGIN] });
    server = made.server; issuer = made.issuer; base = `http://127.0.0.1:${port}`;
    await new Promise<void>((resolve) => { server!.listen(port, '127.0.0.1', resolve); });
  });
  afterAll(async () => {
    await Promise.all(clients.map((entry) => entry.stop()));
    await new Promise<void>((resolve) => { if (server) server.close(() => resolve()); else resolve(); });
  });

  it('LAU-01 registrarse inicia sesión con un token RS256 que el Gateway y GraphQL locales pueden verificar (emisor, audiencia, rol y scopes de cliente)', async () => {
    const session = client(); await session.start();
    expect(await session.signUp({ email: 'Ana@Example.test', password: 'secreto-123', name: 'Ana', redirectTo: `${ORIGIN}/acceso/retorno` })).toEqual({ ok: true, needsEmailConfirmation: false });
    expect(session.getState()).toMatchObject({ status: 'authenticated', user: { email: 'ana@example.test', name: 'Ana', role: 'customer', emailVerified: true } });
    const { payload, protectedHeader } = await jwtVerify((await session.getAccessToken())!, await importSPKI(publicKey, 'RS256'), { issuer, audience: AUDIENCE, algorithms: ['RS256'] });
    expect(protectedHeader.alg).toBe('RS256');
    expect(payload).toMatchObject({ app_role: 'customer', scope: 'flights:read flights:hold flights:book flights:cancel', email_verified: true });
    expect(payload.sub).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('LAU-02 iniciar sesión con la contraseña correcta; credenciales inválidas y correo repetido salen como motivos genéricos', async () => {
    const session = client(); await session.start();
    expect(await session.signIn('ana@example.test', 'secreto-123')).toEqual({ ok: true });
    await session.signOut();
    expect(await session.signIn('ana@example.test', 'otra-clave')).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(await session.signIn('nadie@example.test', 'secreto-123')).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(await session.signUp({ email: 'ana@example.test', password: 'secreto-123', redirectTo: `${ORIGIN}/acceso/retorno` })).toEqual({ ok: false, reason: 'signup_failed' });
    expect(await session.signUp({ email: 'corta@example.test', password: 'corta', redirectTo: `${ORIGIN}/acceso/retorno` })).toEqual({ ok: false, reason: 'weak_password' });
  });

  it('LAU-03 recuperar contraseña con PKCE: el enlace del buzón de pruebas se canjea solo con el verificador de ESE navegador', async () => {
    const session = client(); await session.start();
    // Misma respuesta exista o no la cuenta. (Cada solicitud renueva el verificador PKCE del navegador: vale el último enlace pedido.)
    expect(await session.requestPasswordReset('nadie@example.test', `${ORIGIN}/acceso/retorno`)).toEqual({ ok: true });
    expect(await session.requestPasswordReset('ana@example.test', `${ORIGIN}/acceso/retorno`)).toEqual({ ok: true });
    expect((await fetch(`${base}/local/mailbox?email=nadie@example.test`)).status).toBe(404);
    const { link } = await (await fetch(`${base}/local/mailbox?email=ana@example.test`)).json() as { link: string };
    expect(link.startsWith(`${ORIGIN}/acceso/retorno?code=`)).toBe(true);
    const code = new URL(link).searchParams.get('code')!;
    // Otro navegador (sin el verificador) no puede usar el enlace.
    const other = client(); await other.start();
    expect((await other.exchangeCode(code)).ok).toBe(false);
    expect(await session.exchangeCode(code)).toEqual({ ok: true, recovery: true });
    expect(await session.updatePassword('nueva-clave-456')).toEqual({ ok: true });
    expect((await session.exchangeCode(code)).ok).toBe(false); // de un solo uso
    const again = client(); await again.start();
    expect(await again.signIn('ana@example.test', 'secreto-123')).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(await again.signIn('ana@example.test', 'nueva-clave-456')).toEqual({ ok: true });
  });

  it('LAU-04 un enlace de recuperación hacia otro sitio no se genera; CORS solo para la web local', async () => {
    const session = client(); await session.start();
    await session.requestPasswordReset('ana@example.test', 'https://malo.example/acceso/retorno');
    const { link } = await (await fetch(`${base}/local/mailbox?email=ana@example.test`)).json() as { link: string };
    expect(link.startsWith('https://malo.example')).toBe(false);
    const allowed = await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'OPTIONS', headers: { origin: ORIGIN } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const foreign = await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'OPTIONS', headers: { origin: 'https://malo.example' } });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(`${base}/auth/v1/user`, { headers: { authorization: 'Bearer a.b.c' } })).status).toBe(401);
  });

  it('LAU-05 se niega a arrancar con NODE_ENV=production', () => {
    const run = spawnSync(process.execPath, [join(__dirname, 'local-auth.cjs'), '--port', '1'], { env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('no arranca con NODE_ENV=production');
  });
});
