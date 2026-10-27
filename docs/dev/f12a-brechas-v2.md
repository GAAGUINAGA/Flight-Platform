# F12a · Bloque 0 — Matriz de brechas contrato v2 ↔ implementación

- Rama: `feat/F12a-contrato-v2` · Base: `fefbb06` · Fecha: 2026-10-26 · Estado: **aprobado por el humano con las decisiones de la sección «Decisiones del humano» (prevalecen sobre el resto del documento)**
- Fuentes leídas: `PLAN_F12_v2.md` §1–5, `vuelos-openapi-v2.yaml` completo, `vuelos-openapi.yaml` (diff programático de esquemas y respuestas), los siete `.proto`, el Gateway (`platform/api-gateway/src`), y el código de Reservation, Webhooks, Operations y Ancillaries que decide cada brecha.
- No se escribió código ni se tocó ningún contrato.

## Decisiones del humano (2026-10-26; prevalecen sobre las propuestas de abajo)

### Alcance: la prueba del martes 19h30 con Booking es 100 % local
Booking integra en local por Tailscale (IPs 100.x.x.x), http y gRPC sin TLS, de servidor a servidor. El despliegue en la nube de F12a es posterior al martes. Todo se construye con configuración de producción por defecto; existe un perfil «integración local» activado solo por variables explícitas (`INTEGRATION_LOCAL=true`), nunca por defecto y rechazado al arrancar con `NODE_ENV=production`:
- gateway en `0.0.0.0`; microservicios solo en `127.0.0.1` en este perfil;
- stock por gRPC a dirección configurable, TLS desactivable;
- política de URLs de webhooks: http y `100.64.0.0/10` solo en este perfil;
- emisor del dev-auth y URLs públicas (`issuer`, `_links`) desde una variable de URL base pública.
Entregables adicionales: scripts de levantar/detener la plataforma local con health final, guía de preparación de la reunión, lista de verificación de la reunión y colección Postman v2 con entorno «integración local».

### Decisiones
| ID | Resolución |
|---|---|
| D1 | Aprobado. Recursos con token de partner: dueño `<clientId>~<X-User-Id>`. Suscripciones de webhooks: dueño `<clientId>`; Webhooks entrega a la suscripción del cliente todos los eventos de recursos `<clientId>~*`. Pruebas: no suplantar a un usuario de Supabase; un cliente no recibe eventos de otro. |
| D2 | Aprobados los cambios aditivos en reservation-service y webhooks-service (202 `TICKET_ISSUING` con `bookingId`, publicación de `booking.ticket_issued`, almacén global de eventos para `GET /vuelos/eventos`), cada uno con ADR. `.proto` solo aditivo. |
| D3 | Opción A: `payment.failed` sobre reserva emitida anula boletos, libera asientos y capacidad, marca `FAILED`, publica el evento; sin reembolso; idempotente por id de evento. |
| D4 | **Reemplaza la propuesta de patrón.** `paymentReference` = texto no vacío de hasta 64 caracteres, sin patrón; mismo campo en reservas, maletas, asientos y cambio de fecha. Para `client_credentials` se verifica contra Booking `GET /pagos/{paymentReference}` (estado y monto) con un verificador HTTP nuevo en reservation-service (v1 conserva el suyo). Confirmado con monto y moneda iguales ⇒ continúa; monto distinto ⇒ 422 sin crear nada; pendiente ⇒ `PENDING_PAYMENT` (202) y el scheduler reverifica; fallido o inexistente ⇒ 422 pago no autorizado; sin respuesta en plazo corto configurable (dentro de 5 s) ⇒ 503 con `Retry-After`. Referencia única por operación. En `payment.confirmed`/`payment.failed`, `amount` y `currency` vienen siempre: se comparan con la reserva. |
| D5 | Aprobado: `SAGA_COMPENSATION` sin penalidad dentro de una ventana configurable; fuera, penalidad de la tarifa. Se documenta en la guía para Booking. |
| D6 | Aprobado: migraciones aditivas; se indica el servicio y el humano las aplica en local; en Supabase al desplegar. |
| Q3 | `departureGate` y `reason` del PATCH de estado de vuelo se guardan (campo aditivo en operations-service, con ADR) y viajan en `flight.status_changed` (parte de P6). |
| Q5 | `BAGGAGE_LIMIT_EXCEEDED` responde 422 solo en v2; v1 mantiene 409. Se registra en el ADR de la fachada v2. |
| Mapa de asientos | Para el martes solo los estados calculables (disponible y ocupado) con valores válidos del contrato; `HELD` por asiento y `BOARDED` pasan a F12b. |
| Emisión (5.4) | Sigue vigente el análisis de §4.2 y §4.4; las pruebas fijan el comportamiento observable para que F12b no lo cambie. |

### Lo que Booking aún no confirma (no se les pregunta antes de la reunión)
Todo queda **configurable por variables de entorno**, con valores por defecto seguros, probado contra simuladores locales y confirmado en la reunión: API de pagos (URL base, credencial, formato de respuesta y tabla única de mapeo de estados), `booking-events` (HMAC-SHA256 del cuerpo con secreto compartido y cabecera configurables; sin secreto rechaza todo; idempotente por id del CloudEvent; 202), stock por gRPC (dirección, TLS y `x-api-key`; sin llave se desactiva y se registra), webhooks hacia Booking (URL registrada por ellos; firma con el `secret` de la suscripción). La lista de verificación está en `docs/dev/f12a-reunion-booking.md`.

