# ADR-F12c-01 — El pago de Booking debe cubrir la tarifa (modifica D4 de F12a)

Estado: Aceptado (decisión del humano, 2026-11-08). Modifica la decisión D4 de `ADR-F12-04-reservation-pagos-booking-compensacion.md`.

## Contexto
Evidencia de producción (08-11-2026, 23:03 y 23:04 UTC, compras reales de Booking del FP103 GYE → UIO): Reservation consultó `GET https://booking-core-api.azurewebsites.net/api/v2/pagos/{paymentReference}` y rechazó con 422 `PAYMENT_NOT_AUTHORIZED`; log `[BookingPayments] payments api returned an unmapped status value="CAPTURED"`. Los pagos eran de 693 USD: 630 de nuestra tarifa + 63 del servicio de Booking. Respuesta real de ejemplo:

```json
{"payment_reference":"PAY-BKP-20261108-226306","status":"REFUNDED","amount":693,"refunded_amount":693,"currency":"USD","captured_at":"2026-11-08T22:18:22.600Z","auth_code":"AUTH-PAG-BE3D6520","bookings":[]}
```

Dos problemas independientes que juntos rechazaban toda compra real: (1) `CAPTURED` (estado de éxito de Booking) no estaba en el mapa de estados; (2) D4 exigía monto **igual** al total de la reserva, pero el monto del pago es el total cobrado al pasajero, que incluye el servicio de Booking (y en un paquete podría incluir otros proveedores). Booking confirmó que el monto que nos corresponde es el de nuestra reserva (630). Con solo (1) corregido, 693 ≠ 630 habría dado `AMOUNT_MISMATCH`.

## Decisión
1. El pago se acepta si: existe y es de esa referencia, está confirmado, está en la misma moneda y su monto es **mayor o igual** al total de la reserva. Un monto menor sigue siendo `AMOUNT_MISMATCH`; pendiente → `PENDING`; fallido, reembolsado o inexistente → `PAYMENT_NOT_AUTHORIZED`; estado desconocido → `PAYMENT_NOT_AUTHORIZED`. La regla está en un solo lugar (`BookingPaymentVerifier.verify`), de modo que aplica a todos los caminos que verifican con Booking (creación de reserva, reanudación de pendientes, postventa).
2. Si el monto es mayor, se registra en el log solo la diferencia en unidades menores y la moneda (sin `paymentReference`, pnr ni datos personales).
3. `CAPTURED` y `CAPTURADO` se agregan a `DEFAULT_STATUS_MAP.CONFIRMED`.
4. `BOOKING_PAYMENTS_FIELDS` sigue permitiendo tomar el monto de otro campo (ver abajo).
5. `deploy-reservation.yml` declara la configuración de pagos de Booking (ver «Despliegue»).

## Riesgo acotado
Aceptar un monto mayor no es confiar sin verificar: se sigue comprobando que el pago existe, corresponde a esa referencia, está confirmado, está en la misma moneda y cubre la tarifa. El riesgo residual es que un pago mayor (p. ej. de un paquete) se use para una reserva nuestra más barata; está acotado porque las tablas de pagos de Reservation tienen clave única por `paymentReference` (una referencia no se registra dos veces) y la diferencia queda registrada en el log. Booking no recibe de nosotros más que la confirmación de la reserva; el reembolso lo calcula la aerolínea sobre la tarifa (630), no sobre el pago.

## Alternativa descartada
Confiar en el pago sin verificar (o aceptar cualquier monto sin comparar): rechazada porque elimina el control de que el pago cubre la tarifa y de que está confirmado.

## Si Booking envía nuestro monto en un campo propio
Si Booking agregara el monto que corresponde a nuestro proveedor en un campo de la respuesta (p. ej. `our_amount`), se configura sin tocar código: `BOOKING_PAYMENTS_FIELDS='{"amount":["our_amount"]}'` (los alias se prueban en orden y se admite la respuesta envuelta en `data`/`payment`/`pago`). Un valor dentro de `bookings[]` no se alcanza con esa lista (solo busca claves en el nivel raíz o en esos envoltorios); en ese caso haría falta un cambio de código y se pediría a Booking un campo plano. La prueba `PAY-37` cubre la configuración.

## Despliegue
`deploy-service.yml` usa `--set-env-vars` y `--set-secrets`, que **reemplazan** el conjunto completo en cada despliegue. Antes esta configuración estaba solo a mano en Cloud Run y se habría perdido en el siguiente push. Ahora `deploy-reservation.yml` declara:
- `extra_env_vars`: `BOOKING_PAYMENTS_BASE_URL=https://booking-core-api.azurewebsites.net/api/v2`, `BOOKING_PAYMENTS_AUTH_HEADER=x-api-key`.
- `extra_secrets`: `BOOKING_PAYMENTS_AUTH_VALUE=booking-payments-auth:latest` (la cuenta `reservation-service-runtime` ya tiene acceso).

No se declara `BOOKING_PAYMENTS_STATUS_MAP`: con `CAPTURED` en los estados por defecto basta el mapa por defecto.

### Si algún día hace falta un mapa propio
El valor es JSON con comas (`{"CONFIRMED":["A","B"]}`), y `--set-env-vars` separa las variables por coma. En `gcloud` se cambia el separador con la sintaxis `^DELIM^` al inicio del valor: `--set-env-vars "^@^A=1@BOOKING_PAYMENTS_STATUS_MAP={"CONFIRMED":["A","B"]}"`. El workflow compartido arma ese argumento con `extra_env_vars` separado por comas, así que habría que (a) agregar a `deploy-service.yml` una entrada opcional `extra_env_delimiter` y usar `"^${DELIM}^${EXTRA_ENV_VARS}"` cuando exista, y (b) declarar en `deploy-reservation.yml` `extra_env_delimiter: '@'` con `extra_env_vars` separado por `@`. Como ese cambio toca a todos los servicios, no se hace hasta que haga falta. Nunca configurar el mapa solo a mano en Cloud Run: el siguiente despliegue lo borraría.

## Consecuencias
- Contratos OpenAPI y `.proto` sin cambios; sin migraciones. v1 no cambia (sus pagos no pasan por Booking).
- Pruebas `PAY-31..PAY-37` (`microservices/reservation-service/test/f12a-booking-payments.spec.ts`), incluida la respuesta real de Booking (CAPTURED, 693 frente a 630 ⇒ aceptada; REFUNDED ⇒ rechazada).
