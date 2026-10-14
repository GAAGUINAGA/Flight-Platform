# ADR-F8-04 — Vista gRPC con identificador público de reserva
- Estado: Aceptado · Fecha: 2026-10-14 · Fase/Tarea: F8 / RSV-08, RSV-09, RSV-12, RSV-13

## Contexto

El agregado de Reservation usa `id` como identificador interno. La respuesta protobuf/OpenAPI exige `bookingId`; sin una traducción explícita, gRPC serializa ese campo como cadena vacía y los clientes no pueden consultar ni listar la reserva creada.

## Decisión

El adaptador gRPC normaliza cada entidad de reserva antes de responder: `id` se expone como `bookingId`, se conserva `pnr` y, cuando está disponible en el primer cambio, se expone `createdAt`. La normalización se aplica tanto a una reserva individual como a cada elemento de `items`.

## Consecuencias

El dominio y los casos de uso conservan su modelo interno. Todas las rutas gRPC de creación, detalle y listado entregan el identificador público requerido por Booking y por el contrato.