### Orden
P1 → cambios de Reservation y Webhooks (D1–D4) → P2 → P3 → P4 → P5 → P6 si alcanza. Lo que no alcance se registra como pendiente para informarlo a Booking al inicio de la reunión.

## 0. Resumen

v2 es un **superconjunto aditivo de v1**: todas las propiedades nuevas de los esquemas son opcionales, los enums solo crecen y los requeridos no cambian. Eso confirma que la fachada puede reutilizar los casos de uso actuales. Lo que **no** es traducción de forma y obliga a decidir:

| # | Brecha de fondo | Por qué importa |
|---|---|---|
| B1 | `FakePaymentVerifier` está cableado en producción (`reservation-service/src/main.ts:30`): solo acepta `pay_ok_*`, `pay_pending_*`…; cualquier otra referencia da `PAYMENT_REFERENCE_INVALID` | **Booking no podría crear ni una reserva** con `PAY-BKP-…` |
| B2 | Webhooks entrega solo a suscripciones con el mismo `ownerId` que el recurso; v2 define dueño = `X-User-Id` y la suscripción es del cliente OAuth | Ningún evento llegaría a Booking (es el mismo hallazgo de ADR-F11-18) |
| B3 | No existe almacén global de eventos (solo `delivery` por suscripción, con `event_id` UUID) | `GET /vuelos/eventos` no tiene de dónde leer, y el formato de entrega actual es v1 (`X-Flight-Signature`, JSON propio) |
| B4 | `payment.failed` ("liberar el hold y marcar `FAILED`") frente a la emisión dentro de `POST /bookings` | Es el único punto donde la decisión 5.4 no alcanza sola (ver §4) |
| B5 | El seatmap solo tiene `isAvailable`; Inventory cuenta por cabina, no por asiento | `status` por asiento, `HELD` y `BOARDED` no existen como dato |
| B6 | `/vuelos/booking-events` y `/oauth2/token` **no están en el contrato v2** (solo `tokenUrl: /oauth2/token` y el texto de §8) | Definimos nosotros ruta, auth y respuesta; hay que decírselo a Booking (pendiente 5.6.1) |

## 1. Decisiones que necesito de ti (resumidas; detalle en las secciones)

| ID | Decisión | Mi recomendación |
|---|---|---|
| D1 | Dueño de recursos con token de partner: `"<clientId>~<X-User-Id>"` en lugar de `X-User-Id` a secas (§2.2) | Aprobar: evita que un partner suplante el `sub` de un usuario de Supabase y enruta eventos |
| D2 | Autorizar cambios fuera del Gateway (lista en §6), por servicio y en este orden: reservation → webhooks → ancillaries → pricing → inventory | Aprobar M1–M5; sin M2(B1) y M1(B2/B3) la integración no funciona |
| D3 | Qué hacer con `payment.failed` sobre una reserva ya emitida (§4.3) | Opción A: revertir (anular boletos, liberar asientos, `FAILED`) con RPC aditivo de Reservation |
| D4 | Formato de `paymentReference` aceptado (§2.1, B1) | Patrón configurable `^PAY-[A-Z0-9-]{4,60}$` + unicidad; ¿es ese el formato real de Booking? |
| D5 | `SAGA_COMPENSATION` sin `quoteId` y sin penalidad (§3.P4) | RPC aditivo; si no hay tiempo, entra con la penalidad de la tarifa y se avisa a Booking |
| D6 | Migración del Gateway (tablas nuevas, §2.3) y de Webhooks (§6) | Las aplicas tú; te doy el SQL en cada bloque |

## 2. Transversales

### 2.1 Pagos (B1)
- `PaymentVerifier` real = formato (patrón por env `PAYMENT_REFERENCE_PATTERN`), **unicidad** (ya existe `findByPaymentReference`) y, si llega `payment.amount`, igualdad con el total congelado → `AMOUNT_MISMATCH` (422). Los prefijos `pay_ok_/pay_pending_/…` siguen funcionando igual para que v1 y sus pruebas no cambien.
- `PaymentReference` proto solo tiene `payment_reference`; el importe requiere campo aditivo `amount`. Sin él, `AMOUNT_MISMATCH` no se puede validar → alternativa gateway-only: comparar `payment.amount.total` con `hold.lockedPrice.total` (+ equipaje extra) antes de llamar. **Propongo esta alternativa** (cero cambios de proto): el Gateway ya lee el hold para las validaciones de pasajeros.

