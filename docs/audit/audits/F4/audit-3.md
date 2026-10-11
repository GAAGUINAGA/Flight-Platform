# Auditoría F4 — #3
- Fecha: 2026-10-10 · Commit auditado: 157f2eb · Veredicto: APROBADO

Auditoría de código (flujo-cierre.md). GW-10 (Render) fuera de alcance por indicación del humano. Clon `C:\Proyectos\fp-audit` en `157f2eb`, árbol limpio antes y después de las pruebas. Respecto de `ae2825e` (commit de código de la bitácora dev F4 #4) solo cambia esa bitácora.

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Comandos en el clon: `prisma:generate -w api-gateway`, `build -w shared` (exit 0), `npm run lint` (exit 0), `build -w api-gateway` (exit 0), `npm audit --audit-level=high` (exit 0, 20 moderadas), `npx jest platform/api-gateway --runInBand` (2 suites, 44/44: 43 unitarias + 1 integración Prisma contra Postgres local), `npx jest packages/shared --runInBand` (11/11).

Verificación de hallazgos de audit-2: H1 (GW-SEC-01) resuelto, `gateway.spec.ts:44-48` cubre los cinco casos 401; H2 (GW-SEC-03) resuelto, `:73-75` cubren CORS, 413 y proto http; H3 (GW-SEC-04) resuelto, `:67-71` fuerzan error en la app y verifican logs redactados; H4 (GW-02) resuelto, `:76` valida 400 con `invalidParams`; H5 (GW-06/GAP-031) resuelto, `errors.ts:27`, `web-errors.ts:31`, `:61`; H6 resuelto, `:62-65` parametriza los 24 `code` contra su status; H7 (GW-07) resuelto, `:81` fija URLs por variable.

Contrato: los 24 `code` de `PUBLIC_PROBLEM_CODES` (`errors.ts:8`) coinciden con el enum de `ProblemDetails.code` (`vuelos-openapi.yaml:751-774`); los status coinciden con PLAN §1.4.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
- Incidente: la bitácora dev F4 #2 documenta lectura de `infra/.env`; la bitácora dev F4 #3 documenta que Prisma cargó `platform/api-gateway/.env` en el build. Según el humano, la contraseña fue rotada y se agregó la regla en `AGENTS.md`.
- Procedimiento: el smoke de imagen Docker (regla aprendida de `AGENTS.md`) no figura ejecutado por el developer ni se ejecutó en esta auditoría; no está en el checklist de cierre del plan.
- GW-04: el 409 + `Retry-After: 1` de «en curso» (GAP-031) solo se prueba en el almacén (`prisma-idempotency.integration.spec.ts:19`), no por HTTP; el interceptor lo implementa en `idempotency.interceptor.ts:26`.
- GW-03: la correlación se prueba en `/health`, 400, 401 y 404 (`gateway.spec.ts:76-77`), no en toda respuesta posible.
- `RateLimitGuard`: mapa en memoria sin purga (`security.ts:55`). `@nestjs/throttler` y `@nestjs/schedule` declarados sin uso.
- Los 404/405/500 salen con `code: VALIDATION_FAILED` según ADR-F4-03; no contradice un valor de §1.
- `npm audit`: 20 vulnerabilidades moderadas (cadena jest/sprintf-js); no superan el umbral `high`.
- Checklist: Render/HTTPS/HSTS en producción diferidos a GW-10; la ruta de prueba no expuesta en producción está cubierta por prueba (`gateway.spec.ts:83`).
- `docs/dev/progress/2026-10-10_audit_F4_2.md` (intento anterior) se deja intacta.
