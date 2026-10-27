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

_(Las secciones de `booking-events`, stock gRPC, webhooks y credenciales se completan con los bloques P3 a P6 y la guía de la plataforma local.)_
