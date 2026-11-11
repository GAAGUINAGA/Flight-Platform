# ADR-F12b1fix-03 — Migraciones nuevas con esquema explícito
- Estado: Aceptado · Fecha: 2026-11-10 · Fase/Tarea: F12b1, corrección de audit-17 (H1)
## Contexto
ADR-F12b1fix-01 exige no depender del `search_path` en consultas a mano. Las migraciones SQL de `prisma/migrations` tampoco deben hacerlo. La migración `20261109120000_seat_hold` usaba `ALTER TABLE "seat_assignments"` sin esquema y se reescribió calificada con `"ancillaries"`. Las migraciones históricas tampoco califican, pero ya están aplicadas en Supabase: modificarlas cambia su suma de verificación y rompe `migrate deploy`.
## Decisión
1. `scripts/check-raw-sql.cjs` (parte de `npm run lint`) revisa también `microservices/*/prisma/migrations/*/migration.sql`: toda tabla (`CREATE/ALTER/DROP TABLE`, `INSERT INTO`, `UPDATE`, `DELETE FROM`, `TRUNCATE`), tipo (`CREATE/ALTER/DROP TYPE`), índice (`CREATE INDEX ... ON`, `DROP INDEX`) y `REFERENCES` debe ir calificado con el esquema del servicio (nombre de la carpeta sin `-service`). Un esquema distinto también falla. Los comentarios `--` se ignoran. El nombre de un índice nuevo no admite esquema; se valida la tabla sobre la que se crea.
2. **Corte por fecha**: solo se revisan las migraciones cuya marca de tiempo es `>= 20261109000000` (constante `MIGRATION_CUTOFF`). Las anteriores quedan exentas por compatibilidad con la base ya desplegada.
3. Pruebas en `scripts/check-raw-sql.spec.ts`.
## Consecuencias
Una migración nueva sin esquema hace fallar el lint. Las históricas quedan sin calificar (registrado en `BACKLOG.md`). Si el generador de Prisma emite SQL sin esquema, hay que calificarlo a mano antes del commit.
