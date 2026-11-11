# Sesión dev — asientos apartados en el hold (deploy) — 2026-11-11 #1
- Agente: humano (evidencia ejecutada por el humano) · Commit en main: cae353b

## Objetivo de la sesión
Desplegar los asientos apartados en el hold (assignedSeats con 409 SEAT_TAKEN, HELD en el mapa y CHECKED_IN tras el check-in), acordados con Booking (ADR-F12b2fix-01), con la migración calificada (ADR-F12b1fix-03).

## Registro
| Tarea | Acción | Resultado |
|---|---|---|
| Auditorías | audit-17 RECHAZADA (migración sin esquema explícito); corregida y audit-18 APROBADA. | Hecho |
| Migración en Supabase | 20261109120000_seat_hold aplicada antes del push con node --env-file=.env.supabase; Datasource pooler.supabase.com, esquema ancillaries; up to date. | Hecho |
| Merge y deploy | feat/asientos-held fusionada con --squash desde main; lint con los verificadores de SQL y de variables en verde; workflows de todos los servicios en verde (cambiaron los .proto). | Ver revisiones |
| Verificación | Ocho servicios con revisión nueva y Ready; ESB HEALTHY con el bus UP y outbox en 0; sin errores de columnas o tablas; smokes J1, J5, J6, administración y webhooks en OK. | Ver evidencia |
| Booking | Los tres escenarios están cubiertos por held-seats.e2e.spec.ts (verificados en audit-17 y audit-18). La prueba de Booking en la nube queda pendiente de su disponibilidad. | Pendiente |

## Evidencia




## ADRs creados
Ninguno en esta sesión.

## Pendientes / bloqueos
- Prueba de Booking de sus tres escenarios en la nube.
- Observaciones de audit-17 y audit-18 en BACKLOG.md.

## Cierre
- Estado: listo para auditoría (despliegue).