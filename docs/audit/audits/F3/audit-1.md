# Auditoría F3 — #1
- Fecha: 2026-10-07 · Commit auditado: aa78837 · Veredicto: RECHAZADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas (`npx jest microservices/webhooks-service --runInBand` → 4 suites, 13/13; `npx jest packages/shared --runInBand` → 11/11) | ✘ |
| Pruebas de seguridad (WHK-SEC-01..05) | ✔ |
| Checklist de cierre (entrega firmada, reintentos, SSRF y secreto; smoke Cloud Run excluido por flujo-cierre) | ✘ |
| Conformidad con el contrato | ✔ |
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | WHK-05 (Q-018) | `src/application/webhook-use-cases.ts:14` (`terminal = attempts >= backoffMinutes.length`); `test/integration/webhooks.spec.ts:63` | Q-018 define 6 reintentos (1, 5, 15, 60, 180, 720 min); la entrega pasa a FAILED en el 6.º intento total y el backoff de 720 min nunca se programa (la prueba espera `FAILED, attempts: 6` en la iteración de 720). Solo ocurren 5 reintentos. |
| H2 | WHK-04 | `test/unit/webhook-use-cases.spec.ts:13` y `test/integration/webhooks.spec.ts` | La prueba pedida (I: sin suscriptores ⇒ 0 entregas; con 2 ⇒ 2) no existe: no hay caso de 0 entregas en ninguna suite, y el caso de 2 corre solo en una suite unitaria con store en memoria; la suite de integración contra Postgres publica con una sola suscripción. |
## Observaciones (no bloquean → BACKLOG)
- `FetchHttpPoster` (`src/infrastructure/clients/fetch-http-poster.ts:3`) usa `fetch` con redirecciones por defecto; la URL se valida antes del envío pero no la del destino de un redirect.
- `WebhookUrlPolicy.privateIp` (`src/infrastructure/security/webhook-security.ts:8`) no cubre `0.0.0.0`, `100.64.0.0/10` ni IPv4 mapeada en IPv6 (`::ffff:`).
- Entregas reclamadas quedan en `PROCESSING` sin salida si el proceso cae o si la suscripción ya no existe/está inactiva (`webhook-use-cases.ts:14`).
- `secret` es opcional en `CreateSubscription` (el contrato lo exige) y el secreto generado nunca se devuelve en claro al suscriptor.
- WHK-06: el validador del cuerpo en `webhooks.spec.ts:17-24` es manual y no comprueba tipos de cada campo ni formato `date-time`.
- §2.5: la prueba de llave solo cubre ausencia de `x-internal-key` en el servicio; la llave incorrecta solo se prueba en `packages/shared`.
- WHK-SEC-01: no hay prueba que cubra la revalidación antes de cada envío ni la resolución DNS.
- Las pruebas de F3 requieren `prisma generate` y build de `@flight-platform/shared` previos (pasos del workflow); sin ellos las 4 suites fallan al resolver módulos.
- `npm audit --audit-level=high` sale con código 0 (solo hallazgos moderados en cadena de Jest).
- La imagen Docker se construyó (`fp-audit-webhooks:aa78837`) y se lanzó con `PORT=8080`, pero el health gRPC desde el contenedor no pudo comprobarse en esta sesión (permiso denegado para los comandos docker/grpcurl posteriores); el contenedor `fp-audit-whk` quedó en ejecución.
