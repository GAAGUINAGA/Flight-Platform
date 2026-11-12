# Sesión dev — F12c-backend-previo — 2026-11-11 #1
- Agente: developer · Inicio: — · Commit inicial: 1c61b6f (rama `feat/F12c-backend-previo`, desde main con el diseño F12c-0 fusionado)
## Objetivo de la sesión
B-1 (canal de pago WEB), B-2 (API interna de administración `/api/admin/v1`) y Q13 (citas del ADR renombrado). Diseño: `docs/dev/f12c0-diseno-front.md` §5, §12, §14 y `ADR-F12c-01-front-graphql-react.md`. Decisiones del humano: Q11, Q12, Q13 (ver el encargo). Fuera: puerta de embarque (H-6), salud del bus (H-8), precalentamiento.
## Estado inicial
Dependencias de PLAN §5.1: n/a (entrega fuera de las fases del plan). Pruebas existentes del gateway (`npx jest platform/api-gateway/src`) y de reservation al iniciar: en verde (ver registro final).
## Registro
| Hora | Tarea | Acción | Resultado de la prueba |
|------|-------|--------|------------------------|
| — | B-1 Gateway | `v2/web-sales.ts` (canal por rol, interruptor, correo confirmado, topes, marca de prueba, aviso al arrancar); `auth.ts` (`emailVerified` desde el claim `email_verified` de nivel superior); `config.ts` (`web`); `GatewayProblemError.problemType` y `buildV2Problem` (tipo propio, `code` dentro del enum v2); `booking.controller.ts` y `postsale.controller.ts`; `state.ts` (`countWebPassengersSince`, `listWebBookings`) | `npx jest platform/api-gateway/src/v2/web-sales.spec.ts`: 24/24 (WEB-CH-01…07, WEB-LIM-01…06, WEB-PS-01…03, WEB-WARN-01) |
| — | B-1 Reservation | `web-payments.ts` (`WebPaymentVerifier`, `WEB_PAYMENT_MODE`), `main.ts`, enum Zod `paymentChannel` = `BOOKING`/`WEB`; sin `.proto` ni migración | `npx jest microservices/reservation-service/test/f12c-web-payments.spec.ts`: 7/7 (RSV-WEB-01…07) |
| — | B-1 despliegue | `deploy-reservation.yml` (`WEB_PAYMENT_MODE=simulated` en `extra_env_vars`), `.env.example` del gateway, guía `docs/dev/f12c-backend-previo-despliegue.md`, `scripts/ci/check-deploy-env.cjs` (reservation + variables de Render del gateway), hook de Supabase con `email_verified` | `node scripts/ci/check-deploy-env.cjs`: OK |
| — | B-2 | `contracts/openapi/interno/admin-v1.yaml`, `admin-api.ts` (controlador + validación OpenAPI interna con autenticación antes de validar), `openapi-path.ts`, `app.ts`; `isV2Path` incluye el prefijo | `npx jest platform/api-gateway/src/admin-api.spec.ts`: 28/28 (ADM-API-01…12, ISO-01…04) |
| — | B-1/B-2 reales | `test/e2e/v2/web-channel.e2e.spec.ts` (servicios reales vía ESB) y `stack.ts` con el verificador WEB | `RUN_GATEWAY_REAL=true GATEWAY_TRANSPORT=esb npx jest platform/api-gateway/test/e2e/v2/web-channel.e2e.spec.ts`: 7/7 (WEB-E2E-01…06, ADM-E2E-01) |
| — | Q13 | Citas `ADR-F12c-01` → `ADR-F12b2fix-02` en `booking-payments.ts`, su prueba y `docs/dev/f12a-despliegue.md`; `BACKLOG.md` | n/a |
| — | Regresión | `npm run lint` (eslint, verify-workspace-dist, check-raw-sql, check-deploy-env), `npm run audit:policy`, builds de `api-gateway` y `reservation-service` (tsc) | 0 errores |
| — | Regresión | `npx jest platform/api-gateway/src --runInBand` | 20 suites, 298/298 |
| — | Regresión | `npx jest microservices/reservation-service/test --runInBand --testPathIgnorePatterns=integration` | 29 suites, 202/202 (incluye `f12c-web-payments`) |
| — | Regresión | `RUN_RSV12_REAL=true RUN_PST_REAL=true RUN_PST_SMOKE_REAL=true npx jest microservices/reservation-service/test/integration/rsv-12-real.spec.ts --runInBand` (tras `prisma generate` de los servicios) | 19/19 |
| — | Regresión | `RUN_GATEWAY_REAL=true GATEWAY_TRANSPORT=esb npx jest platform/api-gateway/test/e2e --runInBand` (incluye los 19 archivos de v2 con Ajv contra el contrato v2) | 19 suites, 634 pasan + 1 todo |
## ADRs creados
- `ADR-F12c-02-canal-web-y-api-admin-interna` (diseño corto de B-1 y B-2).
## Desviaciones y avisos para el humano
- **El gateway no tiene workflow de despliegue** (va a Render; solo existe `gateway-ci.yml`). Las variables del canal WEB del gateway se declararon en `platform/api-gateway/.env.example` y en la guía de despliegue, y `check-deploy-env.cjs` las verifica ahí. `WEB_PAYMENT_MODE=simulated` sí quedó en el workflow de **reservation** (`extra_env_vars`): habilita la capacidad en Reservation; **quien decide vender es el Gateway** (sin la variable en Render no se vende).
- **Hook de Supabase (humano):** hay que volver a ejecutar `docs/dev/f11a-supabase-auth-hook.sql` (agrega el claim `email_verified`) y renovar sesiones. Hasta entonces la web no puede reservar (falla cerrado, 403 `email-not-verified`). No hay migraciones de base de datos ni cambios de `.proto`.
- Los rechazos del canal WEB usan `code` del enum de `ProblemDetails` v2 y un `type` propio (`web-payments-disabled`, `email-not-verified`, `web-active-bookings-limit`, `web-passengers-per-day-limit`) para no tocar el contrato v2 con Booking.
- Se agregó `GET /api/admin/v1/web-bookings` (solo lectura) para cumplir «visibles como de prueba para el administrador»; no estaba en la lista de operaciones de Q12.
- `/flights/v1/admin/*` no se retiró (v1 sigue existiendo); solo se marcó como deprecado en `docs/dev/admin-routes.md`.
- No se leyó ningún `.env`; las pruebas que cargan `.env` de un servicio lo hacen internamente (dotenv, sin imprimir).
## Verificación posterior al commit 09f94ab
- Clon limpio `C:\Proyectosp-clean-f12c-backend-previo` (fuera de la carpeta temporal; borrar al terminar) en `09f94ab`: `npm ci`; pasos de `gateway-ci.yml` (prisma generate, lint, build shared/contracts/api-gateway, audit:policy, `jest platform/api-gateway/src`: 20 suites, 298/298) y de `deploy-reservation.yml` (prisma generate, build, `jest reservation/test` sin integración: 29 suites, 202/202, audit:policy): todo en verde.
- Imágenes Docker construidas en el clon: reservation con `PORT=8080`: humo de arranque OK y health gRPC `SERVING` desde el contenedor (y `UNAUTHENTICATED` sin llave); gateway con `PORT=8080`: `GET /flights/v1/health` 200 y `GET /api/admin/v1/flights` sin token 401 `UNAUTHORIZED` (el OpenAPI interno viaja en la imagen). Ambos avisan del estado de `WEB_PAYMENT_MODE` al arrancar.
- Suites reales de reservation (`RUN_RSV12_REAL`, `RUN_PST_REAL`, `RUN_PST_SMOKE_REAL`) dos veces seguidas sobre el commit: 19/19 y 19/19.
- Suite real del gateway (`RUN_GATEWAY_REAL=true GATEWAY_TRANSPORT=esb`, carpeta e2e completa): una corrida previa al commit en verde (19 suites, 634 + 1 todo; `web-channel` aparte 7/7). **La corrida final sobre el commit (1.ª de las 2 seguidas) fue detenida por el sistema por falta de memoria; no se repitió.**
## Pendientes / bloqueos
- Repetir dos veces seguidas la suite real del gateway sobre `09f94ab` (no se reinició sola: el sistema estaba corto de memoria).
- El contenedor detenido `fp-rsv-health` no se pudo borrar desde esta sesión (`docker rm fp-rsv-health`).
## Corrección 1 (tras la suite real completa del humano sobre 09f94ab)
El humano corrió la suite real completa del gateway dos veces: 956 pruebas, 954 en verde, 1 todo y 1 falla repetida (la corrida de 634 era parcial): `v2-state.integration.spec.ts › V2-STATE-01`, porque `findBooking` ahora devuelve `createdAt` (agregado para el tope de pasajeros por día del canal WEB) y la prueba comparaba con `toEqual` exacto.
- V2-STATE-01 actualizada sin debilitarla: `createdAt` debe ser una `Date` válida y cercana al guardado (holgura de 5 s por reloj app/base) y el resto de la reserva coincide exactamente con lo guardado.
- `createdAt` del estado no sale hacia los clientes de v2: `WEB-CREATED-01` (unitaria, fecha de estado distinta a la de Reservation: ni el detalle ni la lista la contienen; el `createdAt` visible es el de Reservation, que el contrato ya trae) y `WEB-E2E-01` ampliada (GET de la reserva y lista validados con Ajv contra el contrato v2: `expectV2Response`).
- Revisión de igualdades exactas sobre registros del estado de v2: solo V2-STATE-01 comparaba el registro completo; las demás comparan `salesChannel`/`passengerMap`/campos sueltos, sin cambios.
- Hook de Supabase (`docs/dev/f11a-supabase-auth-hook.sql`): solo la consulta a `auth.users` va en un bloque `begin … exception when others then confirmed := false; end;`. Documentado en el comentario: ante un error el login sigue (app_role y scope como siempre) y solo la venta WEB queda bloqueada (falla cerrado). El humano debe volver a ejecutar el SQL.
- Pruebas: `web-sales.spec.ts` 25/25; `v2-state.integration.spec.ts` 9/9; `web-channel.e2e.spec.ts` (real) 7/7; `npm run lint` 0 errores; build de `api-gateway` sin errores. No se corrió la suite completa (la repite el humano).
- Estado: **en curso**; no se marca «listo para auditoría (código)» hasta que el humano repita la suite completa.

