# Auditoría F4 — #2
- Fecha: 2026-10-10 · Commit auditado: a4e2168 · Veredicto: RECHAZADO

Auditoría de código (flujo-cierre.md). GW-10 (Render) fuera de alcance. Clon `C:\Proyectos\fp-audit` en `a4e2168`, árbol limpio. Commit indicado por el humano; la bitácora dev F4 #3 figura `en curso`.

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✘ |
| Pruebas de seguridad | ✘ |
| Checklist de cierre | ✘ |
| Conformidad con el contrato | ✘ |

Comandos en el clon: `prisma:generate`, `build -w shared`, `npm run lint` (exit 0), `npm run build -w @flight-platform/api-gateway` (exit 0), `npm audit --audit-level=high` (exit 0, 20 moderadas), `npx jest platform/api-gateway --runInBand` (2 suites, 7/7), `npx jest packages/shared --runInBand` (11/11). Las pruebas existentes pasan. Verificación de H1–H4 de audit-1: H1 resuelto (gRPC real y metadata en `gateway.spec.ts:47-51`); H2 resuelto salvo H5 de este informe; H4 resuelto salvo lo indicado en H1 de este informe; H3 de audit-1 sigue sin resolverse (ver H3 de este informe).

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | GW-SEC-01 | `gateway.spec.ts:42-45` (única prueba de la tarea) | La prueba S exige 401 por sin token, firma inválida, expirado, `alg: none` y emisor no listado; solo existe el caso sin token. Ninguna prueba cubre los otros cuatro |
| H2 | GW-SEC-03 | `grep -nE "413\|orwarded\|rigin" platform/api-gateway/src/*.spec.ts` ⇒ sin resultados | No existe prueba de origen CORS no permitido, cuerpo de 200 kB ⇒ 413 ni `X-Forwarded-Proto: http` rechazado |
| H3 | GW-SEC-04 (PLAN §2.5 «Error interno forzado», «Log … PII») | `gateway.spec.ts:76` (`problemFor('unexpected')`); bitácora dev F4 #3, checklist: «falta aserción automatizada» | La prueba S no fuerza un error en la app, solo llama a una función. No hay prueba del Gateway que verifique logs redactados (el único test de redacción es `packages/shared/test/shared.spec.ts:145`, del logger compartido) |
| H4 | GW-02 | `grep -n invalidParams platform/api-gateway/src/*.spec.ts` ⇒ sin resultados | La prueba K «request inválido ⇒ 400 `VALIDATION_FAILED` con `invalidParams`» no existe; ninguna prueba envía una petición inválida a una ruta del contrato |
| H5 | GW-06 / PLAN §1.3 GAP-031 | `errors.ts:27`, `web-errors.ts:31`; `gateway.spec.ts:73` | Servicio interno caído (`UNAVAILABLE`/`DEADLINE_EXCEEDED`) responde 503 con `code: VALIDATION_FAILED` y `Retry-After: 1`; el plan exige 503 `RATE_LIMIT_EXCEEDED` + `Retry-After: 5`. La prueba solo verifica status 503 y presencia de `Retry-After` |
| H6 | GW-06 | `gateway.spec.ts:68-78` | La prueba U «cada `code` produce su status» no existe: solo se verifican `UNAVAILABLE`, 404, 405 y `problemFor('unexpected')`; ningún `code` del catálogo (§1.4) se prueba contra su status |
| H7 | GW-07 | `gateway.spec.ts:86` | La prueba U «configuración por variable» invoca `configuredGrpcTargets(true, {})` con entorno vacío y solo comprueba `tls`; ninguna prueba fija una URL mediante variable de entorno |

## Observaciones (no bloquean → BACKLOG)
- Incidente: la bitácora dev F4 #2 documenta lectura de `infra/.env` para obtener una credencial; la bitácora dev F4 #3 documenta que Prisma cargó `platform/api-gateway/.env` al ejecutar el build. Según el humano, la contraseña fue rotada y se agregó la regla en `AGENTS.md`.
- Procedimiento: la última bitácora del developer (F4 #3) está `en curso` y declara «Cambios sin commit», aunque `a4e2168` contiene esos cambios; se audita ese commit por indicación expresa del humano. Build del workspace, audit, clon limpio y smoke de imagen Docker figuran como no ejecutados por el developer; el smoke Docker no se ejecutó en esta auditoría.
- Sondeo ad hoc en el clon (archivo temporal eliminado): firma inválida, expirado, `alg: none`, emisor no listado ⇒ 401; origen no permitido sin `Access-Control-Allow-Origin`; 200 kB ⇒ 413; `X-Forwarded-Proto: http` ⇒ 400; petición inválida a `/search` ⇒ 400 con `invalidParams`; HSTS presente; `X-Correlation-Id` presente en 401, 400 y 404. El comportamiento coincide con lo pedido; lo que falta son las pruebas (H1, H2, H4).
- GW-03: la prueba verifica `X-Correlation-Id` solo en `/health` (`gateway.spec.ts:82`), no «toda respuesta».
- `docs/dev/progress/2026-10-10_audit_F4_2.md` (sin seguimiento en git) es de un intento anterior detenido de esta auditoría; no se modificó.
- `RateLimitGuard`: mapa en memoria sin purga (`security.ts:55`). `@nestjs/throttler` y `@nestjs/schedule` declarados sin uso.
- Los 404/405/500 salen con `code: VALIDATION_FAILED` según ADR-F4-03; no contradice un valor de §1.
- `npm audit` reporta 20 vulnerabilidades moderadas; no superan el umbral `high`.
- Checklist: «ruta de prueba no expuesta en producción» verificada por prueba (`gateway.spec.ts:89-93`). Render/HTTPS/HSTS en producción diferidos a GW-10.
