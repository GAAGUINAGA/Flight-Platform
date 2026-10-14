# ADR-F8-03 — Snapshot del hold en GetOfferHold
- Estado: Aceptado · Fecha: 2026-10-12 · Fase/Tarea: F8 / RSV-12, RSV-13

## Contexto

Reservation debe validar el mix de pasajeros y conservar el itinerario fijado antes de crear una reserva. `GrpcPricingGateway` solo recibía estado, vencimiento y precio desde `GetOfferHold`, por lo que inventaba un mix vacío y la validación rechazaba toda reserva real.

## Decisión

Extender aditivamente `GetOfferHoldResponse` con `passengers_breakdown` e `itineraries`. Pricing conserva el mix junto al snapshot del offer en el price lock y devuelve ambos. Reservation consume esos campos sin valores de respaldo inventados.

## Consecuencias

Los clientes existentes siguen siendo compatibles por ser campos nuevos. La reserva valida contra el hold real y puede emitir tickets con sus itinerarios bloqueados.
