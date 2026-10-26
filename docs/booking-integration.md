# Guía de integración para Booking — Flight Platform

Contrato: `contracts/openapi/vuelos-openapi.yaml` (GDS Flight Core API v1.5.0.0, 22 operaciones REST más el callback OP-23).
Esta guía describe cómo se comporta el despliegue frente a ese contrato; no lo reemplaza. Si algo difiere, manda el contrato.

## 1. URL base y entornos

| Entorno | URL base | Notas |
|---|---|---|
| Despliegue actual (Render) | `https://flight-gateway-o37n.onrender.com/flights/v1` | Único punto de entrada. Los siete microservicios son internos (Cloud Run, gRPC) y no se exponen. |
| Contrato | `https://api.booking-hub.com/flights/v1` y `https://sandbox.api.booking-hub.com/flights/v1` | Direcciones declaradas en el OpenAPI; no están desplegadas. Usa la URL de Render. |

Todo el tráfico es HTTPS. Una petición con `X-Forwarded-Proto: http` recibe 400, y las respuestas llevan HSTS.
Los cuerpos de petición admiten hasta 100 kB (413 si se excede). Las fechas siguen RFC 3339.

## 2. Autenticación, emisores, roles y scopes

Todas las operaciones salvo `/search`, `/offers/{offerId}/seatmap`, `/flights/{flightNumber}/status` y `/health` exigen
`Authorization: Bearer <JWT>`. El Gateway valida firma por JWKS del emisor (`RS256` o `ES256`; se rechazan `none` y `HS*`),
`iss`, `aud`, `exp` y `nbf` (tolerancia de 30 s). El dueño de todo recurso es el `sub` del token; ningún campo del cuerpo lo
puede cambiar.

| Rol | Cómo se obtiene | Scopes | Puede |
|---|---|---|---|
| `anonymous` | Sin token | — | Buscar, ver el mapa de asientos y consultar el estado de un vuelo |
| `customer` | Supabase Auth (Authorization Code + PKCE) | `flights:read`, `flights:hold`, `flights:book`, `flights:cancel` | Holds, reservas, postventa, tickets y check-in **propios** |
| `partner` | Cuenta de Supabase con `app_metadata.app_role = partner` (**la cuenta con la que se integra Booking**) | los de `customer` + `flights:webhooks` | Lo mismo sobre recursos de su `sub`; gestionar sus webhooks. Sin acceso a `/admin/*` (403) |
| `admin` | `app_metadata.app_role = admin` en Supabase | los de `customer` + `flights:webhooks` + `flights:admin` | Lo anterior + rutas `/admin/*`. **No** ve reservas ajenas |

Reglas que conviene conocer:

- El rol sale del claim `app_role` y los scopes del claim `scope` (separados por espacio). Si el token no trae `app_role`, se usa
  el rol por defecto del emisor (`role` en su entrada de `JWT_ISSUERS`; `customer` si no hay).
- El rol decide además del scope: un `customer` con el scope `flights:webhooks` o `flights:admin` forjado sigue recibiendo 403.
- **Booking se integra con una cuenta `partner` de Supabase.** En Render solo está registrado el emisor de Supabase (los
  emisores de desarrollo, `publicKeyFile`, se rechazan al arrancar con `NODE_ENV=production`) y su hook de tokens
  (`docs/dev/f11a-supabase-auth-hook.sql`) emite el rol `partner` cuando `app_metadata.app_role = partner`. Un `customer` de
  Supabase **no puede** suscribirse a webhooks (403) y un `admin` solo recibe los eventos de sus propios recursos. Cómo crear
  la cuenta: `docs/dev/f11a-supabase-auth.md`, «Cuenta partner».
- Sin token, token inválido o expirado: **401**. Rol o scope insuficiente: **403**. Ambos con `code: VALIDATION_FAILED`.

## 3. Cabeceras y convenciones

| Cabecera | Dónde | Detalle |
|---|---|---|
| `Authorization` | operaciones protegidas | `Bearer <JWT>` |
| `Idempotency-Key` | `POST /offers/hold`, `POST /bookings`, `POST …/baggage`, `POST …/date-change`, `POST …/cancel` | UUID obligatorio. Misma clave y mismo cuerpo ⇒ misma respuesta (24 h). Misma clave con otro cuerpo ⇒ 422 `VALIDATION_FAILED`. Clave en curso ⇒ 409 `VALIDATION_FAILED` con `Retry-After: 1` |
| `X-Device-Fingerprint` | `/search` (obligatoria) y demás rutas públicas | Identifica al llamante anónimo para el límite de tasa. Sin ella se usa la IP |
| `X-Correlation-Id` | opcional | Si la envías se devuelve; si no, el Gateway genera una. Cítala al reportar un problema |
| `Retry-After` | respuestas 429 y 503, y 409 de clave en curso | Segundos |