### 2.2 Identidad, dueño y roles
| Aspecto | Hoy | v2 | Propuesta |
|---|---|---|---|
| Emisor | Supabase (JWKS) y emisor local de desarrollo | + `dev-auth` | Nuevo emisor en `JWT_ISSUERS` verificado **en proceso** (sin autollamada HTTP), `app_role=partner`, `sub=clientId`, `scope` del contrato. Prohibido el emisor de desarrollo en producción (ya lo exige `config.ts`) |
| `POST /api/v2/oauth2/token` | no existe | `client_credentials` | `client_id`/`client_secret` por body form o Basic; secreto con scrypt; scopes solicitados ⊆ permitidos del cliente; `expires_in` 3600; respuestas RFC 6749 (`invalid_client`, `invalid_scope`) |
| JWKS | no existe | publicado | `GET /api/v2/.well-known/jwks.json` con `kid`; llave privada solo por env (`DEV_AUTH_PRIVATE_KEY`), nunca en el repo ni en logs; rotación = dos `kid` |
| Dueño del recurso | `sub` | `X-User-Id` si token de partner, si no `sub` | **D1**: `ownerId = "<clientId>~<X-User-Id>"`; sin `X-User-Id` → `clientId`. `X-User-Id` se ignora con tokens no partner. Longitud ≤ 128 (límite `rpcString`) → 400 si no cabe |
| Registro de clientes | — | secreto hasheado | Tabla `dev_auth_client` en la BD del Gateway (`client_id`, `secret_hash`, `scopes[]`, `active`, `created_at`) + script `dev-auth:create-client` que imprime el secreto **una vez** y guarda solo el hash |
| Scopes | `flights:read/hold/book/cancel/webhooks/admin` | + `flights:ops` | `PATCH status` y `GET operaciones/vuelos` exigen `flights:ops` **o** `flights:admin`; promociones `PUT` exige `flights:admin`; `GET` promociones `flights:read` |
| 401 vs 403 | 401 con código `VALIDATION_FAILED` (v1) | `UNAUTHORIZED` / `FORBIDDEN` | Filtro v2 propio; v1 intacto |

### 2.3 Estado propio del Gateway (migración del Gateway, tablas en su esquema)
`dev_auth_client`, `v2_booking` (booking_id, client_id, owner_id, hold_id, payment_reference, sales_channel jsonb), `promotion_agreement` (client_id PK + campos del contrato), `v2_processed_event` (id del evento de Booking → idempotencia de `booking-events`), `stock_outbox` (reintentos de P5).
`v2_booking` resuelve sin tocar Reservation: `holdId`, `paymentReference`, `salesChannel` en `BookingDetail`, `originalPaymentReference` del reembolso, dueño para `booking-events` y aislamiento entre partners. Se (re)inserta en cada replay idempotente, así que una caída entre Reservation y la tabla se repara con el reintento.

### 2.4 ProblemDetails, cabeceras, idempotencia, límites
| Tema | Brecha | Propuesta (Gateway) |
|---|---|---|
| ProblemDetails | v1 no tiene `instance/correlation_id/timestamp`; códigos nuevos; 503 usa `RATE_LIMIT_EXCEEDED` (rareza de v1) | Constructor v2 aparte (`type`, `title`, `status`, `detail`, `instance`, `code`, `correlation_id`, `timestamp`, `invalidParams`); `detail` nunca con valores de usuario ni internos. Mapa código→HTTP v2: `HOLD_EXPIRED` 410, `HOLD_ALREADY_CONSUMED` 409, `IDEMPOTENCY_KEY_REUSED` 409, `BOOKING_NOT_CANCELLABLE` 409, `INVALID_STATUS_TRANSITION` 409, `FLIGHT_CANCELLED` 409, `PROVIDER_UNAVAILABLE` 503, `INTERNAL_ERROR` 500, etc. |
| `X-Correlation-Id` | ya se devuelve (`randomUUID` si falta); v2 `maxLength: 100` | Truncar/rechazar >100 con 400; propagar a gRPC (ya existe) |
| `X-Request-Id` | no existe | Generar si falta y devolver siempre |
| `Idempotency-Key` | v1: UUID no validado; mismatch → 422 `VALIDATION_FAILED`; replay devuelve el mismo status (201) | v2: UUID v4 obligatorio (400), mismatch → **409 `IDEMPOTENCY_KEY_REUSED`**, replay → **200** + `Idempotent-Replayed: true`, retención 24 h (ya parametrizada). Interceptor v2 separado; el de v1 no se toca |
| Rate limit | 60/min público por fingerprint o IP, 120 autenticado | Igual; 429 con `RATE_LIMIT_EXCEEDED` + `Retry-After` en formato v2 |
| Validación de petición | `express-openapi-validator` solo sobre `/flights/v1` | Segunda instancia sobre `/api/v2` con el YAML v2 (`servers[0].url=/api/v2`). Dos excepciones que el contrato manda como 422 y el validador daría 400: `porcentaje_descuento_maximo` fuera de rango → `PROMOTION_DISCOUNT_OUT_OF_RANGE`; reglas de pasajeros (§3) |
| Validación de respuesta | Ajv solo en tests | Igual: las pruebas validan con Ajv+ajv-formats contra v2 (incluidos 4xx/5xx contra `ProblemDetails`) |

## 3. Matriz por operación

Leyenda de *Toca*: **GW** solo Gateway · **MS** requiere cambio aprobado fuera del Gateway (ref. en §6).

### P1 — Conexión y seguridad
| Operación | Brecha | Propuesta | Toca |
|---|---|---|---|
| `POST /oauth2/token` | No existe (B6) | §2.2 | GW + tabla |
| `GET /.well-known/jwks.json` | No existe | §2.2 | GW |
| `GET /vuelos/health` (público, <1 s) | No existe | `status` por `grpc.health.v1` de los 7 servicios en paralelo, tope 800 ms y caché 5 s (el cold start de Cloud Run no debe colgar al monitor): todos SERVING → `HEALTHY`; alguno caído pero Inventory+Pricing+Reservation arriba → `DEGRADED` (200); Inventory, Pricing o Reservation caídos → `DOWN` (503, mismo cuerpo). `nodo_id=NODE_VUE_GABATAIR` (env `NODE_ID`), `nombre_proveedor=GabatAIR`, `vertical=VUELOS`, `version=2.0.0`, `uptime_seconds`, `dependencias[]`, `circuit_breaker_estado=CLOSED` (no hay breaker aún; se declara en F12b). Opcionales `holds_activos_count`/`vuelos_programados_hoy`: se omiten en F12a (requieren RPC nuevo) | GW |

