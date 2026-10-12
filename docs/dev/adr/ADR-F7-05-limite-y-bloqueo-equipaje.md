# ADR-F7-05 — Límite y serialización de equipaje adicional
- Estado: Aceptado · Fecha: 2026-10-11 · Fase/Tarea: F7 / ANC-08, ANC-09

## Contexto
El RPC actual de Pricing ofrece el precio adicional, pero no transporta la franquicia comprada ni Ancillaries tiene todavía una proyección de Reservation. Aun así debe impedir compras concurrentes que excedan el máximo.

## Decisión
Ancillaries usa `BAGGAGE_MAX_ALLOWED` (3 por defecto) como límite MVP de equipaje adicional por pasajero e itinerario. La compra toma un advisory transaction lock de PostgreSQL derivado de esa terna, suma filas activas y crea la fila dentro de la misma transacción.

## Consecuencias
No se excede el máximo bajo concurrencia. La franquicia por fare brand se integrará cuando Reservation publique su proyección; hasta entonces el límite es configurable y no se fija en código.
