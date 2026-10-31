# ADR-F12-08 — Stock hacia Booking por gRPC (cola con reintento)
- Estado: Aceptado · Fecha: 2026-10-27 · Fase/Tarea: F12a P5
## Contexto
El contrato v2 (§9) define `inventory.InventoryStockService/PushStockUpdate`: la aerolínea informa a Booking los asientos libres por vuelo y cabina. Booking no confirmó dirección, TLS ni llave: todo es configurable y por defecto queda apagado.
## Decisión
- `contracts/proto/external/booking/inventory.proto` es copia literal del contrato (no es servicio nuestro; el cliente usa `@grpc/proto-loader`, no el generador).
- **Qué se envía:** cada cambio que mueve la capacidad (hold, liberación o vencimiento del hold, reserva, cancelación, fallo de pago, cambio de fecha) encola el vuelo en `gateway.stock_outbox`. El envío siempre lee la disponibilidad ACTUAL (`getFlightInstance` + `queryAvailability`) y manda un mensaje por cabina: `item_id = <vuelo>-<cabina>`, fecha y hora locales del aeropuerto de salida (zonas en `AIRPORT_TIMEZONES`, Ecuador por defecto, UTC si se desconoce), `available_units` (0 si el vuelo está cerrado). Juntar o repetir envíos es inocuo.
- **Fiabilidad:** el envío es de mejor esfuerzo y nunca rompe la operación. Los fallos se reintentan con backoff (1, 2, 5, 15, 30, 60, 120 min) y tras 8 intentos la fila queda `FAILED`. Un scheduler (`stock-sync`, con el lock durable existente) drena la cola. El vencimiento de un hold se encola a `expiresAt + 60 s`.
- **Configuración:** `BOOKING_STOCK_API_KEY` (sin ella queda desactivado y se registra un aviso al arrancar), `BOOKING_STOCK_GRPC_URL`, `BOOKING_STOCK_TLS` (por defecto `true`; `false` solo con `INTEGRATION_LOCAL=true`), `BOOKING_STOCK_TLS_CA_FILE`, `BOOKING_STOCK_TIMEOUT_MS`, `STOCK_SYNC_ENABLED`. Metadata: `x-api-key` y `x-correlation-id`. La llave nunca se registra.
## Consecuencias
Migración `20261027000000_gateway_stock_outbox` (esquema `gateway`, la aplica el humano). `StreamInventoryChanges` queda para F12b. Booking puede ver varios mensajes seguidos por una compra (hold y reserva): son estados sucesivos del mismo número.
