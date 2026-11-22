# Sesión dev — fix compra en ejecutiva, deploy — 2026-11-21 #1
- Agente: humano (evidencia ejecutada por el humano) · Commit en main: f750ed9

## Objetivo de la sesión
Desplegar la corrección de la compra en clase ejecutiva (fix/compra-ejecutiva, aprobada en audit-50 tras audit-46 a audit-49) y quitar la mitigación HIDDEN_CABINS.

## Registro
| Tarea | Acción | Resultado |
|---|---|---|
| Merge | fix/compra-ejecutiva fusionada con --squash en main (f750ed9 fix(reservation,ancillaries,inventory,web): compra en cabina ejecutiva (cabina por tramo, compensaciones y reglas de pago) y limite de maletas en la web); el código que entra es exactamente el de la rama aprobada (diff vacío); sin contratos ni migraciones; conflictos solo en BACKLOG.md, resueltos conservando ambos lados (si los hubo). Workflows en verde; web con Manual Deploy. | Hecho |
| Servicios | inventory-service -> inventory-service-00030-tbb	True; ancillaries-service -> ancillaries-service-00024-jtw	True; reservation-service -> reservation-service-00034-k2c	True. Gateway 200. Sin errores desde el despliegue. | Hecho |
| HIDDEN_CABINS | Variable borrada en Render (flight-gateway); la búsqueda pública v2 vuelve a ofrecer BUSINESS. | Hecho |
| Prueba en producción | Compra en Business · FLEX con asiento de ejecutiva y 1 maleta (el selector ofreció solo 0 y 1), confirmada con su PNR y cancelada después | <resultado> |
| Booking | Aviso del despliegue y de la vuelta de BUSINESS; se les contó que el SEAT_CABIN_MISMATCH atribuido a ellos semanas atrás probablemente fue este defecto, y se pidió una compra de prueba en ejecutiva. | Hecho |

## Pendientes / bloqueos
- La compra de prueba de Booking en ejecutiva.
- El formulario de pasajeros (validación al escribir y errores por campo) y el resto del BACKLOG.

## Cierre
- Estado: listo para auditoría (despliegue).