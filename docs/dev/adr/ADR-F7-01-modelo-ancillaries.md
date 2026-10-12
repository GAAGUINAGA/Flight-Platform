# ADR-F7-01 — Modelo persistente y cliente Prisma aislado de Ancillaries
- Estado: Aceptado · Fecha: 2026-10-11 · Fase/Tarea: F7 / ANC-01, ANC-02, ANC-03

## Contexto
Ancillaries necesita conservar plantillas físicas de asientos, asignaciones con exclusión de colisiones activas y equipaje, sin acceder a esquemas de otros servicios. El plan exige un cliente Prisma aislado desde el inicio.

## Decisión
El cliente Prisma se genera en `src/infrastructure/persistence/prisma-client`. `seat_layouts` guarda una fila por asiento y aeronave; `seat_assignments` conserva IDs externos opacos, owner y estado; `baggage_items` conserva el equipaje por reserva/pasajero/itinerario. La migración PostgreSQL crea el índice único parcial de asignaciones activas con SQL explícito, porque Prisma no representa predicados parciales.

## Consecuencias
La colisión de asientos se protege en la base incluso ante procesos concurrentes. El artefacto generado queda ignorado y el build deberá copiarlo al directorio `dist` para el runtime.
