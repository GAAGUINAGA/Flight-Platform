# F12a · Lista de verificación para la reunión con Booking (martes 19h30, integración local)

Todo lo de esta lista está implementado y **configurable por variable de entorno**, con valores por defecto seguros y probado contra simuladores locales. Se confirma con Booking durante la reunión; no se les consultó antes. Las variables de cada servicio se leen al arrancar: tras cambiarlas hay que reiniciar ese servicio.

## 1. API de pagos de Booking — `GET /pagos/{paymentReference}` (reservation-service)
| Qué confirmar | Variable | Por defecto |
|---|---|---|
| URL base (con `http://100.x.x.x:puerto/...` por Tailscale) | `BOOKING_PAYMENTS_BASE_URL` | vacío: **nunca autoriza** (503 en cada pago) |
| Ruta del recurso | `BOOKING_PAYMENTS_PATH_TEMPLATE` | `/pagos/{paymentReference}` |
| Cabecera y valor de la credencial (no se registra) | `BOOKING_PAYMENTS_AUTH_HEADER`, `BOOKING_PAYMENTS_AUTH_VALUE` | `Authorization`, sin valor |
| Nombres de estado (confirmado / pendiente / fallido) | `BOOKING_PAYMENTS_STATUS_MAP` (JSON `{"CONFIRMED":[...],"PENDING":[...],"FAILED":[...]}`) | tabla única en `payment-status-map.ts` (CONFIRMADO, PAID, PENDIENTE, FALLIDO, …) |
| Nombres de los campos de estado, monto y moneda | `BOOKING_PAYMENTS_FIELDS` (JSON `{"status":[...],"amount":[...],"currency":[...]}`) | `estado/status`, `monto/amount/total`, `moneda/currency`; admite el cuerpo envuelto en `data`/`payment` |
| Respuesta si la referencia no existe | (fija) 404 ⇒ 422 `PAYMENT_NOT_AUTHORIZED` | — |
| Plazo propio de la consulta | `BOOKING_PAYMENTS_TIMEOUT_MS` (100–4500) | 2500 |

Reglas: confirmado con monto y moneda iguales al total ⇒ continúa; monto distinto ⇒ 422 `AMOUNT_MISMATCH` sin crear nada; pendiente ⇒ 202 `PENDING_PAYMENT` y el scheduler reverifica; fallido o inexistente ⇒ 422 `PAYMENT_NOT_AUTHORIZED`; sin respuesta en el plazo ⇒ 503 con `Retry-After`. Un estado que no está en el mapa se trata como no autorizado (queda un aviso en el log con el valor).

### ⚠ Contingencia: `BOOKING_PAYMENTS_VERIFY=off`
**Usar solo si la API de pagos de Booking no está disponible.** Con `off` el servicio **autoriza todo pago sin verificarlo** (ni existencia, ni estado, ni monto). Condiciones: solo con `INTEGRATION_LOCAL=true`; reservation-service **no arranca** si está `off` con `NODE_ENV=production` o sin el perfil local; avisa al arrancar y registra un aviso en cada pago autorizado sin verificar. Volver a `on` (o quitar la variable) en cuanto la API responda. Nunca en el despliegue en la nube.

## 2. Pendiente que se informa a Booking al inicio
- Pago pendiente en equipaje (`POST …/baggage`) y cambio de fecha (`POST …/date-change`): hoy responden 422 `PAYMENT_NOT_AUTHORIZED`. El contrato admite 202; llega con F12b. **Nunca se agrega una maleta ni se cambia una fecha sin pago confirmado.**
- Mapa de asientos: solo `AVAILABLE` y `BOOKED`; `HELD` por asiento y `BOARDED` llegan con F12b.
- Los eventos que publican los servicios llevan como `correlationid` el id del evento hasta que F12b propague el real.
- Un usuario solo ve sus propios recursos: los recursos pertenecen a `<clientId>~<X-User-Id>`. Un hold creado con `X-User-Id: u1` no puede convertirse en reserva con otro `X-User-Id` ni sin él.

## 3. Eventos que Booking envía a la aerolínea — `POST /api/v2/vuelos/booking-events` (api-gateway)
Ruta definida por nosotros (no está en el YAML). Acepta `payment.confirmed`, `payment.failed` (y `package.cancelled`, ver P4).
| Qué confirmar | Variable | Por defecto |
|---|---|---|
| Secreto compartido para firmar el cuerpo (HMAC-SHA256 hex) | `BOOKING_EVENTS_SECRET` | vacío: **el endpoint rechaza todo (401)** |
| Cabecera de la firma | `BOOKING_EVENTS_SIGNATURE_HEADER` | `X-Webhook-Signature` |
| Prefijo del valor (vacío = hex a secas) | `BOOKING_EVENTS_SIGNATURE_PREFIX` | `sha256=` |
| Restringir a las reservas de un cliente OAuth | `BOOKING_EVENTS_CLIENT_ID` | sin restricción |
Respuesta al aceptar: `202 {"eventId","outcome"}`. Idempotente por `id` del CloudEvent. `data.amount` (monto y moneda) es obligatorio y debe coincidir con la reserva; `data.bookingId` o `data.paymentReference` identifican la reserva.

## 4. Webhooks de la aerolínea hacia Booking (`POST /api/v2/vuelos/webhooks`, `GET /api/v2/vuelos/eventos`)
- Booking registra su URL con su token (scope `flights:webhooks`); la firma usa el `secret` que declaren (≥ 16 caracteres, no se devuelve nunca). La entrega es CloudEvents con `X-Webhook-Signature: sha256=<HMAC(secret, cuerpo)>`.
- Reintentos 1, 5, 30, 120 y 360 min (`WEBHOOK_BACKOFF_MINUTES_V2`); lo no entregado queda en `GET /vuelos/eventos`.
- Perfil local: la URL puede ser `http://100.x.x.x:puerto/...` solo con `INTEGRATION_LOCAL=true` en webhooks-service; en producción solo https y nunca `100.64.0.0/10`.
- `source` de los eventos: `WEBHOOK_SOURCE_CODE` (`gabatair`).
- Dos incoherencias del contrato que conviene comentar con ellos: `secret` es obligatorio y `writeOnly` a la vez en `WebhookSubscription`, y `booking.ticket_failed` no tiene esquema CloudEvent.

_(Las secciones de stock gRPC, cancelaciones/combos, operaciones y credenciales se completan con los bloques P4 a P6 y la guía de la plataforma local.)_
