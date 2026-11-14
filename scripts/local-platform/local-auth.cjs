#!/usr/bin/env node
/* Servicio de acceso LOCAL DE PRUEBAS para la web (F12c-2a, ADR-F12c2a-02). Imita lo mínimo de la API de Supabase Auth (GoTrue) que usa
 * `@flight-platform/session`, con usuarios EN MEMORIA, para que `local:up -Web` y el e2e funcionen sin cuenta ni proyecto real.
 *   node scripts/local-platform/local-auth.cjs --init-keys --key-dir .local          (genera el par RSA si falta; no imprime la llave)
 *   node scripts/local-platform/local-auth.cjs --port 54329 --key-dir .local --origins http://localhost:5173
 * NO es un servicio de producción: se niega a arrancar con NODE_ENV=production, escucha solo en 127.0.0.1, confirma el correo al registrarse
 * y pierde los usuarios al detenerse. El Gateway y el servicio GraphQL locales aceptan su emisor porque local:up les pasa la llave PÚBLICA.
 * No registra correos, contraseñas ni tokens. */
'use strict';
const http = require('node:http');
const { Buffer } = require('node:buffer');
const { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, scryptSync, sign, timingSafeEqual, verify } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const process = require('node:process');
const { URL } = require('node:url');

const PRIVATE_NAME = 'web-auth-private.pem';
const PUBLIC_NAME = 'web-auth-public.pem';
const AUDIENCE = 'authenticated';
const SCOPE = 'flights:read flights:hold flights:book flights:cancel';
const TOKEN_SECONDS = 3600;
const MAX_BODY = 10 * 1024;
const MAX_USERS = 500;

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
const issuerFor = (port) => `http://127.0.0.1:${port}/auth/v1`;

