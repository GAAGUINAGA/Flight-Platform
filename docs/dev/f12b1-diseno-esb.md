# F12b-1 — Diseño del ESB y su enrutador (Bloque 0)

- Estado: **APROBADO (D-1 a D-4). D-4 (corregida): defensa en profundidad. El ESB confía en la identidad del gateway autenticado con la llave interna (sin llave ⇒ 401 antes de la mediación) y además verifica el rol en las operaciones administrativas y de sistema (rol insuficiente ⇒ PERMISSION_DENIED, igual que el microservicio). Roles = los que hoy exige cada servicio (ADR-F12b-02). Stock de Booking en el gateway: excepción aprobada hasta F12b-3 (ADR-F12b-03).**
- Fecha: 2026-10-31 · Rama: `feat/F12b1-esb` · Base: `0dd0bb0`
- Fuentes: `docs/plan/PLAN_F12b.md`, `docs/plan/PLAN_F12_v2.md`, código del Gateway en `platform/api-gateway/src`.

## 1. Hallazgo clave del inventario

Todo acceso del Gateway a los microservicios pasa por **una sola función**: `callGatewayGrpc(config, service, method, request, correlationId, auth?)` en `src/grpc-clients.ts`. Solo hay **tres excepciones** que abren gRPC por otra vía:

| Excepción | Dónde | Qué hace | Tratamiento propuesto |
|---|---|---|---|
| Health v2 | `v2/health.controller.ts` (`probe`) | Sondea `grpc.health.v1.Health/Check` de los 7 servicios | Pasa al ESB: operación `sistema.salud` (el ESB sondea y devuelve los 7). El Gateway conserva el cálculo `HEALTHY/DEGRADED/DOWN`, caché y formato. |
| `configuredGrpcTargets` | `grpc-clients.ts` | Solo lista destinos (no abre conexión); se usa en config/arranque | Se conserva solo para `GATEWAY_TRANSPORT=grpc`. |
| `GatewayTestGrpcClient` | `src/test-grpc.ts` + `v2/test-controller.ts` | Cliente a un servidor gRPC **falso de pruebas** (`GATEWAY_TEST_GRPC_URL`) | Solo existe con el controlador de pruebas habilitado; no es tráfico a microservicios. La prueba "sin gRPC" lo excluye (ver §8, decisión D-2). |

Por tanto el cambio de transporte es **un punto de inserción** (`callGatewayGrpc` despacha según `GATEWAY_TRANSPORT`), sin tocar los ~30 controladores/servicios que lo llaman. Esto es lo que permite cumplir "ninguna aserción cambia".

## 2. Inventario de llamadas (44 métodos gRPC en uso; corrección del conteo inicial de 46, verificada contra el catálogo al implementar)

Quién las usa: **v1** = `/flights/v1/*`, **v2** = `/api/v2/vuelos/*`, **adm** = rutas admin, **sch** = scheduler, **stk** = sincronización de stock con Booking, **evt** = emisión de eventos de v2.

