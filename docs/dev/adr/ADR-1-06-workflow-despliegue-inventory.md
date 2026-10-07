# ADR-1-06 ? Despliegue de Inventory con el workflow reutilizable
- Estado: Aceptado (revisado tras F2) ? Fecha: 2026-10-06 ? Fase/Tarea: F1 / INV-13

## Contexto
Una primera versi?n usaba un workflow propio porque `deploy-service.yml` no permit?a otro Dockerfile ni secretos adicionales. F2 lo extendi? con `dockerfile`, `extra_secrets` y `test_command`. Faltaba a?n una base Postgres para las pruebas de integraci?n de Inventory (migraci?n y seed incluidos). Seg?n `docs/audit/context/flujo-cierre.md`, el despliegue se hace desde `main` (WIF solo acepta esa rama) y no bloquea la auditor?a de c?digo.

## Decisi?n
- `deploy-inventory.yml` llama a `deploy-service.yml` con su Dockerfile, el secreto adicional `DATABASE_URL=inventory-database-url:latest` y solo las pruebas unitarias del servicio. Se dispara en `pull_request` y en `push` a `main` con filtro de rutas; no hay `workflow_dispatch`. En ramas solo corre la verificaci?n; la autenticaci?n y el despliegue ocurren ?nicamente en `main`.
- Se extiende `deploy-service.yml` con `dockerfile`, `extra_secrets` y `test_command`. El comando por defecto ejecuta Jest únicamente bajo el directorio del servicio, nunca `npm test` de la raíz.
- La migraci?n, el seed en Supabase y las pruebas de integraci?n/concurrencia/seguridad se ejecutan localmente y durante auditor?a. No se ejecutan desde CI.
- `prisma` y `@prisma/client` se fijan en 6.12.0: desde 6.13 `prisma` depende de `deepmerge-ts` (vulnerabilidad `high`) y `npm audit --audit-level=high` del reutilizable fallar?a.

## Consecuencias
Un solo flujo de despliegue para los servicios. `npm audit` en la ra?z audita todos los workspaces: mientras otro servicio dependa de `prisma` ? 6.13 el audit falla para todos.