## Corrección 2 (audit-20, H1: topes WEB no atómicos) — en curso
H1 → reserva atómica del cupo antes de crear la reserva (contadores condicionales + registro por intento con vencimiento). Diseño: `ADR-F12c-03-topes-web-atomicos` (día UTC; en Ecuador el día se reinicia a las 19:00 hora local).
- Paso 1: migración aditiva `20261111120000_gateway_web_quota` (`"gateway"."v2_web_quota"` y `"gateway"."v2_web_quota_claim"`, esquema explícito) y modelos en `schema.prisma`. El humano la aplicó en su base local (migrate status al día).
- Paso 2 (código): `web-sales.ts` (`takeWebQuota`, `webDayBucket`; reemplaza `assertWithinWebLimits`), `state.ts` (`claimWebQuota`/`confirmWebQuota`/`releaseWebQuota`/`releaseWebActive`/`reconcileWebActive` en el almacén en memoria y en Prisma con `UPDATE … WHERE used + n <= tope RETURNING`; se quita `countWebPassengersSince`), `booking.controller.ts` (cupo antes de crear; se devuelve ante cualquier error; se confirma al crear), `cancellation.ts` (libera la activa), `config.ts` (`WEB_QUOTA_CLAIM_TTL_SECONDS`=300), `.env.example`, guía de despliegue y `check-deploy-env.cjs`.
- Recuperación: cupo `PENDING` con vencimiento (se devuelve al siguiente intento del dueño) y recálculo desde Reservation al llegar al tope de activas. Cancelación: libera «activas»; los pasajeros del día cuentan aunque se cancele.
- **H1 → qué cambié → prueba:** la comprobación y la creación ya no son separadas: el cupo se toma atómicamente antes → `web-sales.spec.ts` WEB-RACE-01 (2, 3 y 8 POST simultáneos, holds y claves distintos: pasan solo los que caben y Reservation recibe solo esos), WEB-RACE-02 (pasajeros/día), WEB-RACE-03 (dueños), WEB-RACE-04/05 (devolución si falla), WEB-RACE-06/07 (recuperación), WEB-RACE-08/09 (idempotencia), WEB-LIM-01/02 (cancelación y día), WEB-LIM-07 (recálculo); y en Postgres real `test/integration/web-quota.integration.spec.ts` WEBQ-DB-01…09 (12 peticiones simultáneas contra tope de 3, etc.).
- Resultados: `web-sales.spec.ts` 38/38; `web-quota.integration.spec.ts` 11/11 y `v2-state.integration.spec.ts` 9/9 (Postgres local); `npx jest platform/api-gateway/src` 20 suites, 312/312; WEB-E2E-01 (`web-channel.e2e.spec.ts`, real, ESB) 7/7; suite real de reservation (`rsv-12-real`, una vez) 19/19; `npm run lint` (eslint, dist, check-raw-sql, check-deploy-env) 0 errores; `npm run audit:policy` OK; build (tsc) del api-gateway sin errores. **No se corrió la suite real completa del gateway** (la repite el humano).
- Estado: **en curso**. La marca el humano como lista para auditoría tras repetir la suite completa.

