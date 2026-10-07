# ADR-0-05 — Representación de respuestas públicas en gRPC
- Estado: Aceptado · Fecha: 2026-10-06 · Fase/Tarea: 0 / F0-04 y F0-05

## Contexto
El plan enumera RPCs y exige respuestas mapeables al OpenAPI, pero no define todos los campos del contrato interno ni cómo transportar listas de nivel superior.

## Decisión
Definir los DTOs públicos reutilizables en `common.v1`; cada RPC usa mensajes tipados para los campos del OpenAPI. Las respuestas HTTP que son arrays se envuelven en un mensaje gRPC con un campo `repeated`, que el Gateway desenvuelve. Los campos internos adicionales, como `flightInstanceId`, se omiten al construir el DTO HTTP.

## Consecuencias
El Gateway debe realizar mapeo explícito, incluida la anidación de `FlightOffer.airline`, la conversión de enums y el enmascaramiento de secretos. Tras el freeze, los cambios de `.proto` serán solo aditivos y tendrán ADR.