### P2 — Compra
| Operación | Brecha | Propuesta | Toca |
|---|---|---|---|
| `POST /search` | `X-Device-Fingerprint` obligatorio (400 si falta); `INFANT_WITHOUT_ADULT`/máx. 9 → 422; 503 con `PROVIDER_UNAVAILABLE` | Reutiliza `Pricing.SearchOffers`; validación previa de pasajeros en el Gateway | GW |
| `GET /offers/{id}/seatmap` | **B5**: falta `status` por asiento. Mapeable desde las asignaciones de Ancillaries: `PROVISIONAL→BOOKED`, `CONFIRMED→TICKETED`, `CHECKED_IN→CHECKED_IN`, libre→`AVAILABLE`. `HELD` por asiento no existe (el hold es un contador) y `BOARDED` no se modela | `Seat.status` aditivo (proto `common`) + `prisma-seat-map` devuelve el estado de la asignación. `HELD`/`BOARDED` no se emiten nunca en F12a (documentado). `isAvailable` se mantiene. `OFFER_NO_LONGER_AVAILABLE` → 410 (v2 lo lista en 410); desconocido → 404 | MS-M3 |
| `GET /flights/{n}/status` | `delayMinutes`, `updatedAt`, `gate` nuevos y opcionales | `delayMinutes = estimatedAt − scheduledAt` (min, ≥0); `updatedAt` y `gate` se omiten (no hay dato) | GW |
| `POST /offers/hold` | `ttlMinutes` (5–30) no llega a Pricing (TTL fijo por config); replay 200; `hold.created` no se publica nunca; `_links` | `ttl_minutes` aditivo en `HoldOfferRequest` (si no se aprueba, se rechaza con 400 un TTL distinto del configurado — no se ignora en silencio). `hold.created` lo publica la fachada tras la primera ejecución (no en replay); `seatsHeld` = pasajeros con asiento | GW + MS-M4 |
| `GET /offers/hold/{id}` | `holdId`, `_links` | Directo | GW |
| `DELETE /offers/hold/{id}` | Hold `CONSUMED` → 409 `HOLD_ALREADY_CONSUMED`; hoy no hay distinción | El Gateway lee el hold antes (owner-scoped) y mapea; liberar liberado/vencido → 204 (ya) | GW |
| `GET /bookings` | `status`, `createdFrom/To` no soportados por el RPC (solo `pnr`) | Filtro `status` y fechas **en el Gateway** sobre la página devuelta si el RPC no admite — no es correcto con cursores. Propuesta: `status`, `created_from`, `created_to` opcionales aditivos en `ListReservationsRequest`. Si se rechaza M2-b, se documenta que `status/createdFrom/createdTo` filtran por página | GW + MS-M2b (opcional) |
| `POST /bookings` | (a) códigos 422 específicos que el dominio no distingue (todo es `VALIDATION_FAILED`, salvo `INFANT_SEAT_NOT_ALLOWED`): `INFANT_WITHOUT_ADULT`, `PASSENGER_COUNT_MISMATCH`, `DOCUMENT_EXPIRED`, `PASSPORT_REQUIRED_INTERNATIONAL`; (b) hold vencido hoy da `OFFER_NO_LONGER_AVAILABLE`, v2 pide 410 `HOLD_EXPIRED`; (c) `salesChannel`, `paymentReference`, `holdId`, `_links` en la respuesta; (d) 201 vs 202; (e) **B1** | (a)(b) validación previa en el Gateway (reglas puras con pruebas; el dominio sigue igual y v1 no cambia). "Internacional" = origen o destino fuera del conjunto `DOMESTIC_AIRPORTS` (env, por defecto códigos ecuatorianos); (c) `v2_booking`; (d) 201 `CONFIRMED`, **202 `TICKET_ISSUING`** cuando falle la emisión y quede para reintento (hoy el RPC lanza `TICKET_ISSUANCE_FAILED` sin dar el `bookingId` → campo aditivo `defer_issuance_failure` en `CreateReservationRequest`, ver §4.1); (e) §2.1. `promotionApplied/discountPercentage` > máximo del acuerdo → 422 `PROMOTION_DISCOUNT_OUT_OF_RANGE` | GW + MS-M2 |
| `GET /bookings/{id}` | `_links` por estado (HATEOAS) | Generador de enlaces por estado (`seats`/`check-in` solo si hay boletos emitidos, `cancel` si no está cancelada…) | GW |
| `POST /bookings/{id}/tickets` | No existe | §4.2 | GW (+MS-M2 para `TICKET_ISSUING`) |
| `GET /bookings/{id}/tickets[/{tid}]` | `passengerName`, datos de segmento | Directo + `passengerName` desde el detalle de la reserva (mismo dueño) | GW |

