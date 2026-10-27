# F12a · Lista de verificación para la reunión con Booking (martes 19h30, integración local)

Cómo preparar la máquina, el seed, el cliente de prueba, el puerto del firewall y el registro del webhook: `docs/dev/f12a-preparar-reunion.md`. Colección Postman: `docs/dev/postman/`.

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
- **Búsqueda: una oferta por consulta con el primer vuelo disponible de cada tramo** (el de salida más temprana con cupo), no todas las alternativas del día. Comportamiento heredado de v1 (`search-offers.ts`: «conserva la primera alternativa disponible por tramo»); ofrecer varias alternativas queda para F12b. Si Booking espera una lista de vuelos del día, hay que avisarles al inicio.
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

## 5. Cancelaciones, compensación de combos y asientos
| Qué confirmar | Variable | Por defecto |
|---|---|---|
| Ventana en la que `SAGA_COMPENSATION` no paga penalidad (desde la creación de la reserva); fuera de ella aplica la penalidad de la tarifa | `SAGA_PENALTY_WAIVER_MINUTES` (api-gateway) | 120 |
- `FLIGHT_CANCELLED` sin `quoteId` siempre devuelve el total. Con `CUSTOMER_REQUEST` u `OTHER` el `quoteId` es obligatorio (400 si falta).
- `package.cancelled` (combo fallido) se envía a `booking-events`: cancela la parte de vuelo con `SAGA_COMPENSATION`.
- Cambio de asientos (`PUT …/seats`): no hay tarifa de asientos, así que **no se cobra** y la respuesta no trae `amountCharged`; un `payment` enviado se ignora.
- El reembolso lo calcula la aerolínea (`refund.status = CALCULATED`) y **lo ejecuta Booking**.

## 6. Stock por gRPC (aerolínea → Booking)
| Qué confirmar | Variable | Por defecto |
|---|---|---|
| Dirección del `PushStockUpdate` de Booking | `BOOKING_STOCK_GRPC_URL` | `booking.epn.edu.ec:50051` |
| `x-api-key` que Booking entrega | `BOOKING_STOCK_API_KEY` | vacío = envío **apagado** |
| TLS (en la prueba local sin TLS: `INTEGRATION_LOCAL=true` + `BOOKING_STOCK_TLS=false`) | `BOOKING_STOCK_TLS`, `BOOKING_STOCK_TLS_CA_FILE` | TLS activo |
- Se envía un mensaje por vuelo y cabina (`<vuelo>-<cabina>`, fecha y hora locales de salida, asientos libres) cada vez que cambia la capacidad; si Booking no responde se reintenta hasta 8 veces.
- Tras una compra Booking verá varios mensajes seguidos (hold y reserva): son estados sucesivos del mismo vuelo.
- Pendiente para F12b: `StreamInventoryChanges`.

## 7. Operaciones y promociones (P6, implementado)
- `PATCH /vuelos/flights/{flightNumber}/status` (`flights:ops` o `flights:admin`): `departureGate` y `reason` se guardan y viajan en `flight.status_changed`; transición inválida ⇒ 409 `INVALID_STATUS_TRANSITION`; `CANCELLED` cierra la venta. Booking recibe el evento si tiene reservas vivas en ese vuelo (con solo los ids de las suyas).
- `GET /vuelos/operaciones/vuelos` (`flights:ops` o `flights:admin`): panel por vuelo y cabina. `BOOKED`, `CHECKED_IN` y `BOARDED` salen en 0 (lo vendido cuenta como `TICKETED` porque la emisión v2 es inmediata).
- `GET`/`PUT /vuelos/promociones/contrato`: `PUT` exige `flights:admin` e `Idempotency-Key`; descuento fuera de 0–100 ⇒ 422 `PROMOTION_DISCOUNT_OUT_OF_RANGE`. El acuerdo es **único de la aerolínea**: lo registra nuestro admin y Booking lo lee con `flights:read` (404 mientras no se registre; Booking no puede hacer `PUT`, 403).

