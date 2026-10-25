# ADR-F11-10 — Recuperación acotada de check-ins
- Estado: Aceptado · Fecha: 2026-10-23 · Fase/Tarea: F11c-1 / tarea 0
## Contexto
Un proceso puede terminar tras reservar un check-in o tras persistirlo y antes de publicar `booking.checked_in`. ADR-F10-05 exige una recuperación adicional para esos estados.
## Decisión
Operations expone el RPC aditivo interno `RecoverCheckIns`, exclusivo del rol `system`. Reclama por actualización condicional los `IN_PROGRESS` más antiguos que `CHECKIN_RECOVERY_STALE_MINUTES` (10 por defecto), limpia sólo sus pases provisionales y reintenta el caso de uso. Persiste `eventPublished` para reintentar publicaciones pendientes en lotes acotados.
## Consecuencias
El RPC no se expone por HTTP. El cambio de proto redeplegará Operations y los consumidores que cargan `operations.proto`, incluido el Gateway. La entrega sigue siendo al menos una vez si el proceso cae después de publicar y antes de marcar la fila.
