# ADR-1-02 ? Expiraci?n perezosa y TTL del hold
- Estado: Aceptado ? Fecha: 2026-10-06 ? Fase/Tarea: F1 / INV-07, INV-09, INV-11

## Contexto
Los holds expiran de forma perezosa (D-04) y el plan no fija qu? hacer con `expires_at` del request, ni cu?ndo se restituye la capacidad de un hold vencido que nadie barri?.

## Decisi?n
- `expires_at` es opcional; se usa `min(expires_at, now + HOLD_TTL_MINUTES)` (20 por defecto). Un valor ya vencido ? `VALIDATION_FAILED`.
- `CreateHold` y `QueryAvailability` expiran y restituyen, dentro de su transacci?n, los holds vencidos de los vuelos implicados; `ConsumeHold` de un hold vencido lo marca `EXPIRED`, restituye y responde `OFFER_NO_LONGER_AVAILABLE`; `ReleaseHold` de un vencido lo marca `EXPIRED` (idempotente).
- Todas las rutas que expiran publican `hold.expired` (`data = { status: "EXPIRED" }`, GAP-025) tras confirmar la transacci?n; un fallo del publicador no revierte la expiraci?n.
- Las filas de capacidad se actualizan siempre en orden (vuelo, cabina) y la unidad de trabajo reintenta ante deadlock o conflicto de unicidad.

## Consecuencias
La correcci?n no depende del scheduler. `GetHold` no escribe: informa el estado efectivo por reloj.