## Corrección 3 (audit-21: H1, H2, H3 — rediseño de los topes) — en curso
Causa común de H1-H3: el Gateway mantenía un contador propio de algo que vive en Reservation. Decisión del humano: no parchear; el dueño de los datos aplica el tope. Diseño: `ADR-F12c-03` (reescrito).
- **Qué cambié:** (1) Reservation aplica los topes WEB en la misma transacción corta que inserta la reserva (`PrismaReservationStore.create(reserva, límites)`: `pg_advisory_xact_lock` por dueño, conteo desde las reservas reales —activas = WEB no CANCELLED/FAILED; pasajeros del día UTC = de las WEB creadas hoy, aunque se cancelen, sin las FAILED— e inserción solo si caben); el candado no abarca la saga. (2) Los topes viajan como datos de la petición: `.proto` aditivo (`web_max_active_bookings = 8`, `web_max_passengers_per_day = 9`; `packages/contracts` regenerado), Zod del controlador, y dos códigos internos en `shared` (`WEB_ACTIVE_LIMIT_EXCEEDED`, `WEB_PASSENGERS_LIMIT_EXCEEDED`, RESOURCE_EXHAUSTED; la prueba del catálogo los lista como internos). (3) El Gateway elimina su contador: tablas y modelos (`v2_web_quota`, `v2_web_quota_claim`), código de toma/devolución/vencimiento/recálculo, `WEB_QUOTA_CLAIM_TTL_SECONDS`, `countWebPassengersSince`, y **se borra del repositorio la migración `20261111120000_gateway_web_quota`** (el humano deshace la suya local); solo envía los topes y traduce los dos códigos a 429 `RATE_LIMIT_EXCEEDED` con el mismo `type`. (4) ADR-F12c-03 actualizado; guía de despliegue con el orden Reservation → Gateway.
- **H1 → prueba:** ya no hay vencimiento ni confirmación forzada que sumar: la reserva en curso es una fila real que cuenta. `RSV-WEBLIM-02` (tope 1, 6 simultáneas ×5 rondas: nunca 2 activas), `RSV-WEBLIM-01` (2, 5 y 10 simultáneas con tope 3), `RSV-WEBLIM-03` (pasajeros/día).
- **H2 → prueba:** no existe recálculo ni contador que pisar; el conteo es de las reservas reales bajo el candado del dueño. Mismas pruebas de carrera + `RSV-WEBLIM-04` (el candado es por dueño: uno retenido no bloquea a otro dueño y sí al suyo).
- **H3 → prueba:** una respuesta perdida no devuelve nada (no hay qué devolver): `RSV-WEBLIM-08` (reintento con la misma clave desde instancias distintas: una sola reserva y sin chocar con el tope) y `RSV-WEBLIM-07` (error tras insertar, reserva en TICKET_ISSUING: sigue ocupando lugar). `RSV-WEBLIM-06`: una reserva que falla del todo (FAILED) libera su lugar. En el Gateway: `WEB-LIM-04` y `WEB-LIM-04b`.
- Cancelación: `RSV-WEBLIM-05` (libera activas, los pasajeros del día siguen contando) y `RSV-WEBLIM-U2`. Canal BOOKING sin topes: `RSV-WEBLIM-09`, `RSV-WEBLIM-U3`, `WEB-LIM-01`.
- **Verificación por mutación:** quitando temporalmente el `pg_advisory_xact_lock`, `RSV-WEBLIM-02` deja pasar las 6 con tope 1 y `RSV-WEBLIM-04` falla; con el candado, 11/11 (la mutación se revirtió; no queda rastro en el código).
- **Resultados:** `f12c-web-limits-postgres.spec.ts` 11/11 (Postgres local); `f12c-web-limits.spec.ts` (unit) 6/6; reservation sin integración 30 suites, 208/208; `rsv-11-postgres` + `reservation-owner-prisma` junto a la nueva 18/18; `web-sales.spec.ts` 26/26; `jest packages/shared platform/api-gateway/src` 23 suites, 343/343; WEB-E2E-01…06 (`web-channel.e2e.spec.ts`, real, vía ESB, Reservation y Postgres reales; WEB-E2E-03 con tope 2 ⇒ 429 con tipo propio) 7/7; suite real de reservation (`rsv-12-real`, una vez) 19/19; `npm run lint` (eslint, dist, check-raw-sql, check-deploy-env) 0 errores; `npm run audit:policy` OK; builds (tsc) de shared, contracts, api-gateway y reservation-service sin errores. **No se corrió la suite real completa del gateway** (la repite el humano).
- Aviso: Reservation importa los códigos nuevos de `@flight-platform/shared` y el `.proto` cambió (aditivo): ESB y los servicios que usan `shared` deben reconstruirse al desplegar (orden Reservation/ESB → Gateway).
- Estado: **en curso**; lo marca el humano como listo para auditoría tras repetir la suite completa.

