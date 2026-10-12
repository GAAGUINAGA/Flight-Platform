# ADR-F8-01 — Modelo de Reservation y cliente Prisma aislado
- Estado: Aceptado · Fecha: 2026-10-11 · Fase/Tarea: F8 / RSV-01, RSV-02

## Contexto
Reservation debe persistir su saga, pasajeros, historial y el uso único de una referencia de pago sin acceder a esquemas de otros servicios.

## Decisión
El cliente Prisma se genera en `src/infrastructure/persistence/prisma-client`. `reservations` conserva el agregado y sus valores de saga; `reservation_passengers` y `reservation_changes` son hijos del agregado; `payment_usages` impone una referencia de pago única mediante una restricción de base de datos.

## Consecuencias
La idempotencia por owner y el pago único quedan protegidos por índices únicos. La migración solo crea objetos del esquema que selecciona `DATABASE_URL`.
