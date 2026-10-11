# Auditoría F4 — #1
- Fecha: 2026-10-10 · Commit auditado: 2ff90eb · Veredicto: RECHAZADO

Auditoría de código (flujo-cierre.md). GW-10 (Render) fuera de alcance. Clon `C:\Proyectos\fp-audit` en `b9ca735` (sobre 2ff90eb solo cambian `AGENTS.md` y la bitácora dev F4 #2).

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ |
| Pruebas de seguridad | ✘ |
| Checklist de cierre | ✔ (alcance de código) |
| Conformidad con el contrato | ✔ |

Comandos ejecutados en el clon: `prisma:generate`, `npm run lint`, `npm run build -w @flight-platform/api-gateway`, `npm audit --audit-level=high` (exit 0, solo moderadas), `npx jest platform/api-gateway --runInBand` (2 suites, 11/11), `npx jest packages/shared --runInBand` (11/11). Las pruebas pasan; los hallazgos son tareas o pruebas que no cubren lo que el plan pide.

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | GW-09 (y GW-03) | `platform/api-gateway/src/app.ts:48-61`; `grep grpc` en `src/` (sin `*.spec.ts`) solo da `grpc-clients.ts`, `errors.ts`, `config.ts` | La ruta de prueba no atraviesa ningún gRPC falso ni mapea un error gRPC a `ProblemDetails`; ninguna prueba usa un gRPC falso. No existe propagación de `X-Correlation-Id` a gRPC |
| H2 | GW-06 | `app.ts:64-74`; `errors.ts:20` (`problemFromGrpc` sin uso fuera de `gateway.spec.ts:42`) | No existe filtro de excepciones. El manejador global convierte todo error (excepto 413) en 400 `VALIDATION_FAILED`: `GET /flights/v1/unknown-path` ⇒ 400 con `invalidParams` (sonda ejecutada en el clon); un error con status 500 también sale 400. `UNAVAILABLE` ⇒ 503 solo se verifica sobre la función aislada |
| H3 | GW-SEC-04 | `app.ts:21` (`logger: false`); `gateway.spec.ts:43`; `grep redact\|pino\|Logger` en `src/` sin resultados | No hay logging ni redacción de campos sensibles (PLAN §2.4, §2.5 «Log de una operación con PII»). La prueba S «error forzado ⇒ `ProblemDetails` genérico» solo llama `problemFor('unexpected')`; no fuerza un error en la app |
| H4 | GW-04, GW-SEC-01, GW-SEC-02 | `app.ts:50-51,53-60`; `src/` solo contiene `auth.ts` (funciones) e `idempotency.ts` | No existen `IdempotencyInterceptor`, `JwtAuthGuard`, `RolesGuard`, `ScopesGuard` ni decoradores `@Public()`, `@Roles`, `@Scopes`. La autenticación, los roles y la idempotencia se invocan en línea solo dentro de la ruta de `NODE_ENV=test`; no hay denegación por defecto aplicada a las rutas. Ninguna prueba cubre por HTTP el replay, el 422 por cuerpo distinto ni el 409 + `Retry-After` |

## Observaciones (no bloquean → BACKLOG)
- Incidente: la bitácora dev F4 #2 documenta lectura de `infra/.env` para obtener una credencial. Según el humano, ya se rotó la contraseña y se agregó la regla en `AGENTS.md`; se registra aquí.
- `app.ts:67`: respuestas 404/405 de rutas desconocidas salen como 400 (observado en la sonda).
- `errors.ts:10,24`: `problemFor` puede emitir `code` `NOT_FOUND` o `INTERNAL_ERROR`, fuera del enum de `ProblemDetails.code` del OpenAPI (hoy no alcanzable desde ninguna ruta).
- `prisma-idempotency.ts:10-20`: `expiresAt` se guarda pero no se consulta (TTL sin efecto).
- GW-05: límite por cabecera `Authorization` completa en lugar de `sub`; límite autenticado sin prueba; mapa en memoria sin purga (`app.ts:34-43`). `@nestjs/throttler`, `@nestjs/schedule`, `nestjs-pino` están declarados y sin uso.
- GW-02: `VALIDATE_RESPONSES` es verdadero por defecto en cualquier entorno (`config.ts:42`); el plan lo exige en desarrollo y pruebas.
- `npm audit` reporta 20 vulnerabilidades moderadas (cadena jest/sprintf-js); no superan el umbral `high`.
- Checklist: «ruta de prueba no expuesta en producción» se cumple por código (`app.ts:46`, `NODE_ENV === 'test'`); no hay prueba que lo afirme. Render/HTTPS/HSTS en producción diferidos a GW-10.
