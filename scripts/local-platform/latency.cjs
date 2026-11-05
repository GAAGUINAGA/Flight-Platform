#!/usr/bin/env node
/* Latencia del Gateway contra la plataforma local ya levantada (up.ps1 con -ProfileFile .local/integracion.prueba.env):
 *   node scripts/local-platform/latency.cjs --profile .local/integracion.prueba.env [--label esb] [--reps 30] [--booking-reps 10] [--url http://127.0.0.1:3000]
 * Mide health, búsqueda, hold y reserva (hold + POST /bookings con pago pendiente) tras 3 repeticiones de calentamiento.
 * Imprime una línea JSON por operación (n, ok, mediana, p95, máximo en ms). Solo base local; crea y borra su cliente journey-latency-*; no imprime secretos.
 * Las reservas quedan PENDING_PAYMENT en la base local (el scheduler las expira); es dato de prueba. */
/* global fetch, AbortSignal, URLSearchParams, __dirname */
const process = require('node:process');
const { randomUUID } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, rmSync } = require('node:fs');
const { createServer } = require('node:http');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
const base = option('url', 'http://127.0.0.1:3000').replace(/\/+$/, '');
const label = option('label', 'sin-etiqueta');
const reps = Number(option('reps', '30')); const bookingReps = Number(option('booking-reps', '10')); const warmup = 3;
const profilePath = resolve(repo, option('profile', '.local/integracion.prueba.env'));
const profile = {};
if (existsSync(profilePath)) for (const line of readFileSync(profilePath, 'utf8').split(/\r?\n/)) { const text = line.trim(); if (!text || text.startsWith('#')) continue; const index = text.indexOf('='); if (index > 0) profile[text.slice(0, index).trim()] = text.slice(index + 1).trim().replace(/^(["'])(.*)\1$/, '$2'); }

const cli = (...cliArgs) => {
  const run = spawnSync('npx', ['tsx', '--env-file=platform/api-gateway/.env', 'platform/api-gateway/scripts/dev-auth-client.ts', ...cliArgs], { cwd: repo, encoding: 'utf8', shell: true });
  return { ok: run.status === 0, message: (run.stdout || run.stderr || '').split(/\r?\n/)[0] };
};
const api = async (method, path, { token, user, body, key, form, headers = {} } = {}) => {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(30_000) };
  if (token) init.headers.Authorization = `Bearer ${token}`; if (user) init.headers['X-User-Id'] = user; if (key) init.headers['Idempotency-Key'] = key;
  if (form) { init.headers['content-type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const started = process.hrtime.bigint();
  const response = await fetch(`${base}${path}`, init); const text = await response.text(); let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: response.status, body: json, ms: Number(process.hrtime.bigint() - started) / 1e6 };
};
const passenger = (id) => ({ passengerId: id, passengerType: 'ADULT', firstName: 'Maria', lastName: 'Andrade', documentType: 'PASSPORT', documentNumber: 'LAT12345', nationality: 'EC', documentExpiryDate: '2035-01-01', birthDate: '1990-01-01', gender: 'F', contact: { email: 'maria@example.invalid', phone: '+593999999999' }, assignedSeats: [], extraBaggage: [] });
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const report = (operation, samples, failures) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const line = { label, operation, n: samples.length + failures.length, ok: samples.length, failures, medianMs: sorted.length ? Math.round(percentile(sorted, 50) * 10) / 10 : null, p95Ms: sorted.length ? Math.round(percentile(sorted, 95) * 10) / 10 : null, maxMs: sorted.length ? Math.round(sorted[sorted.length - 1] * 10) / 10 : null };
  process.stdout.write(`${JSON.stringify(line)}\n`);
};
async function measure(operation, count, run) {
  const samples = []; const failures = [];
  for (let i = 0; i < warmup + count; i += 1) {
    const result = await run(i); if (i < warmup) continue;
    if (result.ok) samples.push(result.ms); else failures.push(result.status);
  }
  report(operation, samples, failures);
}

async function main() {
  const local = cli('check-local'); if (!local.ok) { process.stdout.write(`Medición abortada: ${local.message}\n`); process.exit(1); }
  const clientId = `journey-latency-${Date.now().toString(36)}`; const secretFile = join(repo, '.local', `${clientId}.secret`); mkdirSync(join(repo, '.local'), { recursive: true });
  const url = profile.BOOKING_PAYMENTS_BASE_URL; const match = url && /^http:\/\/(127\.0\.0\.1|localhost):(\d+)$/.exec(url.replace(/\/+$/, ''));
  const replies = new Map(); let server;
  if (match) {
    server = createServer((request, response) => { const reference = decodeURIComponent((request.url ?? '').replace(/^\/pagos\//, '')); const reply = replies.get(reference); if (!reply) { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{}'); return; } response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(reply)); });
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(Number(match[2]), '127.0.0.1', resolveListen); });
  } else { process.stdout.write('El perfil no apunta la API de pagos a esta máquina: se omite la medición de reserva.\n'); }
  try {
    if (!cli('create', '--client-id', clientId, '--out', secretFile).ok) throw new Error('no se pudo crear el cliente de prueba');
    const secret = /client_secret=(.+)/.exec(readFileSync(secretFile, 'utf8'))[1].trim();
    const token = (await api('POST', '/api/v2/oauth2/token', { form: { grant_type: 'client_credentials', client_id: clientId, client_secret: secret } })).body?.access_token;
    if (!token) throw new Error('sin token');
    const user = 'latency-user'; const date = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const searchBody = { itineraries: [{ origin: 'UIO', destination: 'GYE', departureDate: date }], passengers: { adults: 1 } };
    const search = (i) => api('POST', '/api/v2/vuelos/search', { body: searchBody, headers: { 'x-device-fingerprint': randomUUID() } }).then((r) => ({ ...r, ok: r.status === 200 && r.body?.offers?.length > 0, i }));
    await measure('health', reps, () => api('GET', '/api/v2/vuelos/health').then((r) => ({ ...r, ok: r.status === 200 })));
    await measure('search', reps, search);
    const first = (await search(0)).body?.offers?.[0]; if (!first) throw new Error('la búsqueda no devolvió ofertas');
    const itinerary = first.itineraries[0]; const option0 = itinerary.pricingOptions[0];
    const holdRequest = { body: { offerId: first.offerId, itinerarySelections: [{ itineraryId: itinerary.itineraryId, cabinClass: option0.cabinClass, fareBrand: option0.fareBrand }], passengersBreakdown: { adults: 1 } } };
    const holds = [];
    await measure('hold', reps, async () => { const r = await api('POST', '/api/v2/vuelos/offers/hold', { token, user, key: randomUUID(), ...holdRequest }); if (r.status === 201) holds.push(r.body.holdId); return { ...r, ok: r.status === 201 }; });
    for (const holdId of holds) await api('DELETE', `/api/v2/vuelos/offers/hold/${holdId}`, { token, user });
    if (match) {
      await measure('booking', bookingReps, async (i) => {
        const hold = await api('POST', '/api/v2/vuelos/offers/hold', { token, user, key: randomUUID(), ...holdRequest });
        if (hold.status !== 201) return { status: hold.status, ok: false, ms: 0 };
        const reference = `PAY-LAT-${randomUUID()}`; replies.set(reference, { estado: 'PENDIENTE', monto: hold.body.lockedPrice.total, moneda: hold.body.lockedPrice.currency });
        const booking = await api('POST', '/api/v2/vuelos/bookings', { token, user, key: randomUUID(), body: { holdId: hold.body.holdId, passengers: [passenger(`PAX-${i}`)], payment: { paymentReference: reference } } });
        return { ...booking, ok: booking.status === 202 };
      });
    }
  } finally {
    if (server) await new Promise((resolveStop) => server.close(() => resolveStop()));
    if (existsSync(secretFile)) rmSync(secretFile, { force: true });
    const removed = cli('delete', '--client-id', clientId, '--yes'); process.stdout.write(`cliente de prueba ${clientId}: ${removed.ok ? 'eliminado' : 'NO se pudo eliminar'}\n`);
  }
}
main().then(() => process.exit(0)).catch((error) => { process.stdout.write(`Medición interrumpida: ${error instanceof Error ? error.message : 'error'}\n`); process.exit(1); });
