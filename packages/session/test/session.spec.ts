/* global Response, Headers */
import { afterEach } from '@jest/globals';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createMemoryStorage, createSessionClient, readClaims, type SessionClient } from '../src';

const SUPABASE = 'https://proyecto.supabase.test';
const ANON = 'anon-public-key';
const KEY = 'fp.session';

const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (claims: Record<string, unknown>): string => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.firma`;
const now = (): number => Math.floor(Date.now() / 1000);

function sessionBody(options: { sub?: string; role?: string; expiresIn?: number; email?: string; verified?: boolean; refresh?: string } = {}): Record<string, unknown> {
  const expiresIn = options.expiresIn ?? 3600; const sub = options.sub ?? '11111111-1111-4111-8111-111111111111'; const email = options.email ?? 'ana@example.test';
  return {
    access_token: jwt({ sub, aud: 'authenticated', exp: now() + expiresIn, app_role: options.role ?? 'customer', email_verified: options.verified ?? true }),
    token_type: 'bearer', expires_in: expiresIn, expires_at: now() + expiresIn, refresh_token: options.refresh ?? 'refresh-1',
    user: { id: sub, aud: 'authenticated', email, email_confirmed_at: options.verified === false ? null : '2026-11-01T00:00:00Z', app_metadata: {}, user_metadata: { full_name: 'Ana Pérez', app_role: 'admin' }, created_at: '2026-11-01T00:00:00Z' }
  };
}

interface Call { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> }
type Handler = (call: Call) => { status?: number; body: unknown };

function harness(handlers: Record<string, Handler>, initial: Record<string, string> = {}): { client: SessionClient; calls: Call[]; storage: ReturnType<typeof createMemoryStorage> } {
  const calls: Call[] = []; const storage = createMemoryStorage(initial);
  const fetchFake = async (input: unknown, init?: { method?: string; headers?: unknown; body?: unknown }): Promise<Response> => {
    const url = String(input); const headers: Record<string, string> = {};
    new Headers(init?.headers as Record<string, string>).forEach((value, key) => { headers[key] = value; });
    const call: Call = { url, method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {} };
    calls.push(call);
    const path = url.replace(`${SUPABASE}/auth/v1`, '').replace(/&?redirect_to=[^&]*/, '').replace(/\?$/, '');
    const handler = handlers[`${call.method} ${path}`];
    if (!handler) return new Response(JSON.stringify({ code: 404, error_code: 'not_found', msg: 'no handler' }), { status: 404, headers: { 'content-type': 'application/json' } });
    const reply = handler(call);
    if (reply.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  const client = createSessionClient({ supabaseUrl: `${SUPABASE}/`, anonKey: ANON, storage, storageKey: KEY, fetch: fetchFake as never, autoRefresh: false });
  return { client, calls, storage };
}

const authError = (status: number, code: string): { status: number; body: unknown } => ({ status, body: { code: status, error_code: code, msg: 'detalle interno del proveedor que no debe mostrarse' } });

describe('session · Supabase Auth con PKCE sobre almacenamiento inyectado (F12c-2a)', () => {
  const clients: SessionClient[] = [];
  const make = (...args: Parameters<typeof harness>): ReturnType<typeof harness> => { const made = harness(...args); clients.push(made.client); return made; };
  afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.stop())); });

  it('SES-01 sin sesión guardada arranca anónimo, sin llamar a la red', async () => {
    const { client, calls } = make({});
    expect(client.getState()).toEqual({ status: 'loading' });
    expect(await client.start()).toEqual({ status: 'anonymous', expired: false });
    expect(await client.getAccessToken()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('SES-02 iniciar sesión habla con Supabase (no con GraphQL), guarda la sesión en el almacenamiento inyectado y toma el rol del claim firmado', async () => {
    const { client, calls, storage } = make({ 'POST /token?grant_type=password': () => ({ body: sessionBody() }) });
    await client.start();
    const seen: string[] = []; client.subscribe((state) => seen.push(state.status));
    expect(await client.signIn('ana@example.test', 'secreto-123')).toEqual({ ok: true });
    expect(calls[0].url).toBe(`${SUPABASE}/auth/v1/token?grant_type=password`);
    expect(calls[0].headers.apikey).toBe(ANON);
    expect(calls[0].body).toMatchObject({ email: 'ana@example.test', password: 'secreto-123' });
    const state = client.getState();
    // user_metadata.app_role = admin (editable por el usuario) NO da el rol: manda el claim app_role del token.
    expect(state).toMatchObject({ status: 'authenticated', user: { id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.test', name: 'Ana Pérez', role: 'customer', emailVerified: true } });
    expect(seen).toContain('authenticated');
    expect(Object.keys(storage.snapshot())).toContain(KEY);
    expect(readClaims(await client.getAccessToken())).toMatchObject({ sub: '11111111-1111-4111-8111-111111111111', app_role: 'customer' });
  });

  it('SES-03 otra instancia con el mismo almacenamiento recupera la sesión sin red; el rol admin sale del claim', async () => {
    const first = make({ 'POST /token?grant_type=password': () => ({ body: sessionBody({ role: 'admin' }) }) });
    await first.client.start(); await first.client.signIn('admin@example.test', 'secreto-123');
    const second = make({}, first.storage.snapshot());
    expect(await second.client.start()).toMatchObject({ status: 'authenticated', user: { role: 'admin' } });
    expect(second.calls).toHaveLength(0);
  });

  it('SES-04 registro con PKCE: envía code_challenge S256, guarda el verificador y el retorno del correo canjea el código con ese verificador', async () => {
    const { client, calls, storage } = make({
      'POST /signup': () => ({ body: { id: 'u-1', email: 'nueva@example.test', confirmation_sent_at: '2026-11-13T00:00:00Z' } }),
      'POST /token?grant_type=pkce': () => ({ body: sessionBody({ email: 'nueva@example.test' }) })
    });
    await client.start();
    expect(await client.signUp({ email: 'nueva@example.test', password: 'secreto-123', name: 'Nueva', redirectTo: 'https://web.test/acceso/retorno' })).toEqual({ ok: true, needsEmailConfirmation: true });
    const signup = calls[0];
    expect(signup.url).toContain('/signup?redirect_to=https%3A%2F%2Fweb.test%2Facceso%2Fretorno');
    expect(signup.body).toMatchObject({ email: 'nueva@example.test', code_challenge_method: 's256', data: { full_name: 'Nueva' } });
    const verifier = JSON.parse(storage.snapshot()[`${KEY}-code-verifier`]) as string;
    expect(createHash('sha256').update(verifier.split('/')[0]).digest('base64url')).toBe(signup.body.code_challenge);
    expect(client.getState().status).toBe('anonymous');

    expect(await client.exchangeCode('codigo-del-correo')).toEqual({ ok: true, recovery: false });
    expect(calls[1].body).toEqual({ auth_code: 'codigo-del-correo', code_verifier: verifier.split('/')[0] });
    expect(client.getState()).toMatchObject({ status: 'authenticated', user: { email: 'nueva@example.test' } });
    expect(storage.snapshot()[`${KEY}-code-verifier`]).toBeUndefined();
  });

  it('SES-05 recuperar contraseña: PKCE, retorno marcado como recuperación y cambio de contraseña con el token del usuario', async () => {
    const body = sessionBody();
    const { client, calls } = make({
      'POST /recover': () => ({ body: {} }),
      'POST /token?grant_type=pkce': () => ({ body }),
      'PUT /user': () => ({ body: body.user })
    });
    await client.start();
    expect(await client.requestPasswordReset('ana@example.test', 'https://web.test/acceso/retorno')).toEqual({ ok: true });
    expect(calls[0].body).toMatchObject({ email: 'ana@example.test', code_challenge_method: 's256' });
    expect(typeof calls[0].body.code_challenge).toBe('string');
    expect(await client.exchangeCode('codigo-recuperacion')).toEqual({ ok: true, recovery: true });
    expect(await client.updatePassword('nueva-clave-456')).toEqual({ ok: true });
    expect(calls[2].body).toMatchObject({ password: 'nueva-clave-456' });
    expect(calls[2].headers.authorization).toBe(`Bearer ${body.access_token as string}`);
  });

  it('SES-06 los errores salen como motivos genéricos (sin el texto del proveedor) y recuperar no revela si la cuenta existe', async () => {
    const { client } = make({
      'POST /token?grant_type=password': (call) => (call.body.email === 'pendiente@example.test' ? authError(400, 'email_not_confirmed') : call.body.email === 'limite@example.test' ? authError(429, 'over_request_rate_limit') : authError(400, 'invalid_credentials')),
      'POST /signup': (call) => (call.body.password === 'corta' ? authError(422, 'weak_password') : authError(422, 'user_already_exists')),
      'POST /recover': (call) => (call.body.email === 'limite@example.test' ? authError(429, 'over_email_send_rate_limit') : authError(400, 'user_not_found')),
      'POST /token?grant_type=pkce': () => authError(400, 'flow_state_expired')
    });
    await client.start();
    const results = [
      await client.signIn('ana@example.test', 'mala'), await client.signIn('pendiente@example.test', 'x'), await client.signIn('limite@example.test', 'x'),
      await client.signUp({ email: 'a@example.test', password: 'corta', redirectTo: 'https://web.test/acceso/retorno' }),
      await client.signUp({ email: 'existe@example.test', password: 'secreto-123', redirectTo: 'https://web.test/acceso/retorno' })
    ];
    expect(results).toEqual([{ ok: false, reason: 'invalid_credentials' }, { ok: false, reason: 'email_not_confirmed' }, { ok: false, reason: 'rate_limited' }, { ok: false, reason: 'weak_password' }, { ok: false, reason: 'signup_failed' }]);
    expect(JSON.stringify(results)).not.toContain('detalle interno');
    expect(await client.requestPasswordReset('no-existe@example.test', 'https://web.test/acceso/retorno')).toEqual({ ok: true });
    expect(await client.requestPasswordReset('limite@example.test', 'https://web.test/acceso/retorno')).toEqual({ ok: false, reason: 'rate_limited' });
    expect(await client.exchangeCode('codigo-viejo')).toEqual({ ok: false, reason: 'link_expired' });
    expect(client.getState().status).toBe('anonymous');
  });

  it('SES-07 un token vencido se refresca al pedirlo; si el refresco falla la sesión queda anónima y marcada como expirada', async () => {
    const { client, calls } = make({
      'POST /token?grant_type=password': () => ({ body: sessionBody({ expiresIn: 1, refresh: 'refresh-viejo' }) }),
      'POST /token?grant_type=refresh_token': () => ({ body: sessionBody({ refresh: 'refresh-nuevo' }) })
    });
    await client.start(); await client.signIn('ana@example.test', 'secreto-123');
    const token = await client.getAccessToken();
    expect(calls[1].url).toContain('grant_type=refresh_token');
    expect(calls[1].body).toEqual({ refresh_token: 'refresh-viejo' });
    expect(Number(readClaims(token).exp)).toBeGreaterThan(now() + 600);

    // Un usuario que vuelve con el token de acceso ya vencido y un refresh token que el servidor ya no reconoce.
    const dead = { ...sessionBody({ expiresIn: -120 }), expires_at: now() - 120 };
    const expiring = make({ 'POST /token?grant_type=refresh_token': () => authError(400, 'refresh_token_not_found') }, { [KEY]: JSON.stringify(dead) });
    const seen: unknown[] = []; expiring.client.subscribe((state) => seen.push(state));
    await expiring.client.start();
    expect(await expiring.client.getAccessToken()).toBeNull();
    expect(expiring.client.getState().status).toBe('anonymous');
    expect(expiring.storage.snapshot()[KEY]).toBeUndefined();
  });

  it('SES-07b una sesión activa cuyo refresco falla al pedir el token queda anónima y marcada como expirada', async () => {
    const { client, storage } = make({
      'POST /token?grant_type=password': () => ({ body: sessionBody() }),
      'POST /token?grant_type=refresh_token': () => authError(400, 'refresh_token_not_found')
    });
    await client.start(); await client.signIn('ana@example.test', 'secreto-123');
    // El token de acceso vence mientras la app está abierta (se reescribe lo guardado con una expiración pasada).
    const stored = JSON.parse(storage.snapshot()[KEY]) as Record<string, unknown>;
    await storage.setItem(KEY, JSON.stringify({ ...stored, expires_at: now() - 120 }));
    expect(await client.getAccessToken()).toBeNull();
    expect(client.getState()).toEqual({ status: 'anonymous', expired: true });
  });

  it('SES-08 cerrar sesión borra lo guardado y no se marca como expirada, también si el aviso al servidor falla', async () => {
    const { client, storage } = make({ 'POST /token?grant_type=password': () => ({ body: sessionBody() }), 'POST /logout?scope=local': () => ({ status: 204, body: {} }) });
    await client.start(); await client.signIn('ana@example.test', 'secreto-123');
    await client.signOut();
    expect(client.getState()).toEqual({ status: 'anonymous', expired: false });
    expect(storage.snapshot()[KEY]).toBeUndefined();

    const offline = make({ 'POST /token?grant_type=password': () => ({ body: sessionBody() }), 'POST /logout?scope=local': () => authError(500, 'unexpected_failure') });
    await offline.client.start(); await offline.client.signIn('ana@example.test', 'secreto-123');
    await offline.client.signOut();
    expect(offline.client.getState()).toEqual({ status: 'anonymous', expired: false });
    expect(offline.storage.snapshot()[KEY]).toBeUndefined();
    expect(await offline.client.getAccessToken()).toBeNull();
  });

  it('SES-09 readClaims nunca lanza: token nulo, con otra forma o con carga que no es JSON', () => {
    expect(readClaims(null)).toEqual({});
    expect(readClaims('no-es-un-jwt')).toEqual({});
    expect(readClaims('a.%%%.c')).toEqual({});
    expect(readClaims(`a.${Buffer.from('[1,2]').toString('base64url')}.c`)).toEqual({});
    expect(readClaims(jwt({ sub: 'u', nombre: 'Íñigo Ñandú 日本' }))).toEqual({ sub: 'u', nombre: 'Íñigo Ñandú 日本' });
  });
});