### P3 — Eventos (B2, B3)
| Pieza | Brecha | Propuesta | Toca |
|---|---|---|---|
| Suscripciones `POST/GET/DELETE /webhooks` | Scope y rol OK; v2 pide `active`, `createdAt`; `secret` ≥ 16 y `writeOnly`; lista de eventos v2 (agrega `hold.created`, `booking.seat_changed`, `flight.status_changed`); `GET` devuelve array | Webhooks acepta los 3 eventos nuevos; la suscripción creada por v2 queda marcada `api_version=2`. El secreto se sigue guardando cifrado (ADR-3-01) | GW + MS-M1 |
| Entrega CloudEvents | Hoy: JSON v1 + `x-flight-signature: t=…,v1=…` sobre `ts.body` | Para `api_version=2`: `content-type: application/cloudevents+json`, cuerpo CloudEvents v1.0 (`type=ec.edu.epn.booking.vuelos.<evento>`, `source=/aerolineas/gabatair/vuelos`, `id=evt-vue-<seq>`, `time`, `subject`, `correlationid`, `data`), `X-Webhook-Signature: sha256=<HMAC(secret, body)>`, `X-Correlation-Id`. Reintentos 1/5/30/120/360 min = `WEBHOOK_BACKOFF_MINUTES` (verificar el valor actual). v1 sin cambios | MS-M1 |
| Routing al partner (B2) | Entrega por `ownerId` exacto | `activeFor(owner)` incluye suscripciones cuyo `ownerId` = parte antes de `~` (D1). Los dueños de v1 no contienen `~`: sin efecto | MS-M1 |
| Feed `GET /vuelos/eventos` | Sin almacén (B3) | Tabla `event` en Webhooks (`seq bigserial`, `event_id`, `owner_id`, `event_type`, `payload`, `correlation_id`, `occurred_at`), escrita en `publish`; RPC `ListEvents(owner_prefix, after_seq, limit, type)` aditivo. `id = evt-vue-<seq 6 dígitos>`, `after` = ese id, `metadata.next_after`/`total`/`timestamp` | MS-M1 |
| `correlationid` | Los publicadores (Reservation, Inventory, Operations) no propagan correlación | `correlation_id` aditivo en `WebhookPayload`; si falta se usa el `eventId`. Los eventos que publica la fachada llevan el `X-Correlation-Id` real; los de servicios llevan el fallback hasta F12b (AMQP `correlation_id`) | MS-M1 |
| Quién publica qué | ver tabla de §5 | — | — |
| `POST /vuelos/booking-events` (B6) | Fuera del contrato | Auth: token de partner con `flights:book` (opcional: además `X-Webhook-Signature` si Booking lo prefiere, pendiente 5.6.1). Cuerpo = CloudEvent validado con `EventPaymentConfirmed` / `EventPackageCancelled`. Idempotente por `id` (`v2_processed_event`): repetido → mismo resultado, sin efectos. Respuesta `200 {eventId, outcome}`; `outcome` ∈ `ALREADY_ISSUED`, `ISSUED`, `RELEASED`, `FAILED_APPLIED`, `CANCELLED`, `IGNORED_UNKNOWN_BOOKING` (404 si la reserva no es del partner). `package.cancelled` → cancelación con `reasonCode=SAGA_COMPENSATION` | GW (+MS-M2) |

### P4 — Postventa y check-in
| Operación | Brecha | Propuesta | Toca |
|---|---|---|---|
| `GET baggage-options` | Directo | — | GW |
| `POST baggage` | `payment` obligatorio en v2 (en v1 también); 202 documentado; `PAYMENT_REFERENCE_INVALID`/`AMOUNT_MISMATCH`; evento `booking.baggage_added` ya se publica | Mapa de errores v2; `BAGGAGE_LIMIT_EXCEEDED` → 422 (v2 lo lista en 422; v1 lo envía como 409 — ojo, solo v2) | GW |
| `POST date-change/search` / `date-change` | `payment` y `assignedSeats`; 202 con `BookingDetail`; `CHANGE_OFFER_EXPIRED` 410; `FARE_NOT_CHANGEABLE` 409 | Directo | GW |
| `GET cancellation-quote` | Directo | — | GW |
| `POST cancel` | Respuesta ampliada (`refund`, `ticketsVoided`, `inventoryRestoration`, `reasonCode`); `quoteId` opcional si `SAGA_COMPENSATION`/`FLIGHT_CANCELLED`; estado interno `CANCEL_PENDING` ↔ v2 `CANCELLATION_PENDING` | Sin `quoteId`: el Gateway pide una cotización y cancela con ella (penalidad de tarifa). Con `SAGA_COMPENSATION`/`FLIGHT_CANCELLED` la penalidad no debe aplicar (**D5**): `reason_code` + `waive_penalty` aditivos en `CancelReservationRequest`/`QuoteCancellationRequest`. `refund` sale de la cotización usada; `ticketsVoided` de `listTickets`; `seatsReleased` = pasajeros con asiento; `refundId=REF-VUE-<n>` derivado del `quoteId`; `status`: `CALCULATED` (o `NOT_REFUNDABLE` si 0) | GW + MS-M4/M2 (D5) |
| `PUT /bookings/{id}/seats` | **No existe cambio de asiento** (solo `AssignSeatAtCheckIn` y `ReserveSeats` al crear) | Ver §3.1 | GW + MS-M3 |
| `POST check-in` | `_links`; ventana 48 h y 409/422 ya existen en Operations | Directo | GW |
| `GET boarding-passes` | `gate` opcional | Se omite (no hay dato); `409 BOARDING_PASS_NOT_AVAILABLE` ya existe | GW |