Límites de tasa (valores por defecto, configurables): 60 peticiones por minuto por huella en rutas públicas y 120 por minuto por
`sub` en rutas autenticadas. Al excederlos: 429 `RATE_LIMIT_EXCEEDED` con `Retry-After`.

Los errores son `application/problem+json` con `ProblemDetails` (`type`, `title`, `status`, `code`, `detail?`, `invalidParams?`).
Nunca incluyen trazas ni mensajes internos.

## 4. Las 23 operaciones

| ID | Operación | Scope | Idempotente | Éxito |
|---|---|---|---|---|
| OP-01 | `POST /search` | pública | — | 200 |
| OP-02 | `GET /offers/{offerId}/seatmap?segmentId=` | pública | — | 200 |
| OP-03 | `POST /offers/hold` | `flights:hold` | sí | 201 |
| OP-04 | `GET /offers/hold/{holdId}` | `flights:read` | — | 200 |
| OP-05 | `DELETE /offers/hold/{holdId}` | `flights:hold` | — | 204 |
| OP-06 | `GET /bookings` | `flights:read` | — | 200 |
| OP-07 | `POST /bookings` | `flights:book` | sí | 201 (emisión terminada) o 202 (pago pendiente / emisión en reintento) |
| OP-08 | `GET /bookings/{bookingId}` | `flights:read` | — | 200 |
| OP-09 | `GET /bookings/{bookingId}/baggage-options` | `flights:read` | — | 200 |
| OP-10 | `POST /bookings/{bookingId}/baggage` | `flights:book` | sí | 200 |
| OP-11 | `POST /bookings/{bookingId}/date-change/search` | `flights:read` | — | 200 |
| OP-12 | `POST /bookings/{bookingId}/date-change` | `flights:book` | sí | 200 o 202 sin cuerpo |
| OP-13 | `GET /bookings/{bookingId}/cancellation-quote` | `flights:read` | — | 200 |
| OP-14 | `POST /bookings/{bookingId}/cancel` | `flights:cancel` | sí | 200 o 202 sin cuerpo |
| OP-15 | `GET /webhooks` | `flights:webhooks` | — | 200 |
| OP-16 | `POST /webhooks` | `flights:webhooks` | — | 201 |
| OP-17 | `DELETE /webhooks/{id}` | `flights:webhooks` | — | 204 |
| OP-18 | `GET /bookings/{bookingId}/tickets` | `flights:read` | — | 200 |
| OP-19 | `GET /bookings/{bookingId}/tickets/{ticketId}` | `flights:read` | — | 200 |
| OP-20 | `POST /bookings/{bookingId}/check-in` | `flights:book` | — | 200 |
| OP-21 | `GET /bookings/{bookingId}/boarding-passes` | `flights:read` | — | 200 |
| OP-22 | `GET /flights/{flightNumber}/status?date=` | pública | — | 200 |
| OP-23 | Callback `WebhookPayload` hacia tu URL | firma HMAC | por `eventId` | tu endpoint responde 2xx |

Las rutas `/admin/*` (vuelos, tarifas y actualizaciones operacionales) no forman parte del contrato; ver `docs/dev/admin-routes.md`.

## 5. Comportamientos ante huecos del contrato

| Caso | Comportamiento |
|---|---|
| Sin token o token inválido; rol o scope insuficiente | 401; 403. Ambos con `code: VALIDATION_FAILED` |
| Hold expirado en `POST /bookings` | 410 `OFFER_NO_LONGER_AVAILABLE` |
| Misma `Idempotency-Key` con otro cuerpo | 422 `VALIDATION_FAILED` |
| `Idempotency-Key` en curso | 409 `VALIDATION_FAILED` con `Retry-After: 1` |
| Servicio interno caído o con demora | 503 `RATE_LIMIT_EXCEEDED` con `Retry-After: 5` |
| `DELETE` de un hold `CONSUMED` | 409 `OFFER_NO_LONGER_AVAILABLE` |
| `DELETE` de un hold ya liberado o expirado | 204 |
| `/bookings/{id}/*` inexistente o de otro `sub` | 404 (indistinguible; nunca 403) |
| Baggage, date-change y cancel con operación pendiente | 202 sin cuerpo (la compra de equipaje responde siempre 200) |
| `QUOTE_EXPIRED` en `/cancel` | 409 |
| `secret` de un webhook | Enmascarado en toda respuesta: `"****"` + últimos 4 caracteres |
| `POST /check-in` sin cuerpo | Check-in de todos los pasajeros elegibles; un resultado mixto es 200 con pasajeros `FAILED` |
| `hold.expired` | `data = { holdId, status: "EXPIRED" }` (ver §8) |
| `flight.schedule_changed` / `flight.cancelled` | Un evento por cada reserva afectada |