## Cierre
- Commit final de código: 7e88d51 · Estado: listo para auditoría (código) · Marcado por el humano tras repetir la suite real completa del gateway dos veces (ver "Verificaciones del humano (corrección de audit-20)").


## Verificaciones del humano
| Hora | Tarea | Acción | Resultado |
|---|---|---|---|
| 16:00 | Decisiones | Q11 (canal WEB con interruptor explícito, topes, correo confirmado y reservas marcadas como de prueba), Q12 (/api/admin/v1 con OpenAPI interno separado del contrato con Booking) y Q13 aprobadas antes del código. Desviaciones 1 a 5 aceptadas (incluido GET /api/admin/v1/web-bookings, de solo lectura). | Decidido |
| 16:00 | Primera verificación | La suite real completa del gateway tenía 956 pruebas (la corrida del developer, 634, era parcial) y falló V2-STATE-01: findBooking devolvía el createdAt interno nuevo. Corregido en a069b9b sin debilitar la prueba (createdAt verificado), con WEB-CREATED-01 (no sale hacia los clientes) y Ajv en WEB-E2E-01. | Corregido |
| 16:00 | Hook de Supabase | Permiso comprobado (supabase_auth_admin puede leer auth.users: true; la función no es security definer; anon no puede ejecutarla). Hook con la consulta del correo protegida (ante un error, email_verified = false y el login sigue). Aplicado en Supabase: inicio de sesión OK para customer y admin, con app_role y scope sin cambios y el claim email_verified. | ✓ |
| 16:00 | Alcance | `git diff main`: gateway, reservation, OpenAPI interno nuevo, WEB_PAYMENT_MODE en deploy-reservation.yml, docs; sin cambios en el contrato v2, los .proto ni las migraciones. | ✓ |
| 16:00 | Pruebas | Lint, audit-policy, check-deploy-env, suite real del gateway (GATEWAY_TRANSPORT=esb) dos veces seguidas completa y suites reales de reservation, sobre a069b9b. | ✓ Sin fallos; un único todo (OP-02). |
| 16:00 | Imágenes | reservation y gateway: image-startup-smoke.sh en verde. | ✓ |