function initKeys(dir) {
  const privatePath = join(dir, PRIVATE_NAME); const publicPath = join(dir, PUBLIC_NAME);
  if (!existsSync(privatePath) || !existsSync(publicPath)) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    mkdirSync(dir, { recursive: true });
    writeFileSync(privatePath, privateKey, { mode: 0o600 }); writeFileSync(publicPath, publicKey);
  }
  return { privatePath, publicPath };
}

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function createAuthServer({ port, privateKeyPem, origins }) {
  const privateKey = createPrivateKey(privateKeyPem); const publicKey = createPublicKey(privateKey);
  const issuer = issuerFor(port);
  /** @type {Map<string, {id: string, email: string, name: string|null, salt: Buffer, hash: Buffer, createdAt: string}>} */
  const users = new Map();
  const refreshTokens = new Map(); // token → userId
  const flows = new Map();         // código → { userId, challenge, type }
  const mailbox = new Map();       // correo → último enlace «enviado»

  const hashPassword = (password, salt) => scryptSync(password, salt, 32);
  const signToken = (user) => {
    const now = Math.floor(Date.now() / 1000);
    const input = `${b64({ alg: 'RS256', typ: 'JWT', kid: 'local-web-1' })}.${b64({ iss: issuer, aud: AUDIENCE, sub: user.id, email: user.email, role: 'authenticated', app_role: 'customer', scope: SCOPE, email_verified: true, session_id: randomUUID(), iat: now, exp: now + TOKEN_SECONDS })}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
  };
  const userBody = (user) => ({ id: user.id, aud: AUDIENCE, role: 'authenticated', email: user.email, email_confirmed_at: user.createdAt, app_metadata: { provider: 'email' }, user_metadata: user.name ? { full_name: user.name } : {}, created_at: user.createdAt, updated_at: user.createdAt });
  const sessionBody = (user) => {
    const refresh = randomBytes(24).toString('base64url'); refreshTokens.set(refresh, user.id);
    return { access_token: signToken(user), token_type: 'bearer', expires_in: TOKEN_SECONDS, expires_at: Math.floor(Date.now() / 1000) + TOKEN_SECONDS, refresh_token: refresh, user: userBody(user) };
  };
  const userFromBearer = (req) => {
    const header = req.headers.authorization ?? ''; const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const parts = token.split('.'); if (parts.length !== 3) return undefined;
    try {
      if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], 'base64url'))) return undefined;
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (claims.iss !== issuer || claims.exp <= Math.floor(Date.now() / 1000)) return undefined;
      return [...users.values()].find((user) => user.id === claims.sub);
    } catch { return undefined; }
  };
  const validEmail = (value) => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const send = (res, status, body, origin) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) };
    if (status === 204) { res.writeHead(204, headers); res.end(); return; }
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body));
  };
  const fail = (res, status, code, origin) => send(res, status, { code: status, error_code: code, msg: code }, origin);
  const readJson = (req) => new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { try { const text = Buffer.concat(chunks).toString(); const parsed = text ? JSON.parse(text) : {}; resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });

  const server = http.createServer(async (req, res) => {
    const requested = req.headers.origin; const origin = requested && origins.includes(requested) ? requested : undefined;
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`); const route = `${req.method} ${url.pathname}`;
      if (req.method === 'OPTIONS') {
        if (!origin) { res.writeHead(403); res.end(); return; }
        res.writeHead(204, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version', 'Access-Control-Max-Age': '600' });
        res.end(); return;
      }
      if (route === 'GET /health') { send(res, 200, { status: 'ok', issuer, audience: AUDIENCE, local: true }, origin); return; }
      // Buzón de pruebas: el «correo» de recuperación no se envía; el enlace se consulta aquí (solo local).
      if (route === 'GET /local/mailbox') { const link = mailbox.get(String(url.searchParams.get('email') ?? '').toLowerCase()); if (link) send(res, 200, { link }, origin); else fail(res, 404, 'not_found', origin); return; }
      if (route === 'GET /auth/v1/user') { const user = userFromBearer(req); if (user) send(res, 200, userBody(user), origin); else fail(res, 401, 'bad_jwt', origin); return; }
      if (route === 'POST /auth/v1/logout') { send(res, 204, undefined, origin); return; }
      if (req.method !== 'POST' && req.method !== 'PUT') { fail(res, 404, 'not_found', origin); return; }
      const body = await readJson(req);

      if (route === 'POST /auth/v1/signup') {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (!validEmail(email)) { fail(res, 422, 'email_address_invalid', origin); return; }
        if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 200) { fail(res, 422, 'weak_password', origin); return; }
        if (users.has(email)) { fail(res, 422, 'user_already_exists', origin); return; }
        if (users.size >= MAX_USERS) { fail(res, 429, 'over_request_rate_limit', origin); return; }
        const salt = randomBytes(16); const name = typeof body.data?.full_name === 'string' ? body.data.full_name.slice(0, 80) : null;
        const user = { id: randomUUID(), email, name, salt, hash: hashPassword(body.password, salt), createdAt: new Date().toISOString() };
        users.set(email, user);
        send(res, 200, sessionBody(user), origin); return;
      }
      if (route === 'POST /auth/v1/token') {
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password') {
          const user = users.get(typeof body.email === 'string' ? body.email.trim().toLowerCase() : '');
          const candidate = hashPassword(typeof body.password === 'string' ? body.password : '', user ? user.salt : Buffer.alloc(16));
          if (!user || !timingSafeEqual(candidate, user.hash)) { fail(res, 400, 'invalid_credentials', origin); return; }
          send(res, 200, sessionBody(user), origin); return;
        }
        if (grant === 'refresh_token') {
          const token = typeof body.refresh_token === 'string' ? body.refresh_token : ''; const userId = refreshTokens.get(token);
          const user = [...users.values()].find((entry) => entry.id === userId);
          if (!user) { fail(res, 400, 'refresh_token_not_found', origin); return; }
          refreshTokens.delete(token);
          send(res, 200, sessionBody(user), origin); return;
        }
        if (grant === 'pkce') {
          const flow = flows.get(typeof body.auth_code === 'string' ? body.auth_code : '');
          const challenge = createHash('sha256').update(typeof body.code_verifier === 'string' ? body.code_verifier : '').digest('base64url');
          const user = flow ? [...users.values()].find((entry) => entry.id === flow.userId) : undefined;
          if (!flow || !user || challenge !== flow.challenge) { fail(res, 400, 'flow_state_not_found', origin); return; }
          flows.delete(body.auth_code);
          send(res, 200, sessionBody(user), origin); return;
        }
        fail(res, 400, 'validation_failed', origin); return;
      }
      if (route === 'POST /auth/v1/recover') {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''; const user = users.get(email);
        const redirect = url.searchParams.get('redirect_to') ?? '';
        // Solo se «envía» a un destino de la propia web local. La respuesta es la misma exista o no la cuenta.
        if (user && typeof body.code_challenge === 'string' && origins.some((allowed) => redirect.startsWith(`${allowed}/`))) {
          const code = randomBytes(18).toString('base64url'); flows.set(code, { userId: user.id, challenge: body.code_challenge, type: 'recovery' });
          mailbox.set(email, `${redirect}?code=${code}`);
        }
        send(res, 200, {}, origin); return;
      }
      if (route === 'PUT /auth/v1/user') {
        const user = userFromBearer(req);
        if (!user) { fail(res, 401, 'bad_jwt', origin); return; }
        if (typeof body.password === 'string') {
          if (body.password.length < 8 || body.password.length > 200) { fail(res, 422, 'weak_password', origin); return; }
          user.salt = randomBytes(16); user.hash = hashPassword(body.password, user.salt);
        }
        send(res, 200, userBody(user), origin); return;
      }
      fail(res, 404, 'not_found', origin);
    } catch { fail(res, 400, 'validation_failed', origin); }
  });
  return { server, issuer };
}

function main() {
  if (process.env.NODE_ENV === 'production') { process.stderr.write('local-auth: es un servicio de pruebas local y no arranca con NODE_ENV=production\n'); process.exit(1); }
  const keyDir = option('key-dir', '.local');
  const { privatePath, publicPath } = initKeys(keyDir);
  if (args.includes('--init-keys')) { process.stdout.write(`local-auth: llaves listas en ${keyDir} (la privada no se imprime); pública: ${publicPath}\n`); return; }
  const port = Number(option('port', '54329'));
  const origins = option('origins', 'http://localhost:5173').split(',').map((entry) => entry.trim()).filter(Boolean);
  const { server, issuer } = createAuthServer({ port, privateKeyPem: readFileSync(privatePath, 'utf8'), origins });
  server.listen(port, '127.0.0.1', () => { process.stdout.write(`local-auth: servicio de acceso LOCAL DE PRUEBAS en ${issuer} (usuarios en memoria)\n`); });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

if (require.main === module) main();
module.exports = { createAuthServer, initKeys, issuerFor, AUDIENCE, PUBLIC_NAME };
