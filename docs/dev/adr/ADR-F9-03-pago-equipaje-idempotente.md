# ADR-F9-03 — Compra de equipaje y pago idempotentes
- Estado: Aceptado · Fecha: 2026-10-16 · Fase/Tarea: F9 / PST-02, PST-SEC-02

## Contexto
La compra de equipaje atraviesa Reservation y Ancillaries. Un reintento tras perder la respuesta no debe volver a comprar ni acreditar la misma referencia de pago en otra operación.

## Decisión
Reservation persiste una operación por owner y clave de idempotencia y registra su referencia en `payment_usages`, compartida con la compra inicial. Un identificador estable de operación se añade opcionalmente a `PurchaseBaggage`; Ancillaries lo guarda con el resultado y devuelve el mismo resultado al repetir la solicitud idéntica. `ExtraBaggage` añade un `passenger_id` opcional para que el equipaje adicional comprado al reservar no pierda su pasajero al cruzar gRPC. El precio se toma del snapshot de la tarifa elegida al crear la reserva, ya que la oferta de Pricing expira antes de la vida de la reserva.

## Consecuencias
Los cambios protobuf son aditivos. Se necesita migrar los esquemas de ambos servicios y desplegar Ancillaries antes de Reservation. La persistencia de cada fase permite reanudar la operación si se pierde una respuesta sin duplicar el equipaje.
