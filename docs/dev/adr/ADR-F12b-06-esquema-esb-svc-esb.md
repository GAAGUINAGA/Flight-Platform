# ADR-F12b-06 — Esquema `esb` y usuario `svc_esb`
- Estado: Aceptado (bloque 0 aprobado por el humano 2026-11-08) · Fecha: 2026-11-08 · Fase/Tarea: F12b-2 / Bloque 0
## Contexto
El ESB no tenía base de datos (F12b-1). La outbox necesita persistencia propia. Cada servicio tiene su esquema y su rol (`infra/db/roles.sql`), creados por el humano, y las migraciones no crean esquemas, extensiones ni permisos (AGENTS.md).
## Decisión
- Esquema `esb`, rol `svc_esb` con `search_path = esb, public` y `USAGE, CREATE` solo sobre `esb`. El bloque SQL idempotente y sin contraseñas está en `docs/dev/f12b2-diseno-bus.md` §3.3; lo aplica el humano en local y en Supabase.
- Una tabla: `esb.outbox_events` (§3.1 del diseño). Prisma y `@prisma/client` en `6.12.0` exacto; migraciones solo dentro de `esb`.
- SQL a mano (reclamo con `SKIP LOCKED`, limpieza) con esquema explícito mediante el ayudante `table()` del patrón de `webhooks-service` (lo verifica `npm run lint`); una sola sentencia por reclamo, compatible con el pooler de Supabase en modo transacción.
- Retención de filas `PUBLISHED`: 7 días (`ESB_OUTBOX_RETENTION_DAYS`).
## Consecuencias
- El ESB deja de ser sin estado: necesita `DATABASE_URL`/`DIRECT_URL`, `prisma generate` en CI y en el Dockerfile, y `prisma:generate` real (hoy es un marcador).
- Ningún otro servicio accede al esquema `esb`; los emisores solo hablan con el ESB por HTTP.
- La plataforma local necesita `ROLE_PASSWORD_ESB` y la creación manual del rol en volúmenes ya inicializados.