## Verificaciones del humano (corrección de audit-20)
| Hora | Tarea | Acción | Resultado |
|---|---|---|---|
| 20:03 | Decisión | H1 de audit-20 (topes saltables con peticiones simultáneas): solución decidida por el humano, cupo tomado con una sola sentencia atómica antes de crear la reserva, devuelto si falla, con vencimiento ante una interrupción, sin candados retenidos durante la creación. Tope diario por día UTC (ADR-F12c-03; en Ecuador se reinicia a las 19:00 hora local). | Decidido |
| 20:03| Migración | 20261111120000_gateway_web_quota revisada (solo aditiva, calificada con "gateway"; check-raw-sql y prisma validate OK) y aplicada en la base local. | ✓ |
| 20:03 | Alcance | Desde a069b9b: web-sales, controlador de reservas, estado v2, schema.prisma y migración del gateway, pruebas (WEB-LIM-01..04 reescritas con la misma intención), .env.example, guía, ADR-F12c-03 y check-deploy-env. Sin cambios en el contrato v2 ni en los .proto. | ✓ |
| 20:03 | Pruebas | Lint, audit-policy, check-deploy-env, la carrera contra Postgres real, la suite real completa del gateway (GATEWAY_TRANSPORT=esb) dos veces seguidas y la suite real de reservation, sobre 7e88d51. | ✓ Sin fallos; un único todo (OP-02). |
| 20:03 | Imagen | gateway: image-startup-smoke.sh en verde. | ✓ |



