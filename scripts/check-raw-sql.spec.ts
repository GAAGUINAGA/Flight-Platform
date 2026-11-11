import { findViolations, migrationViolations } from './check-raw-sql.cjs';

describe('check-raw-sql: migraciones nuevas con esquema del servicio', () => {
  it('rechaza ALTER TABLE e índice sin esquema (la migración seat_hold original)', () => {
    const sql = 'ALTER TABLE "seat_assignments" ADD COLUMN "hold_id" UUID;\nCREATE INDEX "seat_assignments_hold_id_idx" ON "seat_assignments"("hold_id");';
    expect(migrationViolations(sql, 'ancillaries')).toEqual([
      expect.objectContaining({ line: 1, object: 'seat_assignments' }),
      expect.objectContaining({ line: 2, object: 'seat_assignments' }),
    ]);
  });
  it('rechaza tipos, claves foráneas y un esquema ajeno', () => {
    expect(migrationViolations('CREATE TYPE "Status" AS ENUM (\'A\');', 'esb')).toHaveLength(1);
    expect(migrationViolations('ALTER TABLE "esb"."a" ADD CONSTRAINT f FOREIGN KEY (x) REFERENCES "b"("id");', 'esb')).toHaveLength(1);
    expect(migrationViolations('ALTER TABLE "public"."a" ADD COLUMN x INT;', 'esb')).toHaveLength(1);
  });
  it('acepta objetos calificados y no lee los comentarios', () => {
    const sql = '-- ALTER TABLE "x" no cuenta\nALTER TABLE "ancillaries"."seat_assignments" ADD COLUMN "hold_id" UUID;\nCREATE UNIQUE INDEX "i" ON "ancillaries"."seat_assignments"("hold_id");\nCREATE TABLE "ancillaries"."t" ("id" UUID);';
    expect(migrationViolations(sql, 'ancillaries')).toEqual([]);
  });
});

describe('check-raw-sql: tablas de consultas a mano con esquema', () => {
  it('rechaza una tabla sin esquema en $queryRaw con genérico anidado', () => {
    const code = 'await prisma.$queryRaw<Array<{ owner_id: string }>>`SELECT "owner_id" FROM "booking_owners" WHERE "booking_id" = ${id}::uuid`;';
    expect(findViolations(code)).toEqual([expect.objectContaining({ table: 'booking_owners' })]);
  });
  it('rechaza INSERT, UPDATE y DELETE sin esquema, también con Prisma.sql y variantes Unsafe', () => {
    expect(findViolations('tx.$executeRaw`INSERT INTO booking_owners (a) VALUES (${a})`')).toHaveLength(1);
    expect(findViolations('tx.$executeRaw`UPDATE reservations SET a = ${a}`')).toHaveLength(1);
    expect(findViolations('p.$queryRaw(Prisma.sql`DELETE FROM deliveries WHERE id = ${id}`)')).toHaveLength(1);
    expect(findViolations("p.$executeRawUnsafe('DELETE FROM holds')")).toHaveLength(1);
  });
  it('acepta tablas calificadas, interpoladas con table() y funciones sin tablas', () => {
    expect(findViolations('tx.$queryRaw`SELECT id FROM "inventory"."holds" WHERE id = ${id} FOR UPDATE`')).toEqual([]);
    expect(findViolations('tx.$queryRaw`SELECT id FROM gateway.scheduler_locks h FOR UPDATE SKIP LOCKED`')).toEqual([]);
    expect(findViolations('tx.$executeRaw`UPDATE ${T.cabins} ci SET held = 1 FROM ${T.flights} fi WHERE fi.id = ci.id`')).toEqual([]);
    expect(findViolations('tx.$executeRaw`INSERT INTO ${T} (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = EXCLUDED.a`')).toEqual([]);
    expect(findViolations('tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${a}:${b}`}))`')).toEqual([]);
  });
  it('detecta la tabla sin esquema dentro de un cuerpo multilínea con interpolaciones anidadas', () => {
    const code = 'x.$queryRaw`\n SELECT a FROM ${T.holds} h\n JOIN lines l ON l.id = ${`${a}`}`;';
    expect(findViolations(code)).toEqual([expect.objectContaining({ table: 'lines' })]);
  });
  it('ignora código que no es una consulta a mano', () => {
    expect(findViolations('const text = `SELECT * FROM nothing`; logger.info("UPDATE foo");')).toEqual([]);
  });
});