Valores de negocio por defecto: hold de 20 min, oferta de 15 min, moneda USD, máximo 9 pasajeros con asiento, check-in desde 48 h
hasta 60 min antes de la salida, equipaje hasta 4 h antes, cotización y oferta de cambio de 15 min, cargo por cambio de 50 USD por
pasajero. La reserva con pago pendiente o emisión fallida se reintenta hasta 3 veces; agotados los intentos queda `FAILED`, con
tickets `VOIDED` y capacidad y asientos liberados.

## 6. Pagos simulados

La API no procesa pagos: recibe una `paymentReference`. En este despliegue el verificador es simulado y decide por prefijo:

| Prefijo | Resultado |
|---|---|
| `pay_ok_…` | Pago autorizado. `POST /bookings` ⇒ 201 `CONFIRMED` |
| `pay_pending_…` | Pago pendiente. `POST /bookings` ⇒ 202 `PENDING_PAYMENT`. En el despliegue no hay forma de autorizarlo, así que la reserva sigue pendiente |
| `pay_denied_…` | 422 `PAYMENT_NOT_AUTHORIZED` |
| `pay_invalid_…` o cualquier otro valor | 422 `PAYMENT_REFERENCE_INVALID` |
| `pay_mismatch_…` | 422 `AMOUNT_MISMATCH` |

En equipaje, `pay_pending_` y `pay_denied_` se rechazan con 422 y no dejan maletas compradas. El total debe coincidir exactamente
con lo autorizado (precio bloqueado + equipaje extra × precio por maleta). Las referencias nunca se registran en logs.

## 7. Registrar webhooks

`POST /webhooks` (solo `partner` y `admin`):

```json
{ "url": "https://tu-dominio.example/flight-events", "events": ["booking.confirmed", "hold.expired"], "secret": "un-secreto-largo-y-aleatorio" }
```

- La URL debe ser `https` y resolver a una dirección pública: se rechazan `localhost`, redes privadas, loopback y link-local, también
  tras resolver el DNS.
- Guarda tu `secret`: la API solo lo devuelve enmascarado. Las suscripciones son por `sub`; cada uno ve solo las suyas.
- **Solo recibes eventos de los recursos creados con la misma cuenta** que la suscripción (mismo `sub`). Crea los holds y las
  reservas y registra el webhook con la cuenta `partner` de Booking; los eventos de recursos de otra cuenta (por ejemplo, de un
  `customer` de Supabase) no se te entregan. Un `customer` no puede registrar webhooks.
- Eventos: `booking.confirmed`, `booking.failed`, `booking.changed`, `booking.cancelled`, `booking.baggage_added`, `hold.expired`,
  `flight.schedule_changed`, `flight.cancelled`, `booking.ticket_issuing`, `booking.ticket_issued`, `booking.ticket_failed`,
  `booking.checked_in`.

## 8. Recibir webhooks (OP-23)

Cuerpo (`WebhookPayload`):

```json
{ "eventId": "b0b0a5f0-0000-4000-8000-000000000001", "eventType": "booking.confirmed", "occurredAt": "2026-01-01T12:00:00.000Z", "apiVersion": "1.5.0.0", "data": { "bookingId": "…", "pnr": "ABC123", "status": "CONFIRMED" } }
```

- `booking.*` llevan `data.bookingId`, `pnr` y `status`; `booking.cancelled` añade `refundAmount`. `flight.*` y `booking.checked_in` identifican la reserva con `data.bookingId` y `pnr`.
- **`hold.expired` lleva `data.holdId`** (ADR-F11-13): `{ "holdId": "<uuid>", "status": "EXPIRED" }`. Úsalo para relacionar la expiración con tu bloqueo.
- `eventId` es estable: deduplica por él, porque un evento puede entregarse más de una vez.
- Responde 2xx dentro de 5 s. Ante cualquier otra respuesta o un tiempo agotado se reintenta 6 veces, a 1, 5, 15, 60, 180 y 720 minutos.