## Verificaciones del humano (corrección de audit-21)
| Hora | Tarea | Acción | Resultado |
|---|---|---|---|
|  22:36  | Decisión | H1 a H3 de audit-21 nacían de un contador del gateway sobre algo que vive en Reservation. Decisión del humano: rediseño, el tope lo aplica Reservation en la misma transacción corta que inserta la reserva (pg_advisory_xact_lock por dueño, conteo desde las reservas reales); el gateway elimina su contador (ADR-F12c-03). | Decidido |
|  22:36 | Base local | Deshecha la migración 20261111120000_gateway_web_quota (borrada del repositorio, nunca aplicada en Supabase): tablas gateway.v2_web_quota y v2_web_quota_claim y su registro en _prisma_migrations eliminados; migrate status del gateway up to date. | ✓ |
| 22:36 | Alcance | Desde 7e88d51: reservation (inserción con candado y pruebas), gateway (sin contador), shared (dos códigos internos), .proto con dos campos opcionales nuevos (sin líneas eliminadas), ADR-F12c-03 y guía. Sin migraciones respecto de main ni cambios en el contrato v2. | ✓ |
| 22:36 | Pruebas | Lint, audit-policy, check-deploy-env, CI de todos los workflows, la carrera de los topes en Reservation contra Postgres real, la suite real completa del gateway (GATEWAY_TRANSPORT=esb) dos veces seguidas y la suite real de reservation, sobre 59ca115. | ✓ Sin fallos; un único todo (OP-02). |
| 22:36 | Imágenes | reservation y gateway: image-startup-smoke.sh en verde. | ✓ |
## Decisión del humano tras tres rechazos consecutivos (PLAN §4.4)
| Hora | Decisión | Motivo |
|---|---|---|
| 23:37 | Se continúa con una corrección acotada de H1 de audit-22, sin cambiar el diseño ni el alcance. | Los tres rechazos no son el mismo problema: audit-20 (carrera de los topes), audit-21 (desincronización del contador, que llevó al rediseño) y audit-22 (Reservation falla abierto si el canal WEB llega sin topes). El rediseño resolvió de raíz los hallazgos de audit-21; la corrección es fallar cerrado, sin decisiones abiertas. |

