# ADR-F11-04 — Detalle de reserva y propiedad de tickets
- Estado: Aceptado · Fecha: 2026-10-20 · Fase/Tarea: F11 / PLT-C y PLT-D
## Contexto
El RPC de creación puede omitir la fecha requerida por BookingDetail cuando el pago está pendiente. El RPC de listado de tickets devuelve una lista vacía cuando la reserva pertenece a otro usuario.
## Decisión
Si la creación no devuelve fecha, el Gateway consulta el detalle persistido con el mismo propietario. Antes de listar tickets comprueba la reserva con ese propietario.
## Consecuencias
Estas rutas pueden realizar una consulta gRPC adicional. La autorización y la fecha se obtienen del servicio dueño de las reservas; los fallos de esa consulta se propagan de forma segura.
