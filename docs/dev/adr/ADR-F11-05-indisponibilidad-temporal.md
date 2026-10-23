# ADR-F11-05 — Código público para indisponibilidad temporal
- Estado: Aceptado (revisado 2026-10-22) · Fecha: 2026-10-22 · Fase/Tarea: F11 / tarea 0
## Contexto
El enum de `ProblemDetails` no contiene un código genérico de indisponibilidad y el contrato no documenta respuestas 503. El PLAN (GAP-031 y la tabla del catálogo de errores) asigna `RATE_LIMIT_EXCEEDED` al 503 (gRPC `UNAVAILABLE`), y `RESOURCE_EXHAUSTED` al 429. El catálogo compartido está en `packages/shared/src/errors.ts`. Una primera versión de este ADR usó `VALIDATION_FAILED` por una instrucción anterior, que el humano anuló.
## Decisión
Todas las respuestas 503 del Gateway usan el código `RATE_LIMIT_EXCEEDED` con `Retry-After: 5`, conforme a GAP-031: almacén del limitador inaccesible y dependencia agotada (`DEADLINE_EXCEEDED`) o no disponible (`UNAVAILABLE`), incluidas las operaciones que orquestan servicios (createReservation y postventa). `VALIDATION_FAILED` queda solo para entradas inválidas y los casos que fija ADR-F4-03 (p. ej. 409/422 de idempotencia). Nunca `INTERNAL_ERROR` en estos casos. El 429 sigue siendo el límite superado.
## Consecuencias
Estado 503 y cabecera `Retry-After` distinguen la indisponibilidad transitoria del 429, que es el límite superado; el código compartido es el que prevé el plan y el enum del contrato. No se modifica el contrato ni Reservation: este solo propaga el estado gRPC y el Gateway fija el código.
