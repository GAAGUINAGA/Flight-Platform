# ADR-F11-15 — Notificación operativa de reservas afectadas (J6 admin)

## Contexto
`flight.schedule_changed` y `flight.cancelled` no se publicaban en el despliegue real: Operations armaba su runtime sin adaptador de Reservation (usaba uno falso y vacío) y `ListReservationsByFlightInstance` no devolvía `ownerId`, necesario para publicar por dueño, ni admitía `limit` ni `cursor`. Además `RecordOperationalUpdate` respondía 404 para un vuelo sin estado operativo previo.

## Decisión
1. **Proto (aditivo, reservation):** `ListReservationsByFlightInstanceRequest` añade `optional uint32 limit = 2` y `optional string cursor = 3`. La respuesta pasa a `ListReservationsByFlightInstanceResponse { repeated FlightReservationSummary items = 1; optional string next_cursor = 2; }`. `FlightReservationSummary` repite los campos 1–7 de `common.v1.BookingSummary` y añade `owner_id = 8`, de modo que sigue siendo compatible en el cable con clientes anteriores. `common.proto` no se toca.
2. **Reservation:** el RPC exige rol `system` (ningún owner ve reservas de otro); `limit` 1–50 (por defecto 20) y `cursor` UUID. Paginación estable: orden ascendente por `id` y el cursor es el último `id` entregado; la página siguiente son los `id` mayores. Un cursor desconocido no reinicia la lista.
3. **Operations:** `GrpcReservationGateway` (rol `system`) recorre todas las páginas de 50; está cableado en `createOperationsRuntime`. Si Reservation falla al notificar, el cambio operacional y el cierre de venta se mantienen, se registra `dependency=reservation code=<n>` (sin datos personales) y no se marcan las banderas de notificación, así que repetir la misma actualización reintenta. Un fallo al publicar en Webhooks conserva el comportamiento anterior (la operación falla y el reintento no vuelve a cerrar el vuelo).
4. **Operations:** `RecordOperationalUpdate` sobre un vuelo sin estado lo crea desde Inventory con `GetFlightInstance` (fecha = fecha UTC de salida programada); 404 solo si Inventory no conoce el vuelo.
5. **Gateway:** cada cuerpo, query y parámetro de las rutas admin se valida con un esquema Zod estricto antes de convertirse a protobuf; campo desconocido o tipo inválido ⇒ 400 `VALIDATION_FAILED` (el detalle nombra campos, nunca valores).

## Consecuencias
- Redespliegue: reservation-service y operations-service (esta decisión), pricing-service y webhooks-service (bloque A), y el Gateway.
- La entrega HTTP real a un receptor local no es posible porque la política de URL de Webhooks rechaza hosts privados; las pruebas verifican las entregas en la bandeja de salida (filas `delivery`) con `WebhookPayload` validado con Ajv.
- Las reservas CANCELLED también reciben el aviso de vuelo; filtrar por estado queda para BACKLOG.
