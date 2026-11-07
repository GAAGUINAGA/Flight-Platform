/* global __dirname, console, process */
// ADR-F12b1-fix-01: toda consulta a mano ($queryRaw, $executeRaw, Prisma.sql y variantes Unsafe) debe calificar sus tablas con el esquema.
// Una tabla sin esquema depende del search_path de la conexión, que el pooler de Supabase (modo transacción) no garantiza.
// Se acepta: una interpolación `${...}` (p. ej. table('x') de schema.ts) o un nombre calificado `esquema.tabla` / "esquema"."tabla".
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const root = join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'generated', 'prisma-client', '.git', 'coverage']);
const ENTRY = /\$(?:queryRaw|executeRaw)(?:Unsafe)?\s*(?:<[^`'"(]*>)?\s*\(?\s*(?=[`'"])|\bPrisma\.sql\s*(?=`)|\bsql\s*(?=`)/g;
const PLACEHOLDER = '\u0001';

/** Devuelve [contenido, índiceFinal] del literal que empieza en `start` (comilla o acento grave). Las interpolaciones se sustituyen por PLACEHOLDER. */
function readLiteral(text, start) {
  const quote = text[start];
  let out = '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') { out += text[i + 1] ?? ''; i += 2; continue; }
    if (ch === quote) return [out, i + 1];
    if (quote === '`' && ch === '$' && text[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        const c = text[i];
        if (c === '`') { i = readLiteral(text, i)[1]; continue; }
        if (c === '{') depth++;
        else if (c === '}') depth--;
        i++;
      }
      out += PLACEHOLDER;
      continue;
    }
    out += ch;
    i++;
  }
  return [out, i];
}

const KEYWORD = /\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:ONLY\s+)?([^\s,;]+)/gi;
const QUALIFIED = /^(?:"[^"]+"|[A-Za-z_][\w$]*)\.(?:"[^"]+"|[A-Za-z_][\w$]*)/;

/** Tablas sin esquema en un texto SQL. */
function unqualifiedTables(sql) {
  const found = [];
  for (const match of sql.matchAll(KEYWORD)) {
    const keyword = match[1].toUpperCase();
    const target = match[2];
    const before = sql.slice(0, match.index).trimEnd().split(/\s+/).pop()?.toUpperCase() ?? '';
    if (keyword === 'UPDATE' && (before === 'FOR' || before === 'DO')) continue; // FOR UPDATE / ON CONFLICT DO UPDATE
    if (keyword === 'FROM' && before === 'DISTINCT') continue; // IS DISTINCT FROM
    if (target.startsWith(PLACEHOLDER) || target.startsWith('(') || target.includes('(')) continue; // interpolación, subconsulta o función
    if (QUALIFIED.test(target)) continue;
    found.push(target.replace(/["`]/g, ''));
  }
  return found;
}

/** Violaciones de un archivo: [{ line, table }]. */
function findViolations(text) {
  const violations = [];
  for (const entry of text.matchAll(ENTRY)) {
    const start = entry.index + entry[0].length;
    if (!['`', "'", '"'].includes(text[start])) continue;
    const [sql] = readLiteral(text, start);
    for (const name of unqualifiedTables(sql)) {
      violations.push({ line: text.slice(0, start).split('\n').length, table: name });
    }
  }
  return violations;
}

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(?:ts|cjs|mjs|js)$/.test(name) && !/check-raw-sql/.test(name)) yield path;
  }
}

function run() {
  const failures = [];
  for (const dir of ['microservices', 'platform', 'packages']) {
    for (const file of sources(join(root, dir))) {
      for (const v of findViolations(readFileSync(file, 'utf8'))) failures.push(`${relative(root, file)}:${v.line} tabla sin esquema: ${v.table}`);
    }
  }
  if (failures.length) {
    console.error(`Consultas a mano con tablas sin esquema (usa table() de schema.ts):\n${failures.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('raw SQL: todas las tablas llevan esquema');
  }
}

if (require.main === module) run();
module.exports = { findViolations, unqualifiedTables };
