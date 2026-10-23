# ADR-F11-07 — Plazos de operaciones orquestadas
- Estado: Aceptado · Fecha: 2026-10-22 · Fase/Tarea: F11 / tarea 0
## Contexto
En Render se observaron compras de 6–7 s en frío. El plazo compartido actual es 5 s por llamada gRPC, incluido cada acceso de Reservation a sus dependencias y la llamada del Gateway a Reservation.
## Decisión
`GATEWAY_ORCHESTRATION_DEADLINE_MS=30000` por defecto para creación y operaciones de postventa que orquestan dependencias; las demás llamadas conservan 5000 ms. En Reservation, `RESERVATION_DEPENDENCY_DEADLINE_MS=10000` por defecto cubre Pricing, Inventory, Ancillaries, Ticketing y Webhooks; `RESERVATION_<SERVICIO>_DEADLINE_MS` permite ajustar cada dependencia. La composición real prueba que un reintento con la misma clave recupera la reserva creada después del timeout.
## Consecuencias
Un arranque en frío de 6–7 s cabe en la espera del Gateway, pero el límite no garantiza por sí solo que las dependencias terminen ni que la saga quede recuperable. El timeout y la idempotencia deben verificarse antes de cerrar la tarea.

Mantener una instancia mínima en Reservation o sus dependencias puede reducir arranques en frío, pero mantiene capacidad facturable aun sin tráfico y no elimina fallos o demoras de red. La configuración y evaluación de costo quedan a cargo del humano; no se cambian servicios desplegados en esta sesión.