| Servicio | Método gRPC | Usado por (archivo) |
|---|---|---|
| inventory | upsertFlightInstance, listFlightInstances, closeFlightInstance | adm v1 (`admin.controller`) |
| inventory | findFlightInstance, listCabinOccupancy | v2 (`v2/operations.controller`) |
| inventory | getFlightInstance, queryAvailability | stk (`v2/stock/stock-sync`, rol system) |
| inventory | expireHolds | sch |
| pricing | searchOffers | v1 (`shopping`), v2 (`v2/shopping`) |
| pricing | resolveSegment | v1, v2 (mapa de asientos) |
| pricing | holdOffer, getOfferHold, releaseOfferHold | v1 (`hold`), v2 (`v2/hold`, `v2/booking` preflight) |
| pricing | upsertFare, listFares | adm v1 |
| ancillaries | getSeatMapForOffer | v1, v2 |
| ancillaries | changeSeats | v2 (`v2/postsale`) |
| reservation | createReservation, getReservation, listReservations | v1 (`booking`), v2 (`v2/booking`, `v2/postsale`, `v2/cancellation`) |
| reservation | resumeReservation, failReservation | v2 (`v2/booking`, `v2/booking-events`) |
| reservation | getBaggageOptions, addBaggage, searchDateChange, confirmDateChange | v1 (`post-sale`), v2 (`v2/postsale`) |
| reservation | getCancellationQuote, cancelReservation | v1, v2 |
| reservation | getStoredCancellationQuote, quoteCancellation | v2 (`v2/cancellation`) |
| reservation | listReservationsByFlightInstance | v2 (`v2/operations`, admin/system) |
| reservation | resumePending | sch |
| ticketing | listTickets, getTicket | v1 (`booking`) |
| operations | checkIn, listBoardingPasses, getFlightStatus | v1 (`operations`), v2 (`v2/postsale`, `v2/shopping`, `v2/operations`) |
| operations | recordOperationalUpdate | adm v1, v2 (`v2/operations`) |
| operations | countCheckedIn | v2 (`v2/operations`) |
| operations | recoverCheckIns | sch |
| webhooks | listSubscriptions, createSubscription, deleteSubscription | v1 (`webhooks`), v2 (`v2/webhooks`) |
| webhooks | listEvents | v2 (`v2/webhooks`, feed) |
| webhooks | publishEvent | evt (`v2/events`) |
| webhooks | dispatchPending | sch |

Identidad que viaja hoy (metadatos gRPC, `createGrpcMetadata`): `x-internal-key`, `x-correlation-id`, `x-owner-id`, `x-role`. Plazo: 5 000 ms por defecto (`GRPC_DEADLINE_MS`); 30 000 ms (`GATEWAY_ORCHESTRATION_DEADLINE_MS`) para `createReservation`, `addBaggage`, `confirmDateChange` y `cancelReservation`. El canal se abre y se cierra en cada llamada.

## 3. Composiciones que hoy hace el Gateway

| # | Composición | Llamadas | ¿Mezcla estado/forma propios del Gateway? |
|---|---|---|---|
| C1 | Mapa de asientos v1 y v2 | `pricing.resolveSegment` → `ancillaries.getSeatMapForOffer` | No (solo la traducción `NOT_FOUND`→404 del primer paso; v2 además remapea la forma, que es del Gateway) |
| C2 | Cancelación v2 (`V2Cancellation`) | `getReservation` → `getStored/quote/getCancellationQuote` → `cancelReservation` | **Sí**: `V2StateStore`, `StockSync`, `bookingLinks`, ventana de exoneración, `Date.now()` |
| C3 | Crear reserva v2 | `getOfferHold` (preflight) → `createReservation` → `getReservation` | **Sí**: `V2StateStore`, `StockSync`, reglas de pasajeros, `Idempotency-Key` del Gateway |
| C4 | Emitir boletos v2 | `getReservation` → `resumeReservation` | **Sí**: forma v2 y `_links` |
| C5 | Cambio de fecha v2 | `getReservation` → `confirmDateChange` | Sí: forma v2 |
| C6 | Hold v1/v2 con verificación | `getOfferHold` → decisión → `releaseOfferHold` / `holdOffer` | Sí: reglas v2 de estado/expiración |
| C7 | Eventos de Booking (`v2/booking-events`) | `getReservation` / `resumeReservation` / `failReservation` | Sí: autenticación de socio, dedupe en BD del Gateway |
| C8 | Stock a Booking (`stock-sync`) | `inventory.getFlightInstance` → `inventory.queryAvailability` | Sí: outbox del Gateway y llamada HTTP a Booking |
| C9 | Health v2 | 7 sondeos gRPC en paralelo | Cálculo de estado y caché del Gateway |

**Propuesta (decisión D-1):** en F12b-1 solo se mueve al ESB lo que es **orquestación pura de microservicios sin estado ni forma del Gateway**: **C1** (`vuelos.mapa-asientos`) y el sondeo de **C9** (`sistema.salud`). C2–C8 **permanecen en el Gateway**, cada paso como una operación con nombre del ESB, porque entrelazan `V2StateStore`, `StockSync`, idempotencia y formas v2 que son del Gateway; moverlas duplicaría o arrastraría esa lógica y violaría "no se duplica lógica / ninguna aserción cambia". La orquestación real de esos flujos es F12b-3 (sagas).