### Verificación de la firma

Cada entrega lleva `X-Flight-Signature: t=<unix>,v1=<hex>`, con `v1 = HMAC-SHA256(secret, "<t>.<cuerpo crudo>")` en hexadecimal.
Verifica sobre el **cuerpo crudo** (no sobre el JSON reserializado), compara en tiempo constante y rechaza marcas de tiempo
lejanas. Cada reintento se firma de nuevo con un `t` nuevo. El ejemplo siguiente está probado contra el firmante real
(`platform/api-gateway/src/booking-integration-doc.spec.ts`):

```ts
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifica la cabecera `X-Flight-Signature: t=<unix>,v1=<hex>` de un webhook de Flight Platform.
 *
 * - `rawBody` es el texto EXACTO recibido; no lo reserialices desde un objeto JSON.
 * - `secret` es el que enviaste al registrar la suscripción (la API solo lo devuelve enmascarado).
 * - Cada reintento se firma con un `t` nuevo, así que la tolerancia se mide contra la hora de recepción.
 */
export function verifyFlightSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  options: { toleranceSeconds?: number; nowSeconds?: number } = {}
): boolean {
  const { toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000) } = options;
  if (!header) return false;
  const fields = new Map(
    header.split(',').map((part) => {
      const at = part.indexOf('=');
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()] as const;
    })
  );
  const timestamp = Number(fields.get('t'));
  const signature = fields.get('v1');
  if (!Number.isInteger(timestamp) || !signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
```

Uso con Express (el cuerpo debe llegar como texto crudo):

```ts
import express from 'express';
import { verifyFlightSignature } from './verify-webhook-signature';

const secret = process.env.FLIGHT_WEBHOOK_SECRET ?? '';
express()
  .post('/flight-events', express.raw({ type: 'application/json' }), (req, res) => {
    const raw = req.body.toString('utf8');
    if (!verifyFlightSignature(raw, req.header('x-flight-signature'), secret)) return res.sendStatus(401);
    const event = JSON.parse(raw) as { eventId: string; eventType: string; data?: { holdId?: string; bookingId?: string } };
    // Deduplica por event.eventId antes de procesar.
    res.sendStatus(200);
  })
  .listen(3000);
```

## 9. Códigos de error

Todos los errores son `ProblemDetails`. El HTTP lo decide el Gateway por `code` y operación.

| `code` | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Entrada inválida (con `invalidParams`). También acompaña a 401, 403, 404 genéricos, 405, 413, 422 de idempotencia y 409 de clave en curso |
| `SEAT_TAKEN` | 409 | Asiento ya ocupado |
| `AMOUNT_MISMATCH` | 422 | El pago no coincide con el total esperado |
| `BOOKING_NOT_CONFIRMED` | 409 | La operación exige reserva `CONFIRMED` (p. ej. cancelar en `CHANGE_PENDING` o `TICKET_ISSUING`) |
| `BAGGAGE_LIMIT_EXCEEDED` | 409 | Más maletas que el máximo permitido |
| `CUTOFF_PASSED` | 409 | Pasó el cierre de equipaje (4 h) |
| `FARE_NOT_CHANGEABLE` | 409 | La tarifa no permite cambios |
| `FLIGHT_ALREADY_DEPARTED` | 409 | El vuelo ya salió |
| `CHANGE_OFFER_EXPIRED` | 410 | La oferta de cambio venció |
| `OFFER_NO_LONGER_AVAILABLE` | 409 | En `/offers/hold` y demás. **410** en `POST /bookings` (hold vencido) y **404** en el mapa de asientos de una oferta o segmento no disponible |
| `QUOTE_EXPIRED` | 409 | La cotización de cancelación venció o ya se usó |
| `ALREADY_CANCELLED` | 409 | La reserva ya está cancelada |
| `RATE_LIMIT_EXCEEDED` | 429 / 503 | **429**: límite de tasa superado, con `Retry-After`. **503**: un servicio interno o el limitador no responde; reintenta tras `Retry-After: 5` |
| `INFANT_SEAT_NOT_ALLOWED` | 422 | Un infante no lleva asiento propio |
| `PAYMENT_REFERENCE_INVALID` | 422 | Referencia de pago no reconocida |
| `PAYMENT_NOT_AUTHORIZED` | 422 | Pago denegado o pendiente donde se exige autorizado |
| `PNR_CREATION_FAILED` | 500 | No se pudo crear el PNR (también como `failureReason`) |
| `TICKET_ISSUANCE_FAILED` | 500 | No se pudo emitir el ticket (también como `failureReason`) |
| `TICKET_ALREADY_ISSUED` | 409 | Ya hay un ticket emitido |
| `CHECK_IN_NOT_AVAILABLE` | 409 | Fuera de la ventana de check-in (48 h a 60 min) |
| `CHECK_IN_FAILED` | 422 | El check-in no pudo completarse |
| `BOARDING_PASS_NOT_AVAILABLE` | 404 | Aún no hay boarding pass |
| `SEAT_CABIN_MISMATCH` | 422 | El asiento no es de la cabina contratada |
| `FLIGHT_STATUS_NOT_AVAILABLE` | 404 | Sin estado para ese vuelo y fecha |