### P5 — Stock por gRPC
| Pieza | Propuesta | Toca |
|---|---|---|
| Proto | `contracts/proto/external/booking/inventory.proto` copiado literal del contrato §9 (archivo nuevo, aditivo, con ADR) | proto aditivo |
| Cliente | `@grpc/grpc-js` + TLS al `BOOKING_STOCK_GRPC_URL` (por defecto `booking.epn.edu.ec:50051`), metadata `x-api-key` (env `BOOKING_STOCK_API_KEY`, nunca en logs) y `x-correlation-id`; `service_id=NODE_VUE_GABATAIR`, `item_id=<vuelo>-<cabina>`, `date`, `time_slot` HH:mm **local** de salida, `available_units` = `Inventory.QueryAvailability` actual, `timestamp` ms | GW |
| Disparo | Tras cada hold, liberación, reserva, cancelación y cambio de fecha **de la fachada v2** (best-effort, tras responder). Fallo → fila en `stock_outbox` y reintento por el scheduler del Gateway (backoff, máx. N intentos). `STOCK_SYNC_ENABLED=false` lo apaga | GW |
| Límite | La expiración de holds ocurre en Inventory y no pasa por el Gateway: el scheduler reconcilia los vuelos tocados en la última hora cada ciclo. Sin esto Booking vería stock bloqueado hasta el próximo movimiento | GW |
| Sin credencial | No se puede probar contra Booking real hasta recibir la `x-api-key` (pendiente 5.6.2); se prueba con servidor gRPC simulado con TLS | — |

### P6 — Operaciones
| Operación | Brecha | Propuesta | Toca |
|---|---|---|---|
| `PATCH /flights/{n}/status` | Hoy solo por `flightInstanceId` y rol admin; transición inválida da `VALIDATION_FAILED` (400), v2 pide 409 `INVALID_STATUS_TRANSITION`; no hay gate ni `reason`; evento hoy `flight.schedule_changed/cancelled` por umbral, no `flight.status_changed`; `affectedBookings` | Resolver instancia con `Inventory.FindFlightInstance`; estado previo con `Operations.GetFlightStatus`; **tabla de transiciones copiada en el Gateway con prueba de equivalencia** (para devolver 409 sin tocar Operations); `RecordOperationalUpdate`; `affectedBookings` = reservas del vuelo (RPC `system` ya existente); `flight.status_changed` publicado por la fachada con `affectedBookingIds` (≤100 ids) a los partners suscritos. `departureGate` y `reason`: se **rechazan con 400** si llegan (no se guardan; ver pregunta Q3). `eventId` = id del evento publicado | GW |
| `GET /operaciones/vuelos` | Agregado por vuelo y cabina inexistente | `ListFlightInstances(date)` + conteos. HELD/vendido por cabina requiere RPC aditivo de Inventory (`GetCabinOccupancy`); `TICKETED` = vendidos con reserva `CONFIRMED`; `CHECKED_IN` desde Operations (conteo aditivo) o cero; `BOARDED` siempre 0. Alertas: `LOW_AVAILABILITY` (<10), `DELAYED`, `CANCELLED`, `CHECKIN_OPEN`, `OVERBOOKING_RISK` (no aplicable: Inventory impide sobreventa). Es la operación de menor prioridad y la que más cambios pide | GW + MS-M5 |
| `GET/PUT /promociones/contrato` | Sin almacén | Tabla `promotion_agreement` del Gateway (por `clientId`); `GET` sin registro → 404; `PUT` idempotente por reemplazo; valida `rutas_habilitadas` `^[A-Z]{3}-[A-Z]{3}$`. `actualizado_en`, `proveedor_codigo=NODE_VUE_GABATAIR`, `nombre_socio=GabatAIR`. Se **consulta** en `POST /bookings` para validar descuentos | GW + tabla |

### 3.1 Cambio de asiento (`PUT /seats`)
Hoy: `ReserveSeats` (al crear), `ConfirmSeats`, `ReleaseSeats` (todo el booking) y `AssignSeatAtCheckIn`. No hay "mover un asiento". Propuesta mínima: RPC aditivo `ChangeSeats(booking_id, owner_id, changes[])` en Ancillaries, **atómico** (todo o nada), que valida: misma cabina (`SEAT_CABIN_MISMATCH` 422), infante (`INFANT_SEAT_NOT_ALLOWED` 422), asiento ocupado (`SEAT_TAKEN` 409), segmento ya con check-in (`CUTOFF_PASSED` 409); libera el anterior y deja el nuevo en el estado del pasajero (`PROVISIONAL`→BOOKED / `CONFIRMED`→TICKETED). Gateway: pre-lee reserva (dueño), orquesta, registra el evento `booking.seat_changed` y devuelve `previousSeatNumber`. Cargo por asiento: no hay tarifa de asientos en Pricing → `amountCharged` se omite (Booking no cobra) y se documenta. **Alternativa si el tiempo aprieta**: P4 sale sin `PUT /seats` y se avisa a Booking antes de la sesión.

## 4. Emisión de boletos (5.4) — demostración operación por operación

### 4.1 Estado actual verificado en código (`create-reservation.ts`)
Orden dentro de `CreateReservation`: verificar pago → crear fila `PENDING` → registrar franquicias → reservar asientos/equipaje → **consumir hold** → `TICKET_ISSUING` → `Ticketing.IssueTickets` → `CONFIRMED` → confirmar asientos → publicar `booking.confirmed`. Con `AUTHORIZED` todo ocurre en la misma llamada. `ResumePending` reintenta `TICKET_ISSUING` (3 intentos) y termina en `CONFIRMED` o `FAILED` (+`booking.failed`).