C1 conserva el comportamiento actual: si `resolveSegment` falla con `NOT_FOUND`, el ESB responde el error con `step: "resolveSegment"`, de modo que el Gateway sigue produciendo exactamente el mismo 404 de v2 (`NOT_FOUND` del paso 1 → problema "Oferta o segmento no encontrado"; `NOT_FOUND` del paso 2 → como hoy).

## 4. Contrato HTTP interno Gateway → ESB

**Endpoint:** `POST {ESB_URL}/internal/v1/operations/{operation}` (JSON, UTF-8). `{operation}` = `<dominio>.<operación>`.

**Cabeceras de petición**

| Cabecera | Obligatoria | Contenido |
|---|---|---|
| `X-Internal-Key` | sí | Llave interna actual (`INTERNAL_API_KEY`), comparada en tiempo constante. Falta o difiere → 401. |
| `X-Correlation-Id` | sí | El del Gateway (o `gateway-scheduler`). Se propaga a gRPC (`x-correlation-id`) y se devuelve en la respuesta. |
| `X-Owner-Id`, `X-Role` | no | La misma identidad que hoy viaja en metadatos gRPC; el ESB la reenvía sin interpretarla (ADR-F12b-09). |
| `Idempotency-Key` | no | Si el Gateway la tiene, se reenvía y se registra solo su huella (hash corto). Hoy la clave de idempotencia ya viaja dentro del `input` donde el servicio la usa; la cabecera es informativa para F12b-3. |
| `X-Deadline-Ms` | no | Plazo total pedido por el Gateway (5 000 por defecto; 30 000 en las 4 operaciones orquestadas). El ESB lo acota a `ESB_MAX_DEADLINE_MS` (por defecto 30 000) y lo usa como deadline gRPC. |

**Cuerpo:** `{ "input": { ... } }` — `input` es exactamente el mensaje que hoy se envía por gRPC. El ESB valida el sobre con Zod (`input` objeto, tamaño máximo `ESB_MAX_BODY_BYTES`, 1 MB por defecto); el contenido de `input` lo valida el microservicio dueño (no se duplica su esquema).

**Respuesta correcta:** `200 {"ok":true,"result":<mensaje gRPC>,"correlationId":"…"}`.

**Respuesta de error:** `{"ok":false,"error":{"source":"service"|"esb","grpcCode":<int>,"grpcStatus":"NOT_FOUND","catalogCode":"SEAT_TAKEN"|null,"step":"…"?},"correlationId":"…"}`. Sin mensajes internos ni trazas.

| Situación | HTTP del ESB | `grpcCode` | `source` |
|---|---|---|---|
| Error de dominio del servicio (cualquier código gRPC no listado abajo) | 422 | el del servicio | service |
| Servicio caído / `UNAVAILABLE` | 503 | 14 | service |
| Plazo vencido | 504 | 4 | service o esb |
| `NOT_FOUND`, `PERMISSION_DENIED`, `UNAUTHENTICATED` del servicio | 404 / 403 / 401 respectivos del servicio, marcados `source: service` | 5 / 7 / 16 | service |
| Llave interna ausente o errónea | 401 | 16 | esb |
| Operación inexistente | 404 | 12 (`UNIMPLEMENTED`) | esb |
| Sobre inválido | 400 | 3 | esb |
| Falla interna del ESB | 500 | 13 | esb |

`catalogCode` es el `details` de gRPC (código del catálogo: `SEAT_TAKEN`, `AMOUNT_MISMATCH`, …) tal cual lo devolvió el servicio.

**Cómo conserva el Gateway su traducción sin cambios:** el cliente HTTP del Gateway reconstruye un error con `code` = `grpcCode` (número) y `details` = `catalogCode`. Es la misma forma que `asProblem`/`problemFromGrpc`/`v2ProblemFromError` leen hoy, así que el mapeo a HTTP y a problem+json no cambia. Reglas de transporte del lado del Gateway:

- ESB inaccesible, rechazo de conexión o plazo agotado en el Gateway → error con `code` 14 (`UNAVAILABLE`) o 4 (`DEADLINE_EXCEEDED`) ⇒ **503 con `Retry-After`** y el código del catálogo vigente (el mismo camino que hoy cuando cae un servicio).
- `source: "esb"` con 401/404/400/500 (configuración errónea del propio ESB) → `code` 13 (`INTERNAL`): 500 genérico, con log sin secretos. Un 401 del ESB **no** se traduce a 401 para el cliente (no es culpa suya).

**Plazo en el Gateway:** `AbortController` a `deadline + 1 000 ms` (margen para que el ESB responda su propio 504 primero).

## 5. Catálogo de operaciones con nombre (`<dominio>.<operación>`)

Dominios del contrato: **vuelos, reservas, postventa, clientes** y **sistema**. Cada operación mapea 1:1 a un método gRPC (excepto las dos compuestas, marcadas ★). Las operaciones de gestión llevan además el rol exigido (`requireRole`), que el ESB verifica con `X-Role` además de lo que ya hace el Gateway (defensa en profundidad; el microservicio sigue siendo la autoridad). Rol vacío = el ESB no restringe (lo decide el servicio por propietario).

| Operación | Servicio.método | Rol en el ESB |
|---|---|---|
| **vuelos** | | |
| `vuelos.buscar-ofertas` | pricing.searchOffers | — |
| `vuelos.mapa-asientos` ★ | pricing.resolveSegment → ancillaries.getSeatMapForOffer | — |
| `vuelos.crear-hold` | pricing.holdOffer | — |
| `vuelos.consultar-hold` | pricing.getOfferHold | — |
| `vuelos.liberar-hold` | pricing.releaseOfferHold | — |
| `vuelos.estado-vuelo` | operations.getFlightStatus | — |
| `vuelos.buscar-instancia` | inventory.findFlightInstance | admin/system |
| `vuelos.ocupacion-cabinas` | inventory.listCabinOccupancy | admin/system |
| `vuelos.obtener-instancia` | inventory.getFlightInstance | system |
| `vuelos.consultar-disponibilidad` | inventory.queryAvailability | system |
| `vuelos.guardar-instancia` | inventory.upsertFlightInstance | admin |
| `vuelos.listar-instancias` | inventory.listFlightInstances | admin |
| `vuelos.cerrar-instancia` | inventory.closeFlightInstance | admin |
| `vuelos.guardar-tarifa` | pricing.upsertFare | admin |
| `vuelos.listar-tarifas` | pricing.listFares | admin |
| `vuelos.registrar-novedad-operativa` | operations.recordOperationalUpdate | admin |
| `vuelos.contar-check-ins` | operations.countCheckedIn | admin/system |
| **reservas** | | |
| `reservas.crear` | reservation.createReservation (plazo 30 s) | — |
| `reservas.obtener` | reservation.getReservation | — |
| `reservas.listar` | reservation.listReservations | — |
| `reservas.reanudar` | reservation.resumeReservation | — |
| `reservas.fallar` | reservation.failReservation | — |
| `reservas.listar-por-vuelo` | reservation.listReservationsByFlightInstance | admin/system |
| `reservas.listar-boletos` | ticketing.listTickets | — |
| `reservas.obtener-boleto` | ticketing.getTicket | — |
| **postventa** | | |
| `postventa.opciones-equipaje` | reservation.getBaggageOptions | — |
| `postventa.agregar-equipaje` | reservation.addBaggage (plazo 30 s) | — |
| `postventa.buscar-cambio-fecha` | reservation.searchDateChange | — |
| `postventa.confirmar-cambio-fecha` | reservation.confirmDateChange (plazo 30 s) | — |
| `postventa.cotizar-cancelacion` | reservation.getCancellationQuote | — |
| `postventa.cotizacion-guardada` | reservation.getStoredCancellationQuote | — |
| `postventa.cotizar-cancelacion-exonerada` | reservation.quoteCancellation | — |
| `postventa.cancelar` | reservation.cancelReservation (plazo 30 s) | — |
| `postventa.cambiar-asientos` | ancillaries.changeSeats | — |
| `postventa.check-in` | operations.checkIn | — |
| `postventa.listar-pases` | operations.listBoardingPasses | — |
| **clientes** | | |
| `clientes.listar-suscripciones` | webhooks.listSubscriptions | — |
| `clientes.crear-suscripcion` | webhooks.createSubscription | — |
| `clientes.eliminar-suscripcion` | webhooks.deleteSubscription | — |
| `clientes.listar-eventos` | webhooks.listEvents | — |
| `clientes.publicar-evento` | webhooks.publishEvent | system |
| **sistema** | | |
| `sistema.expirar-holds` | inventory.expireHolds | system |
| `sistema.reanudar-pendientes` | reservation.resumePending | system |
| `sistema.despachar-webhooks` | webhooks.dispatchPending | system |
| `sistema.recuperar-check-ins` | operations.recoverCheckIns | system |
| `sistema.salud` ★ | grpc.health.v1.Health/Check de los 7 servicios | — (solo llave interna) |

