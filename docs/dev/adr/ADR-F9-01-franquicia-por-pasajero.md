# ADR-F9-01 — Registro de franquicia por pasajero e itinerario
- Estado: Aceptado · Fecha: 2026-10-16 · Fase/Tarea: F9 / tarea 0

## Contexto
Ancillaries no conoce la franquicia adquirida ni registra al dueño cuando la reserva no incluye asientos ni equipaje adicional. La selección de tarifa está en `GetPriceLock`; el snapshot de `GetOfferHold` contiene todas las opciones de la oferta.

## Decisión
Añadir un RPC interno para registrar, por reserva, pasajero e itinerario, la cantidad incluida, incluso cero. Guardarla separada de las compras adicionales y devolverla en un campo aditivo de la opción gRPC. Reservation obtiene la selección real de Pricing, conserva solo la opción elegida y registra la franquicia al crear la reserva; para infantes la cantidad es cero. El registro fija el owner y es idempotente para los mismos datos.

## Consecuencias
Los cambios protobuf son aditivos y no alteran OpenAPI. El tratamiento de `NOT_FOUND` de ADR-F8-06 se conserva para reservas anteriores sin registro. Una selección o franquicia ausente no se sustituye por una tarifa inventada.
