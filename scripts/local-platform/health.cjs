#!/usr/bin/env node
/* Health de la plataforma local: consulta GET /api/v2/vuelos/health del Gateway (que sondea los siete servicios por gRPC).
 *   node scripts/local-platform/health.cjs [--url http://127.0.0.1:3000] [--wait 90]
 * Sale con 0 solo si el estado es HEALTHY y los siete servicios están UP. No imprime secretos. */
/* global fetch, AbortSignal */
const process = require('node:process');
const { setTimeout } = require('node:timers');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
const base = (option('url', 'http://127.0.0.1:3000')).replace(/\/+$/, '');
const waitSeconds = Number(option('wait', '0'));
const esbBase = option('esb', '').replace(/\/+$/, '');
const EXPECTED = 7;

/** El ESB (F12b-1) debe estar vivo: con GATEWAY_TRANSPORT=esb el health del Gateway ya pasa por él, esto solo lo hace explícito. */
async function esbAlive() {
  if (!esbBase) return true;
  try { const response = await fetch(`${esbBase}/health`, { signal: AbortSignal.timeout(3000) }); return response.ok; } catch { return false; }
}

async function probe() {
  try {
    const response = await fetch(`${base}/api/v2/vuelos/health`, { signal: AbortSignal.timeout(4000) });
    const body = await response.json();
    return { reachable: true, httpStatus: response.status, body };
  } catch (error) { return { reachable: false, reason: error instanceof Error ? error.message : 'error' }; }
}
const healthy = (result) => result.reachable && result.body?.status === 'HEALTHY' && Array.isArray(result.body.dependencias) && result.body.dependencias.length >= EXPECTED && result.body.dependencias.every((item) => item.status === 'UP');

async function main() {
  const deadline = Date.now() + waitSeconds * 1000; let result;
  for (;;) {
    result = await probe();
    if (healthy(result) || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!result.reachable) { process.stdout.write(`Gateway sin respuesta en ${base} (${result.reason})\n`); process.exit(1); }
  const { body } = result;
  process.stdout.write(`Gateway ${base}: ${body.status} (HTTP ${result.httpStatus}) nodo=${body.nodo_id} proveedor=${body.nombre_proveedor}\n`);
  for (const item of body.dependencias ?? []) process.stdout.write(`  ${item.status === 'UP' ? 'OK  ' : 'FALLA'} ${String(item.nombre).padEnd(22)} ${item.status} ${item.latencia_ms} ms\n`);
  const esbOk = await esbAlive();
  if (esbBase) process.stdout.write(`  ${esbOk ? 'OK  ' : 'FALLA'} esb ${esbBase}\n`);
  if (!healthy(result) || !esbOk) { process.stdout.write('La plataforma NO está sana.\n'); process.exit(1); }
  process.stdout.write(`La plataforma está sana: el Gateway${esbBase ? ', el ESB' : ''} y los siete servicios responden.\n`);
}
void main();