### 4.2 Conformidad con el contrato v2 (decisión: emitir dentro de `POST /bookings`)
| Operación / evento | Lo que exige el contrato | Con emisión en la creación | ¿Cumple? |
|---|---|---|---|
| `POST /bookings` | `201` = "reserva creada y boletos emitidos" (`CONFIRMED`); `202` = emisión continúa (`TICKET_ISSUING`) con resultado por evento; `200` replay | Éxito → 201 `CONFIRMED` con `tickets[]` `ISSUED`. Fallo transitorio de Ticketing → hoy lanza error sin `bookingId` (no cumple el 202). **Con `defer_issuance_failure`** (M2) responde 202 `TICKET_ISSUING` y `ResumePending` cierra con `ticket_issued`/`ticket_failed` | ✔ con M2 |
| `POST /bookings/{id}/tickets` | `200`, "idempotente por construcción: si ya estaban emitidos responde 200 con `issued: 0`"; 404 ajeno; 409; 422 | Reserva `CONFIRMED` con boletos `ISSUED` → 200 `{status:CONFIRMED, tickets, issued:0}` sin evento nuevo. `TICKET_ISSUING` → 200 `{status:TICKET_ISSUING, issued:0}`. `FAILED`/`CANCELLED` → 409 `BOOKING_NOT_CONFIRMED`. `PENDING_PAYMENT` → 422 `PAYMENT_NOT_AUTHORIZED` (el pago no consta). Dueño ajeno → 404 | ✔ |
| `GET /bookings/{id}/tickets` | `TicketListResponse` | Directo | ✔ |
| `GET …/tickets/{ticketId}` | `Ticket`, 404 | Directo | ✔ |
| `booking-events` · `payment.confirmed` | "Emitir boletos de la reserva asociada" | Boletos ya emitidos → `outcome=ALREADY_ISSUED`, sin duplicar ni reenviar `ticket_issued`. En `TICKET_ISSUING` queda a cargo del reintento (`outcome=ISSUED` cuando termina) | ✔ |
| `booking-events` · `payment.failed` | "Liberar el hold y marcar la reserva `FAILED`" | Reserva sin emitir → `FAILED` + liberar (camino que ya existe en `ResumePending`). **Reserva ya emitida → ver 4.3** | ⚠ requiere D3 |
| Evento `booking.confirmed` | Lo emite `POST /bookings` | Ya se publica | ✔ |
| Evento `booking.ticket_issued` | Lo consume Facturación; la emite la emisión | **Hoy nadie la publica** (está en la lista de Webhooks, sin emisor). M2 la publica en `CreateReservation` y `ResumePending` tras confirmar boletos, con `paymentReference` y `tickets[]`; en replay de `POST /tickets` no se vuelve a emitir | ✔ con M2 |
| Evento `booking.ticket_failed` | Si la emisión no se completa | Hoy `ResumePending` publica `booking.failed`; M2 añade `booking.ticket_failed` junto a él | ✔ con M2 |

**Orden observable de eventos al crear:** `booking.confirmed` → `booking.ticket_issued` (mismo `correlationid`).

### 4.3 El punto que requiere tu decisión (D3)
El contrato define `payment.failed` como "liberar el hold y marcar la reserva `FAILED`". El `data` de `EventPaymentConfirmed` trae `bookingId` (no `holdId`), así que **siempre** apunta a una reserva ya creada. Con la emisión dentro de `POST /bookings`, para cuando llega `payment.failed` el hold ya está `CONSUMED` (no hay nada que liberar) y los boletos ya existen. Opciones:

- **A (recomendada):** aplicar la intención del contrato: anular boletos, liberar asientos/inventario, `FAILED`, publicar `booking.failed`. Requiere un RPC aditivo `FailReservation` en Reservation que reutilice la compensación de `ResumePending` y permita la transición `CONFIRMED→FAILED` (hoy el dominio no la tiene). En F12b el orquestador reproduce la misma saga: lo observable no cambia.
- **B:** responder `409 BOOKING_NOT_CANCELLABLE` y dejar que Booking llame a `cancel`. No cumple el texto literal del contrato.
- **C:** ignorar (`outcome=IGNORED`). Deja boletos válidos sin pago; descartada.

Esto es lo único que encontré que la decisión 5.4 no cubre por sí sola. Hasta que decidas, `payment.failed` sobre reservas no emitidas funciona y sobre emitidas devuelve 409 sin efectos.

### 4.4 Invariancia al mover la emisión al orquestador (F12b)
Lo observable para Booking queda fijado por la tabla 4.2 y por estas pruebas, que se escriben ahora y no se tocan en F12b: (1) `POST /bookings` → 201 con boletos `ISSUED` en la misma respuesta, o 202 `TICKET_ISSUING` + evento posterior; (2) `POST /tickets` repetido → `issued:0` y cero eventos nuevos; (3) orden y cantidad de eventos (`confirmed`, `ticket_issued` una sola vez); (4) `payment.confirmed` repetido → mismo `outcome`; (5) `payment.failed` conforme a D3. F12b solo cambia **quién** ejecuta los pasos (ESB en vez de Reservation) y que el Gateway llama al ESB; las pruebas de F12a son la regresión.