Total: 44 operaciones gRPC + 2 compuestas = 46 (el 46/48 inicial era un error de conteo; la lista de la tabla es la correcta). Una prueba del ESB comprobará que **cada método de los `.proto` usado por el Gateway tiene exactamente una operación** (evita que el catálogo se desfase) y que no hay nombres repetidos.

*Roles (por confirmar en implementación):* los roles marcados son los que hoy ya exigen las rutas que los invocan. Si algún servicio acepta un rol adicional que el Gateway sí emite (p. ej. `partner` en eventos de Booking), la operación queda sin restricción de rol en el ESB. Nunca se endurece más de lo que hoy acepta el servicio.

## 6. Arquitectura del ESB (resumen para los bloques A–E)

- NestJS en `microservices/esb-service`, hexagonal: `domain/` (catálogo de operaciones, errores, política de plazos; sin Nest ni gRPC), `application/` (caso de uso `ExecuteOperation`, puertos `ServiceInvoker`, `HealthProbe`), `infrastructure/` (controlador HTTP interno, invocador gRPC con los clientes **movidos** desde el Gateway —`createGrpcClient` de `@flight-platform/shared` + carga de `contracts/proto`—, Zod del sobre, logger de operación).
- Escucha en `PORT` (8080 en contenedor; local 3100). Health: `GET /health` (sin llave, solo vivo) y `GET /health/deps` (con llave, vía `sistema.salud`). Sin base de datos.
- Un log JSON por operación: `{operation, domain, outcome, grpcCode, catalogCode, latencyMs, correlationId}`. Sin `input`, sin PII, sin secretos (preparado para la telemetría de F12d).
- Clientes gRPC: se crean una vez por servicio y se reutilizan (el Gateway hoy abre/cierra uno por llamada); se cierran en `onModuleDestroy`.
- Variables: `INTERNAL_API_KEY`, `GRPC_TLS`, `<SERVICIO>_GRPC_URL` ×7, `ESB_MAX_DEADLINE_MS=30000`, `ESB_DEFAULT_DEADLINE_MS=5000`, `ESB_MAX_BODY_BYTES=1048576`, `PORT`. Ninguna se fija en código.
- Gateway: `callGatewayGrpc` (misma firma) despacha por `GATEWAY_TRANSPORT`: `esb` (por defecto) → `EsbClient` HTTP; `grpc` → implementación actual intacta. Con `esb` no se importa ni se carga ningún cliente gRPC a microservicios (prueba que lo comprueba).
- Local: `ESB` se agrega a `common.ps1`/`up.ps1`/`down.ps1`/`health.cjs` en el puerto 3100; el Gateway recibe `ESB_URL=http://127.0.0.1:3100` y `GATEWAY_TRANSPORT=esb`. Las pruebas reales levantan el ESB en proceso dentro de `stack.ts`/`real-stack` (solo arranque, sin tocar aserciones).
- CI/despliegue: `deploy-esb.yml` con el mismo patrón que `deploy-service.yml` (lint, build, `npm audit --audit-level=high`, pruebas unitarias); Dockerfile multi-stage; `.env.example`.

## 7. ADRs propuestos (se crearán en `docs/dev/adr/` al aprobarse)

