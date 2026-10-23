# ADR-F11-08 — Reintento después de agotar el plazo
- Estado: Aceptado · Fecha: 2026-10-22 · Fase/Tarea: F11 / tarea 0
## Contexto
Un timeout del Gateway no implica que Reservation haya detenido la compra. Mantener la clave en `IN_PROGRESS` impedía recuperar el resultado con la misma clave.
## Decisión
Ante `UNAVAILABLE` o `DEADLINE_EXCEEDED`, el Gateway cambia la clave a `RETRYABLE` conservando el hash. El siguiente intento idéntico reclama el registro de forma atómica; un cuerpo diferente sigue rechazándose. Reservation continúa garantizando la unicidad de la compra por owner y clave. Al reanudar una emisión de tickets, Reservation confirma los asientos solicitados antes de confirmar la reserva.
## Consecuencias
Un solo reintento concurrente puede reclamar la clave y el resultado puede recuperarse si la compra terminó después del timeout. La prueba real simula un retraso, verifica 503, espera la reserva y recupera la misma compra; otra prueba real agota el plazo después de emitir tickets y comprueba la recuperación del asiento. Las fallas de proceso antes de actualizar el registro siguen sujetas al TTL de idempotencia existente.
