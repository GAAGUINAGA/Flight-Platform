# Backend previo al front (B-1 y B-2): despliegue y verificación

Diseño: `docs/dev/adr/ADR-F12c-02-canal-web-y-api-admin-interna.md`. Sin migraciones ni cambios de `.proto`. Lo aplica el humano.

## Orden de despliegue
1. **Supabase (humano):** vuelve a ejecutar `docs/dev/f11a-supabase-auth-hook.sql` en el SQL Editor (agrega el claim `email_verified`). Los usuarios deben renovar la sesión (cerrar e iniciar sesión) para que el token lo traiga. Mientras no se aplique, el canal WEB rechaza con 403 `email-not-verified` (falla cerrado).
2. **Reservation (Cloud Run):** despliega desde `main` (workflow `deploy-reservation.yml`). Declara `WEB_PAYMENT_MODE=simulated` en `extra_env_vars`: habilita la **capacidad** del canal `WEB` en Reservation. En el arranque avisa del modo. No cambia nada para Booking (canal `BOOKING`).
3. **Gateway (Render):** despliega y configura las variables en el panel de Render. **Quien decide vender es el Gateway.**

## Variables del Gateway (Render)
| Variable | Valor | Efecto |
|---|---|---|
| `WEB_PAYMENT_MODE` | `simulated` para vender con pago simulado; **ausente o cualquier otro valor = la web no vende** | Interruptor del canal WEB. El Gateway avisa al arrancar (`WEB_PAYMENT_MODE no está definida…` / `…desconocido…` / `…simulated…`) |
| `WEB_MAX_ACTIVE_BOOKINGS` | entero ≥ 1, por defecto `5` | Reservas activas (no canceladas ni fallidas) por usuario |
| `WEB_MAX_PASSENGERS_PER_DAY` | entero ≥ 1, por defecto `10` | Pasajeros reservados por usuario por día UTC (en Ecuador el día se reinicia a las 19:00 hora local). El Gateway los envía a Reservation, que los aplica al insertar la reserva (ADR-F12c-03) |
| `WEB_REQUIRE_VERIFIED_EMAIL` | solo fuera de producción: `false` lo desactiva | En producción no se puede desactivar (el servicio no arranca) |

**Orden de despliegue (ADR-F12c-03):** primero Reservation (y ESB), después el Gateway. El Gateway envía los topes (`webMaxActiveBookings`, `webMaxPassengersPerDay`) con la petición del canal WEB y Reservation los aplica al insertar la reserva; no hay migraciones.

Para apagar las ventas de la web basta con quitar `WEB_PAYMENT_MODE` (o ponerle otro valor) en Render y reiniciar el Gateway; Reservation no necesita cambios.

## Verificación (la ejecuta el humano o el auditor, sin leer `.env`)
- Con el Gateway sin `WEB_PAYMENT_MODE`: `POST /api/v2/vuelos/bookings` con un token de `customer` → 422 `PAYMENT_NOT_AUTHORIZED`, `type` `…/web-payments-disabled`.
- Con `WEB_PAYMENT_MODE=simulated` y el correo confirmado: reserva con `paymentReference` `pay_ok_<uuid>` → 201 `CONFIRMED`, `salesChannel.partnerId = WEB_TEST`; con `pay_denied_…` → 422.
- Token de `customer` sin `email_verified` → 403 `…/email-not-verified`.
- Admin: `GET /api/admin/v1/web-bookings` lista esas reservas como de prueba; un `customer` o un `partner` reciben 403.
- Un token de partner (Booking) sigue creando reservas con su pago de Booking; con `pay_ok_*` no se acepta.
- API interna: `GET /api/admin/v1/flights?date=AAAA-MM-DD`, `GET/PUT /api/admin/v1/fares` solo con rol `admin` y `flights:admin`.

## Panel de administración
El panel ya no debe usar `/flights/v1/admin/*` (contrato v1 deprecado; sus rutas siguen existiendo y se retirarán con v1). Usa `/api/admin/v1/*` (lista de vuelos, tarifas, reservas de prueba) y, de v2, `GET /api/v2/vuelos/operaciones/vuelos`, `PATCH /api/v2/vuelos/flights/{n}/status` y `GET/PUT /api/v2/vuelos/promociones/contrato`.