## 8. Credenciales e intercambios (quién entrega qué)
| De → a | Qué | Cómo se usa | Dónde vive |
|---|---|---|---|
| GabatAIR → Booking | `client_id` + `client_secret` (OAuth2 client_credentials) y la URL `PUBLIC_BASE_URL` | `POST /api/v2/oauth2/token`; Bearer + `X-User-Id` | secreto hasheado en la base; archivo `.local/*.secret` que se borra tras entregarlo |
| Booking → GabatAIR | secreto compartido de `booking-events` | HMAC-SHA256 del cuerpo en `X-Webhook-Signature` | `BOOKING_EVENTS_SECRET` (perfil local) |
| Booking → GabatAIR | URL, ruta y credencial de la API de pagos `GET /pagos/{ref}` | verificación de cada pago | `BOOKING_PAYMENTS_*` (perfil local) |
| Booking → GabatAIR | dirección y `x-api-key` del gRPC de stock | `PushStockUpdate` | `BOOKING_STOCK_GRPC_URL`, `BOOKING_STOCK_API_KEY` |
| Booking → GabatAIR | URL de recepción de webhooks y su `secret` (≥ 16 caracteres) | Booking lo registra con `POST /vuelos/webhooks` | base de datos (el secreto se guarda cifrado) |
Ningún secreto se versiona, se imprime ni se pega en chats. Si se sospecha una filtración: `disable` del cliente, rotar el secreto compartido y reiniciar.

## 9. Lista de verificación para la reunión
**Antes (en la máquina de GabatAIR)**
- [ ] `tailscale ip -4` anotada y puesta en `PUBLIC_BASE_URL` (perfil `.local/integracion.env`).
- [ ] Migraciones aplicadas (api-gateway ×3, reservation, webhooks) y `npm run local:seed` ejecutado hoy (vuelos futuros).
- [ ] `npm run local:up` termina en `La plataforma está sana` (Gateway y 7 servicios UP).
- [ ] `npm run local:journey` termina en `31/31 comprobaciones OK`.
- [ ] Regla de firewall del puerto 3000 solo para `100.64.0.0/10` creada.
- [ ] Cliente `booking` creado y su secreto listo para entregar por un canal seguro.
- [ ] Desde la máquina de Booking: `GET http://<IP>:3000/api/v2/vuelos/health` responde `HEALTHY`.

**Se confirman con Booking en la reunión** (no se les consultó antes; todo es configurable, ver §1, §3, §4 y §6)
- [ ] API de pagos: URL, ruta, credencial, nombres de estado y de campos. ⚠ **Usar `BOOKING_PAYMENTS_VERIFY=off` solo si la API de pagos de Booking no está disponible**: con `off` se autoriza todo pago sin verificarlo; solo con `INTEGRATION_LOCAL=true`, con aviso al arrancar y en cada pago; volver a `on` en cuanto responda; jamás en la nube.
- [ ] Secreto, cabecera y prefijo de la firma de `booking-events`.
- [ ] URL y `x-api-key` del gRPC de stock; si hay TLS.
- [ ] URL de su receptor de webhooks y su `secret`.
- [ ] Ventana sin penalidad de `SAGA_COMPENSATION` (120 min por defecto).

**Se informan como pendientes al inicio** (§2 y §7): pago pendiente en equipaje y cambio de fecha (hoy 422), mapa de asientos solo `AVAILABLE`/`BOOKED`, `correlationid` provisional, operaciones y promociones sin implementar, `StreamInventoryChanges` para F12b, y las dos incoherencias del contrato (§4).

**Durante** — pasada por Postman (carpetas 0 a 5): token, búsqueda, hold, reserva (201 con pago confirmado o 202 pendiente), `payment.confirmed` firmado, equipaje, asiento, cancelación con y sin cotización, `package.cancelled`, registro de webhook y recepción de una entrega firmada, feed de eventos.
- [ ] Booking recibe en su webhook `booking.confirmed` y `booking.cancelled` con firma válida.
- [ ] Booking ve en su gRPC los `PushStockUpdate` tras un hold, una reserva y una cancelación.
- [ ] Un evento repetido de Booking responde igual sin efectos nuevos.

**Después**: `npm run local:down`, borrar la regla de firewall, borrar `.local/*.secret` y anotar los valores acordados en el perfil (no en git).