### ADR-F12b-01 — ESB propio NestJS en tres capas
- Estado: Propuesto · Fecha: 2026-10-31 · Fase: F12b-1
- **Contexto:** la arquitectura del curso exige una capa ESB entre el gateway y los microservicios. Hoy el Gateway conoce a los siete servicios y los llama por gRPC.
- **Decisión:** `esb-service` (NestJS, Cloud Run) con tres capas: *conectividad* (endpoint HTTP interno de operaciones con nombre), *mediación* (enrutador; orquestador en F12b-3) e *integración externa* (Booking, F12b-3). La mediación se organiza en los dominios del contrato: vuelos, reservas, postventa, clientes y sistema. En F12b-1 solo hay enrutador, `vuelos.mapa-asientos` y `sistema.salud` como operaciones compuestas.
- **Consecuencias:** los clientes gRPC salen del Gateway. Las composiciones con estado propio (C2–C8) permanecen en el Gateway hasta las sagas de F12b-3. Un salto de red más por llamada; se mide en la nube (bloque E).

### ADR-F12b-02 — Contrato HTTP interno Gateway→ESB
- Estado: Propuesto · Fecha: 2026-10-31 · Fase: F12b-1
- **Contexto:** el Gateway debe conservar su traducción de errores a HTTP sin cambios.
- **Decisión:** `POST /internal/v1/operations/{dominio.operación}` con llave interna, `X-Correlation-Id`, identidad, `Idempotency-Key` y `X-Deadline-Ms`; cuerpo `{input}`; respuesta `{ok,result}` o `{ok:false,error:{source,grpcCode,grpcStatus,catalogCode,step?}}`. El Gateway reconstruye errores con `code` numérico y `details` = código del catálogo (§4).
- **Consecuencias:** `asProblem`/`problemFromGrpc`/`v2ProblemFromError` no cambian. Una caída del ESB produce 503 + `Retry-After`, igual que la caída de un servicio. El ESB no valida el contenido de `input` (lo valida el servicio dueño).

### ADR-F12b-03 — Vuelta atrás `GATEWAY_TRANSPORT=esb|grpc`
- Estado: Propuesto · Fecha: 2026-10-31 · Fase: F12b-1
- **Decisión:** variable de entorno con valor por defecto `esb`; `grpc` conserva el código actual. Valores distintos de ambos hacen fallar el arranque (no se asume un valor). Se retira al cerrar F12b-3.
- **Consecuencias:** hasta F12b-3 se mantienen dos caminos de transporte; las suites reales se ejecutan con ambos (dos veces `esb`, una `grpc`).

### ADR-F12b-09 — Autenticación entre servicios sin cambios
- Estado: Propuesto · Fecha: 2026-10-31 · Fase: F12b-1
- **Decisión:** el Gateway→ESB usa la misma llave interna; la identidad (`ownerId`, `role`) y la correlación se reenvían tal cual del ESB a los servicios por metadatos gRPC. El ESB no emite ni transforma identidades. ESB→servicios sigue con la llave interna y TLS en nube.
- **Consecuencias:** como Render llega al ESB por internet, el ingreso del ESB en Cloud Run es público y se protege únicamente con la llave interna (comparación en tiempo constante, sin rate limit propio en esta entrega). La mejora (identidad de servicio de Google, ID tokens) queda para después de F12.

## 8. Decisiones que necesito de ti

1. **D-1 (§3):** ¿apruebas que solo C1 (mapa de asientos) y el sondeo de salud pasen al ESB como compuestas, y que C2–C8 sigan en el Gateway (pasos individuales por el ESB)? *Recomendado: sí.*
2. **D-2 (§1):** `GatewayTestGrpcClient` (servidor falso de pruebas, solo con el controlador de pruebas) queda fuera de la regla "sin gRPC". *Recomendado: sí.*
3. **D-3 (§6):** puerto local del ESB 3100 y clientes gRPC reutilizados (en lugar de abrir/cerrar por llamada). *Recomendado: sí.*
4. **D-4 (§5):** el ESB verifica el rol en las operaciones administrativas/de sistema indicadas, como defensa en profundidad. *Recomendado: sí.*

**Cambios fuera de alcance que NO necesito:** el diseño no requiere tocar otros microservicios, `contracts/` ni `packages/`. Si durante la implementación se necesitara una utilidad en `packages/shared` te aviso antes.
