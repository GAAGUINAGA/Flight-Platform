/* global console, process, URL */
// Purga los vuelos de prueba (avion ^T[0-9a-f]{20}$) y sus filas dependientes de la base LOCAL.
// Uso:  PURGE_DATABASE_URL=<url con permisos sobre los esquemas> node scripts/local-platform/purge-test-flights.cjs [--yes]
//   sin --yes: solo cuenta (no escribe). con --yes: borra todo en una unica transaccion.
// Seguridad: aborta si el host no es 127.0.0.1/localhost o la base no es flight_platform. No imprime la URL.
// Alcance: filas con flight_instance_id de los vuelos de prueba. No toca reservations (itineraries es JSON),
// offers (snapshot JSON) ni pedidos de otros servicios: caducan o se limpian con la base local.
const { PrismaClient } = require('@prisma/client');

const TAIL = '^T[0-9a-f]{20}$';
const url = process.env.PURGE_DATABASE_URL;
const apply = process.argv.includes('--yes');

function abort(message) {
  console.error(`purge-test-flights: ${message}`);
  process.exit(1);
}

if (!url) abort('define PURGE_DATABASE_URL (base local).');
let parsed;
try { parsed = new URL(url); } catch { abort('PURGE_DATABASE_URL no es una URL valida.'); }
const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) abort(`host no permitido (${parsed.hostname}); solo 127.0.0.1 o localhost.`);
if (database !== 'flight_platform') abort(`base no permitida (${database}); solo flight_platform.`);

// Pasos en orden de borrado (hijos antes que padres). ids = uuid[] de vuelos de prueba; holds = uuid[] de holds afectados.
const STEPS = [
  { name: 'ancillaries.seat_assignments', sql: 'DELETE FROM "ancillaries"."seat_assignments" WHERE flight_instance_id = ANY($1::uuid[])', count: 'SELECT count(*) AS n FROM "ancillaries"."seat_assignments" WHERE flight_instance_id = ANY($1::uuid[])', arg: 'ids' },
  { name: 'ancillaries.seat_layouts', sql: `DELETE FROM "ancillaries"."seat_layouts" WHERE aircraft ~ '${TAIL}'`, count: `SELECT count(*) AS n FROM "ancillaries"."seat_layouts" WHERE aircraft ~ '${TAIL}'` },
  { name: 'pricing.fares', sql: 'DELETE FROM "pricing"."fares" WHERE flight_instance_id = ANY($1::uuid[])', count: 'SELECT count(*) AS n FROM "pricing"."fares" WHERE flight_instance_id = ANY($1::uuid[])', arg: 'ids' },
  { name: 'pricing.price_locks (de holds afectados)', sql: 'DELETE FROM "pricing"."price_locks" WHERE hold_id = ANY($1::uuid[])', count: 'SELECT count(*) AS n FROM "pricing"."price_locks" WHERE hold_id = ANY($1::uuid[])', arg: 'holds' },
  { name: 'operations.operational_updates', sql: 'DELETE FROM "operations"."operational_updates" WHERE operational_flight_id IN (SELECT id FROM "operations"."operational_flights" WHERE flight_instance_id = ANY($1::uuid[]))', count: 'SELECT count(*) AS n FROM "operations"."operational_updates" WHERE operational_flight_id IN (SELECT id FROM "operations"."operational_flights" WHERE flight_instance_id = ANY($1::uuid[]))', arg: 'ids' },
  { name: 'operations.operational_flights', sql: 'DELETE FROM "operations"."operational_flights" WHERE flight_instance_id = ANY($1::uuid[])', count: 'SELECT count(*) AS n FROM "operations"."operational_flights" WHERE flight_instance_id = ANY($1::uuid[])', arg: 'ids' },
  { name: 'inventory.reserved_inventory', sql: 'DELETE FROM "inventory"."reserved_inventory" WHERE flight_instance_id = ANY($1::uuid[])', count: 'SELECT count(*) AS n FROM "inventory"."reserved_inventory" WHERE flight_instance_id = ANY($1::uuid[])', arg: 'ids' },
  { name: 'inventory.hold_lines', sql: 'DELETE FROM "inventory"."hold_lines" WHERE flight_instance_id = ANY($1::uuid[])', count: 'SELECT count(*) AS n FROM "inventory"."hold_lines" WHERE flight_instance_id = ANY($1::uuid[])', arg: 'ids' },
  // Holds que quedaron sin lineas ni reservas (cascada a sus hold_lines/reserved_inventory ya vaciadas).
  { name: 'inventory.holds (sin lineas tras la purga)', sql: 'DELETE FROM "inventory"."holds" h WHERE h.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM "inventory"."hold_lines" l WHERE l.hold_id = h.id) AND NOT EXISTS (SELECT 1 FROM "inventory"."reserved_inventory" r WHERE r.hold_id = h.id)', count: 'SELECT count(*) AS n FROM "inventory"."holds" WHERE id = ANY($1::uuid[])', arg: 'holds' },
  { name: 'inventory.cabin_inventory', sql: 'DELETE FROM "inventory"."cabin_inventory" WHERE flight_instance_id = ANY($1::uuid[])', count: 'SELECT count(*) AS n FROM "inventory"."cabin_inventory" WHERE flight_instance_id = ANY($1::uuid[])', arg: 'ids' },
  { name: 'inventory.flight_instances', sql: 'DELETE FROM "inventory"."flight_instances" WHERE id = ANY($1::uuid[])', count: 'SELECT count(*) AS n FROM "inventory"."flight_instances" WHERE id = ANY($1::uuid[])', arg: 'ids' },
];

async function collect(db) {
  const flights = await db.$queryRawUnsafe(
    `SELECT id::text AS id FROM "inventory"."flight_instances" WHERE aircraft ~ '${TAIL}'
     UNION SELECT flight_instance_id::text FROM "operations"."operational_flights" WHERE aircraft ~ '${TAIL}'`);
  const ids = flights.map((r) => r.id);
  const holdRows = ids.length
    ? await db.$queryRawUnsafe('SELECT DISTINCT hold_id::text AS id FROM "inventory"."hold_lines" WHERE flight_instance_id = ANY($1::uuid[]) UNION SELECT hold_id::text FROM "inventory"."reserved_inventory" WHERE flight_instance_id = ANY($1::uuid[])', ids)
    : [];
  return { ids, holds: holdRows.map((r) => r.id) };
}

async function main() {
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const { ids, holds } = await collect(db);
    console.log(`Vuelos de prueba: ${ids.length} · holds afectados: ${holds.length}`);
    if (!apply) {
      for (const step of STEPS) {
        const rows = await db.$queryRawUnsafe(step.count, ...(step.arg ? [step.arg === 'ids' ? ids : holds] : []));
        console.log(`  ${step.name}: ${Number(rows[0].n)}`);
      }
      console.log('Solo conteo. Repite con --yes para borrar (una transaccion).');
      return;
    }
    await db.$transaction(async (tx) => {
      for (const step of STEPS) {
        const n = await tx.$executeRawUnsafe(step.sql, ...(step.arg ? [step.arg === 'ids' ? ids : holds] : []));
        console.log(`  ${step.name}: ${n} borradas`);
      }
    }, { timeout: 120_000 });
    console.log('Purga completada.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(`purge-test-flights: fallo (${error?.code ?? error?.name ?? 'error'}); la transaccion se revirtio.`);
  process.exit(1);
});
