# Auditoría F12 — #2
- Fecha: 2026-10-28 · Commit auditado: 730eaeb (rama `feat/F12a2-pre-despliegue`; código `aef769c` + `1942b21`) · Veredicto: APROBADO
## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ |
| Pruebas de seguridad | ✔ |
| Checklist de cierre | ✔ |
| Conformidad con el contrato | ✔ |

Detalle (checkout `C:\Proyectos\fp-audit`, Postgres local, dos corridas seguidas con resultado idéntico, sin omitidas salvo el `it.todo` de OP-02):

| Comando | Resultado |
|---|---|
| `npm run lint` · `node scripts/audit-policy.cjs` | exit 0 · exit 0 |
| `RUN_GATEWAY_REAL=true npx jest platform/api-gateway --runInBand` ×2 | 32 suites, 766 passed, 1 todo |
| `npx jest microservices/pricing-service --runInBand` ×2 (incluye PRC-12) | 11 suites, 49 passed; PRC-12 también aislada: 1 passed |
| `npx jest microservices/inventory-service --runInBand` ×2 | 8 suites, 83 passed |
| `RUN_DCS_REAL=true npx jest microservices/operations-service --runInBand` ×2 | 20 suites, 84 passed |
| `RUN_RSV12_REAL RUN_PST_REAL RUN_PST_SMOKE_REAL` reservation ×2 | 32 suites, 213 passed |
| Clon limpio `C:\Proyectos\fp-audit-clean-f12a2` (730eaeb): `npm ci`, lint, `audit:policy`, build de shared y contracts, `gen:contracts` (sin cambios en el árbol), `prisma generate` y build de los siete servicios y del gateway | todo exit 0 |
| Pruebas de cada workflow en el clon limpio | gateway-ci 12 suites 181 passed · inventory 26 · pricing 31 · ticketing 18 · webhooks 40 · ancillaries 23 · reservation 178 · operations 63 (ver observación 3) |

Revisión de código y contrato:
- C: respuestas de búsqueda v2 validadas con Ajv contra `vuelos-openapi-v2.yaml` (`c-multi-offers`, V2-C-01…08) y v1 contra `SearchResponse` (`real-stack.e2e.spec.ts:258`); límite y orden en `search-offers.ts:32-34,46-66` con C-01…C-10; vuelos sin capacidad excluidos (C-07); cada oferta guardada y retenible/reservable (C-10, V2-C-06). PRC-12 conserva las aserciones de capacidad (antes = después) y solo cambia la selección de la oferta.
- D: `prisma-check-in.ts:53-60` cuenta pares únicos reserva+pasajero; V2-D-02/02b (repetir check-in y reemitir pase no cuentan doble) y V2-D-04 (sin cabina excluido) pasan; `CountCheckedIn` exige rol admin y valida con Zod; la migración es aditiva (columna nullable e índice).
- B: V2-B-05 comprueba que las cuatro cabeceras no aparecen en los logs; V2-B-01…04 (401/403 antes que 422) y V2-B-06…08 pasan. La excepción de `BOOKING_EVENTS_CLIENT_ID` depende solo de `NODE_ENV === 'test'` (`config.ts:78`) y con `production`, `development` o sin definir la configuración se niega a cargar.
- E: sin dirección de Booking ni llave en el código (`git grep`); el dev-auth en producción solo lee `DEV_AUTH_PRIVATE_KEY` y rechaza `DEV_AUTH_PRIVATE_KEY_FILE` (`config.ts:84`, `dev-auth.ts:63-64`); V2-E-01…12 pasan. `docs/dev/f12a-despliegue.md` coincide con el código (variables, las ocho migraciones existentes, servicios y scripts `dev-auth:client`, pruebas de CI de pricing y operations).
- Credenciales: `git grep` de la contraseña anterior de `svc_gateway`, de URLs de Postgres con contraseña y de claves en claro no encuentra ninguna en el árbol actual; `platform/api-gateway/.env.supabase.example` solo tiene marcadores.
- `.proto`: solo cambios aditivos (RPC y mensajes de `CountCheckedIn`). `contracts/openapi/` sin cambios. v1 sin cambios salvo la búsqueda con varias ofertas.
- No repetido por instrucción: `docker build` y arranque de contenedores (verificados por el humano según la bitácora del developer).
## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
## Observaciones (no bloquean → BACKLOG)
1. C (límite por tramo): `search-offers.ts:50-55` recorta cada tramo a `SEARCH_MAX_OFFERS` antes de combinar. Reproducción (script local, no commiteado): multidestino UIO-GYE + GYE-UIO el mismo día; tramo 1: FP1 (50.00, llega 23:00), FP2 (60.00, llega 22:00), FP3 (300.00, llega 09:00); tramo 2: FP11 (sale 10:00). Con `maxOffers=10` ⇒ 1 oferta (FP3+FP11, 390.00); con `maxOffers=2` y `maxOffers=1` ⇒ `totalOffers: 0`, aunque FP3+FP11 es válida. Es consecuencia del límite por tramo descrito en ADR-F12a2-01 (que admite devolver menos de N ofertas), pero aquí devuelve cero habiendo una combinación válida. Con el valor por defecto (10) y fechas distintas por tramo no se manifiesta.
2. D: los bebés reciben pase con el asiento del adulto (`check-in.ts:73-77`) y `countCheckedIn` los cuenta como pasajeros; el panel acota con `Math.min(checkedIn, sold)` (`operations.controller.ts`), de modo que CHECKED_IN puede incluir bebés sin asiento propio. No hay prueba con bebés.
3. Clon limpio: en la primera corrida de `npx jest platform/api-gateway/src --runInBand` tras el build hubo 1 prueba fallida (180 passed, 1 failed) que no pude identificar; cuatro corridas posteriores del mismo comando dieron 181 passed. No reproducido.
4. PRC-12: se eliminó `expect(searched.offers).toHaveLength(1)`, consecuencia del cambio aprobado; las aserciones de capacidad se mantienen.
5. B: las pruebas de la excepción `NODE_ENV=test` cubren `production`, `development` y sin definir, pero no fijan el caso `test` en sí.
6. Pendiente aceptado por el humano (ya en BACKLOG): en las demás rutas v2, sin token y con cuerpo inválido responde 400 en lugar de 401.
7. Un primer intento de CI en el clon limpio se interrumpió por falta de memoria del equipo (lint con exit=66); repetido por partes, todo exit 0. No es un defecto del código.
- Clon a borrar: `C:\Proyectos\fp-audit-clean-f12a2`.