## Corrección 4 (audit-22 H1: Reservation falla abierto sin topes) — en curso
| Hora | Tarea | Acción | Resultado |
|---|---|---|---|
| 23:45 | H1 | `CreateReservation`: con canal WEB, si falta cualquiera de `webMaxActiveBookings`/`webMaxPassengersPerDay` o no es entero positivo, rechaza con VALIDATION_FAILED (INVALID_ARGUMENT) como primera acción (antes de leer, insertar o verificar el pago) y registra un error de configuración faltante sin datos personales. BOOKING no cambia. | ✓ |
| 23:45 | Otros caminos | `store.create` solo se llama desde `CreateReservation.create`; la reanudación de pendientes solo actualiza reservas ya insertadas; ninguna otra RPC inserta reservas. No hay otra vía abierta. | ✓ |
| 23:45 | Gateway | `loadConfig` no arranca con topes inválidos (WEB-LIM-05); `assertWebPaymentsEnabled` además rechaza (422 web-payments-disabled) si la configuración llega con topes inválidos (WEB-LIM-05b). Topes ausentes toman su valor por omisión documentado (5/10); el aviso de arranque de WEB_PAYMENT_MODE no cambia. | ✓ |
| 23:45 | Pruebas | Nuevas RSV-WEBLIM-U7 (sin topes, uno solo, 0, negativos, decimal, NaN, Infinity, texto, null: rechazada, 0 inserciones, 0 llamadas al pago) y U8 (BOOKING sin topes funciona; reintento idempotente WEB sin topes tampoco devuelve nada); U3 pasó de "WEB sin topes no se aplican" a "falla cerrado". `f12c-web-payments.spec.ts` RSV-WEB-06 ahora envía topes (su petición WEB no los llevaba). | ✓ |
| 23:45 | Verificación | reservation sin integración 30 suites 210/210; carrera RSV-WEBLIM contra Postgres + owner-prisma 14/14; shared + gateway src 23 suites 344/344; suite real de reservation (rsv-12-real) 19/19; lint, audit-policy, check-deploy-env, builds tsc de reservation y gateway OK. Suite completa del gateway no ejecutada (la repite el humano). | ✓ |


## Verificaciones del humano (corrección de audit-22)
| Hora | Tarea | Acción | Resultado |
|---|---|---|---|
| 0:00 | Decisión | Reservation falla cerrado si el canal WEB llega sin topes o con topes inválidos (rechazo antes de leer, insertar o tocar el pago). Aceptados los topes por omisión del gateway (5 activas y 10 pasajeros por día, valores de diseño documentados); la venta sigue gobernada por WEB_PAYMENT_MODE sin valor por omisión. | Decidido |
| 0:00| Alcance | Desde 59ca115: reservation (validación y pruebas RSV-WEBLIM-U7/U8; RSV-WEBLIM-U3 y RSV-WEB-06 ajustadas por la corrección), gateway (validación de topes, WEB-LIM-05b) y ADR-F12c-03. Sin migraciones ni líneas eliminadas en los .proto. | ✓ |
| 0:00| Pruebas | Lint, audit-policy, check-deploy-env, las pruebas de los topes (fallar cerrado y carrera contra Postgres real), la suite real completa del gateway (GATEWAY_TRANSPORT=esb) dos veces seguidas y la suite real de reservation, sobre 5191e54. | ✓ Sin fallos; un único todo (OP-02). |
