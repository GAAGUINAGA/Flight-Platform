/* global console, process, URL */
// ADR-F12b1fix-02: corrige operations.operational_flights.date al día LOCAL del aeropuerto de origen (NFR-TI-01).
// Antes de la fase la fecha se guardaba como día UTC de la salida. Solo cambia filas cuyo día local difiere del guardado.
//
// Uso (desde microservices/operations-service, con el .env del servicio cargado sin imprimirlo):
//   local:    node --env-file=.env ../../scripts/local-platform/fix-operational-flight-dates.cjs [--yes]
//   Supabase: npx --yes @dotenvx/dotenvx run -f .env.supabase -- node ../../scripts/local-platform/fix-operational-flight-dates.cjs [--yes]
//   sin --yes: solo cuenta y lista (vuelo, origen, fecha vieja, fecha nueva, conflicto). con --yes: corrige en UNA transacción.
// Idempotente: una segunda ejecución no encuentra filas. Si el cambio chocaría con la unicidad (flight_number, date) aborta sin escribir.
// Zonas: salen de @flight-platform/shared (AIRPORT_ZONES); un origen sin zona se trata como UTC, igual que en la lectura.
// Usa DATABASE_URL del servicio. No imprime la URL; solo el host para confirmar el destino (en Supabase debe ser pooler.supabase.com).
const { AIRPORT_ZONES } = require('@flight-platform/shared');
const { PrismaClient } = require('@prisma/client');

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
/** Expresión SQL con la zona IANA del origen; las zonas vienen de una tabla de código, no de entrada de usuario. */
const zoneSql = () => `CASE departure_iata ${Object.entries(AIRPORT_ZONES).map(([iata, zone]) => `WHEN ${quote(iata)} THEN ${quote(zone)}`).join(' ')} ELSE 'UTC' END`;
const newDateSql = () => `to_char(scheduled_departure_at AT TIME ZONE ${zoneSql()}, 'YYYY-MM-DD')`;

/** Filas cuyo día local difiere del guardado. `prefix` (solo para pruebas) limita por prefijo de número de vuelo; vacío = todas. */
async function affected(db, prefix = '') {
  return db.$queryRawUnsafe(
    `SELECT c.id::text AS id, c.flight_number, c.departure_iata, c.old_date, c.new_date,
            EXISTS (SELECT 1 FROM "operations"."operational_flights" o WHERE o.flight_number = c.flight_number AND o.date = c.new_date AND o.id <> c.id) AS conflict
     FROM (SELECT id, flight_number, departure_iata, date AS old_date, ${newDateSql()} AS new_date FROM "operations"."operational_flights" WHERE flight_number LIKE $1) c
     WHERE c.old_date <> c.new_date ORDER BY c.flight_number, c.old_date`, `${prefix.replace(/[%_\\]/g, '\\$&')}%`);
}

/** Corrige en una transacción. Devuelve { rows, updated }. Lanza (y revierte) si hay conflictos de unicidad. */
async function apply(db, prefix = '') {
  return db.$transaction(async (tx) => {
    const rows = await affected(tx, prefix);
    const conflicts = rows.filter((row) => row.conflict);
    if (conflicts.length) throw Object.assign(new Error('conflicto de unicidad'), { code: 'CONFLICT', conflicts });
    const updated = rows.length
      ? await tx.$executeRawUnsafe(`UPDATE "operations"."operational_flights" SET date = ${newDateSql()} WHERE id = ANY($1::uuid[])`, rows.map((row) => row.id))
      : 0;
    return { rows, updated };
  }, { timeout: 60_000 });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('fix-operational-flight-dates: define DATABASE_URL (carga el .env del servicio).'); process.exit(1); }
  let host;
  try { host = new URL(url).hostname; } catch { console.error('fix-operational-flight-dates: DATABASE_URL no es una URL válida.'); process.exit(1); }
  console.log(`Destino: ${host}`);
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    if (!process.argv.includes('--yes')) {
      const rows = await affected(db);
      for (const row of rows) console.log(`  ${row.flight_number} ${row.departure_iata}: ${row.old_date} → ${row.new_date}${row.conflict ? '  ¡CONFLICTO!' : ''}`);
      console.log(`Afectadas: ${rows.length}. Solo conteo; repite con --yes para corregir (una transacción).`);
      return;
    }
    const { rows, updated } = await apply(db);
    for (const row of rows) console.log(`  ${row.flight_number} ${row.departure_iata}: ${row.old_date} → ${row.new_date}`);
    console.log(`Corregidas: ${updated}.`);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    if (error?.code === 'CONFLICT') console.error(`fix-operational-flight-dates: ${error.conflicts.length} fila(s) chocarían con la unicidad (flight_number, date); no se escribió nada.`);
    else console.error(`fix-operational-flight-dates: fallo (${error?.code ?? error?.name ?? 'error'}); la transacción se revirtió.`);
    process.exit(1);
  });
}

module.exports = { affected, apply, newDateSql };