## 5. Máquinas de estado y publicadores

### 5.1 Reserva
| v2 | Interno | Mapeo |
|---|---|---|
| `PENDING`, `PENDING_PAYMENT`, `TICKET_ISSUING`, `CONFIRMED`, `FAILED`, `CANCELLED`, `CHANGE_PENDING` | idénticos | directo |
| `CANCELLATION_PENDING` | `CANCEL_PENDING` | traducir en la fachada (v1 ya acepta ambos en `cancel`) |
Transiciones nuevas: `CONFIRMED→FAILED` solo por D3-A.

### 5.2 Asiento
Por asiento: `AVAILABLE` (sin asignación), `BOOKED` (`PROVISIONAL`), `TICKETED` (`CONFIRMED`), `CHECKED_IN`. `HELD` y `BOARDED` no existen por asiento (el hold es un contador por cabina; el abordaje no se modela). Quedan en los enums del contrato pero no se emiten (§3 seatmap, panel de operaciones).

### 5.3 Quién publica cada evento
| Evento | Publicador F12a | Estado hoy |
|---|---|---|
| `hold.created` | Fachada v2 (primera ejecución) | no existe; Webhooks no lo conoce (MS-M1) |
| `hold.expired` | Inventory (ya) | existe, `data.holdId` |
| `booking.confirmed`, `booking.failed` | Reservation (ya) | existe |
| `booking.ticket_issued`, `booking.ticket_failed` | Reservation (M2) | `issued` sin emisor |
| `booking.changed`, `booking.cancelled`, `booking.baggage_added` | Reservation (ya) | existen |
| `booking.seat_changed` | Fachada v2 tras `ChangeSeats` | no existe (MS-M1) |
| `booking.checked_in` | Operations (ya) | existe |
| `flight.status_changed` | Fachada v2 (PATCH); cambios hechos por rutas admin v1 no lo emiten en F12a | no existe |
| `flight.schedule_changed`, `flight.cancelled` | Operations (ya, v1) | se conservan; el esquema CloudEvents v2 no los cubre, así que **no** se entregan a suscripciones v2 (el contrato pide usar `flight.status_changed`) |

## 6. Cambios fuera del Gateway que pide la matriz (todos aditivos; ninguno antes de tu aprobación)

| Ref | Servicio | Cambio | Motivo | Prioridad |
|---|---|---|---|---|
| **M2** | reservation | (a) `PaymentVerifier` real con patrón + unicidad; (b) `defer_issuance_failure` en `CreateReservationRequest`; (c) publicar `booking.ticket_issued`/`ticket_failed`; (d) RPC `FailReservation` (D3-A) | B1, 4.2, 4.3 | **P2** (a,b), P3 (c,d) |
| M2b | reservation | filtros `status/created_from/created_to` en `ListReservations` | `GET /bookings` | opcional |
| **M1** | webhooks (+migración) | tabla `event`, `api_version` en `subscription`, entrega CloudEvents v2, prefijo `~`, 3 eventos nuevos, `correlation_id`, RPC `ListEvents` | B2, B3 | **P3** |
| M3 | ancillaries | `Seat.status` en seatmap (+proto `common`); RPC `ChangeSeats` | seatmap, `PUT /seats` | P2 / P4 |
| M4 | pricing | `ttl_minutes` en `HoldOffer`; `waive_penalty` en `QuoteCancellation` | hold, cancel | P2 / P4 |
| M5 | inventory | `GetCabinOccupancy` | panel de operaciones | P6 |
| P-ext | contracts/proto | `external/booking/inventory.proto` (nuevo) + los campos anteriores | todo lo anterior | con cada bloque |

Sin M1 y M2(a) no se puede declarar P2 ni P3 listos; recomiendo hacer **M2(a,b) y M1 en el primer día**. Cada cambio llevará ADR (`ADR-F12-…`) y avisaré servicio por servicio antes de tocarlo, con la migración local que debas aplicar.

## 7. Preguntas

| ID | Pregunta | Para |
|---|---|---|
| Q1 | Formato real de `paymentReference` (D4) y si `payment.amount` se enviará siempre | Booking |
| Q2 | Cómo autentican los eventos hacia `booking-events` (5.6.1) y si aceptan nuestra ruta | Booking |
| Q3 | `departureGate` y `reason` del PATCH: ¿los guardamos (campo aditivo en Operations) o los rechazamos? | Tú |
| Q4 | `x-api-key` y fecha de entrega de las credenciales (5.6.2, 5.5.6) | Booking |
| Q5 | ¿`BAGGAGE_LIMIT_EXCEEDED` en v2 va como 422 (lo que lista el contrato) aunque v1 lo envía como 409? | Tú (propongo 422 solo en v2) |
| Q6 | URL de `webhooks` de Booking y si firman con el mismo secreto que declaran en la suscripción | Booking |

## 8. Riesgo del plazo (martes 19h30)

Orden realista por dependencia, no solo por prioridad: **P1** (Gateway) → **M2(a,b) + M1** → **P2** → **P3** → **P4 sin `PUT /seats`** → **P5** → **P6**. P2 y P3 son lo que Booking necesita para "comprar y enterarse". Si D2/D3 se aprueban hoy, P1–P3 son alcanzables; `PUT /seats`, el panel de operaciones y el stock contra Booking real (sin `x-api-key`) son los candidatos a informarse como pendientes antes de la sesión.
