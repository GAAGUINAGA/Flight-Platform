#!/usr/bin/env node
/* Comprueba el sitio construido (platform/web/dist), diseño F12c-0 §10.2 «Seguridad» y «Clon limpio»:
 *   - el bundle no contiene secretos (llave service_role, llaves privadas, JWT distintos de la llave anon pública);
 *   - no hay mapas de código fuente ni archivos .env publicados;
 *   - index.html trae la CSP con connect-src limitado a GraphQL y Supabase, sin scripts ni estilos en línea;
 *   - todos los recursos son propios (ningún CDN).
 * Uso: node scripts/check-bundle.mjs   (tras `npm run build -w @flight-platform/web`; lee VITE_SUPABASE_ANON_KEY solo para excluirla de la búsqueda). */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const list = (dir) => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? list(path) : [path]; });
const problems = [];
let files;
try { files = list(dist); } catch { process.stderr.write('check-bundle: no existe platform/web/dist (construye primero)\n'); process.exit(1); }
const name = (file) => relative(dist, file).replaceAll('\\', '/');
const anon = process.env.VITE_SUPABASE_ANON_KEY ?? '';

for (const file of files) {
  if (/\.map$/.test(file)) problems.push(`${name(file)}: mapa de código fuente publicado`);
  if (/(^|[\\/])\.env/.test(file)) problems.push(`${name(file)}: archivo de entorno publicado`);
  if (!/\.(js|css|html|svg)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  if (/service_role/i.test(text)) problems.push(`${name(file)}: contiene «service_role»`);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) problems.push(`${name(file)}: contiene una llave privada`);
  for (const token of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
    if (token !== anon) problems.push(`${name(file)}: contiene un JWT que no es la llave anon`);
  }
  if (/\b(DATABASE_URL|INTERNAL_API_KEY|RABBITMQ_URL|WEBHOOK_SECRET)\b/.test(text)) problems.push(`${name(file)}: nombra un secreto del backend`);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
if (!csp) problems.push('index.html: falta la CSP');
else {
  const connect = /connect-src ([^;]+)/.exec(csp)?.[1].split(' ') ?? [];
  if (connect.length < 1 || connect.length > 2 || connect.some((origin) => !/^https?:\/\/[^/*']+$/.test(origin))) problems.push(`index.html: connect-src inesperado (${connect.join(' ')})`);
  if (/unsafe-inline|unsafe-eval/.test(csp)) problems.push('index.html: la CSP permite inline o eval');
}
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) problems.push('index.html: script en línea');
if (/<style[\s>]|\sstyle="/.test(html)) problems.push('index.html: estilo en línea');
for (const reference of html.match(/(?:src|href)="([^"]+)"/g) ?? []) if (/="(https?:)?\/\//.test(reference)) problems.push(`index.html: recurso externo ${reference}`);
for (const file of files.filter((entry) => entry.endsWith('.css'))) if (/url\((['"]?)(https?:)?\/\//.test(readFileSync(file, 'utf8'))) problems.push(`${name(file)}: recurso externo en CSS`);

if (problems.length > 0) { process.stderr.write(`check-bundle: ${problems.length} problema(s)\n${problems.map((problem) => ` - ${problem}`).join('\n')}\n`); process.exit(1); }
process.stdout.write(`check-bundle: OK (${files.length} archivos; CSP presente; sin secretos, mapas ni recursos externos)\n`);