Un recurso inexistente o ajeno responde 404 sin revelar cuál de los dos es.

Los 503 son transitorios: reintenta con la **misma** `Idempotency-Key` y el mismo cuerpo; si la primera llamada llegó a completarse,
recibirás su resultado en lugar de duplicarla.

## 10. Plan gratuito de Render: suspensión y arranques en frío

El Gateway corre en el plan gratuito de Render, que **suspende el servicio tras un periodo sin tráfico** (del orden de 15 minutos);
la primera petición posterior tarda hasta alrededor de un minuto mientras el servicio arranca. Además, los microservicios
internos escalan a cero en Cloud Run: el primer uso tras un periodo inactivo suma arranques en frío (se han medido compras de
6–7 s; el Gateway espera hasta 30 s en las operaciones que orquestan varias dependencias).

Consecuencias:

- Mientras el Gateway está suspendido no corre el scheduler interno: ni vencimientos de holds ni reintentos de pagos pendientes ni
  envío de webhooks pendientes. Al despertar ejecuta una ronda inmediata y luego cada minuto. Los holds vencen igualmente al
  consultarlos.
- Un cliente debe tolerar un primer timeout largo y reintentar; las operaciones idempotentes son seguras de repetir.

**Precalentamiento antes de una demostración o una ronda de pruebas:**

1. Despierta el Gateway hasta recibir 200 (reintenta cada 5 s, hasta unos 2 minutos):
   `curl.exe --fail --retry 12 --retry-delay 5 https://flight-gateway-o37n.onrender.com/flights/v1/health`
2. Despierta las dependencias con una operación real de solo lectura (una búsqueda cubre Pricing e Inventory):
   `POST /search` con una huella cualquiera. Repite si recibes 503 con `Retry-After`.
3. El script `platform/api-gateway/scripts/render-journeys.cjs` ya hace los pasos 1 y 2 antes de los recorridos
   (ver `docs/dev/f11d2-render-journeys.md`).
4. El operador, con credenciales, puede además comprobar el health gRPC de cada microservicio; ver `docs/dev/f11c-scheduler-render.md`.

## 11. Colección de las 23 operaciones

`docs/booking-integration/flight-platform.postman_collection.json` (Postman v2.1; también la importa Bruno) y su entorno
`docs/booking-integration/render.postman_environment.json`. Contiene OP-01 a OP-22, el ejemplo de entrega OP-23 y las rutas admin.

- No incluye secretos: `accessToken` y `webhookSecret` van vacíos. Pega el token solo en tu entorno local de Postman.
- Rellena `departureDate` (AAAA-MM-DD, una fecha con vuelos), `newDepartureDate` para el cambio de fecha y, si usas las rutas admin,
  `adminDepartureAt`, `adminArrivalAt` y `adminDelayedAt` (ISO 8601).
- Ejecuta carpeta por carpeta, de arriba abajo: las pruebas de cada petición guardan los identificadores para la siguiente.

## 12. Verificación y excepciones

Los recorridos J1 (compra), J2 (hold), J5 (postventa), J6 (día del vuelo) y J7 (seguridad) se ejecutan contra Render con
`platform/api-gateway/scripts/render-journeys.cjs`. **J3 (pago pendiente) y J4 (emisión fallida) no se ejecutan contra Render**:
dependen de controles de prueba que no existen en producción (autorizar un pago pendiente y forzar fallos de emisión; este último control, `TICKETING_FAIL_MODE`, hace que el servicio de tickets se niegue a arrancar si se define con `NODE_ENV=production`), y no se
añaden a propósito. Los cubre la suite real local, que los ejecuta de punta a punta (`PLT-I3` y `PLT-I4` en
`platform/api-gateway/test/e2e/real-stack.e2e.spec.ts`). Decisión registrada en ADR-F11-17.
