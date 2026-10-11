# ADR-F4-03 — Códigos públicos para errores genéricos del Gateway

- Estado: Aceptado
- Fecha: 2026-10-10
- Fase/Tarea: F4 / GW-06

## Contexto

`NOT_FOUND` e `INTERNAL_ERROR` son detalles internos de gRPC y no pertenecen al enum público `ProblemDetails.code` del OpenAPI.

## Decisión

El filtro HTTP conserva el status HTTP correcto para 404, 405 y 500, pero emite `VALIDATION_FAILED` como único código público genérico. Los detalles son genéricos; `UNAVAILABLE` y `DEADLINE_EXCEEDED` responden 503 con `Retry-After`.

## Consecuencias

Los consumidores no reciben códigos fuera del contrato ni mensajes internos. Las rutas de negocio seguirán mapeando códigos públicos específicos cuando existan.
