# Sesión dev — búsqueda por día local (deploy) — 2026-11-08 #1
- Agente: humano (evidencia ejecutada por el humano) · Commit en main: 8a61737

## Objetivo de la sesión
Desplegar la búsqueda por fecha local del aeropuerto de origen (NFR-TI-01, ADR-F12b1fix-02), corregir operational_flights.date en Supabase y retirar hello de Google Cloud.

## Registro
| Tarea | Acción | Resultado |
|---|---|---|
| Auditorías | audit-8 y audit-9 RECHAZADAS por deploy-hello.yml (prisma:generate); resuelto retirando hello del repositorio; audit-10 APROBADA. | Hecho |
| Conteo previo en Supabase | fix-operational-flight-dates.cjs en modo conteo con la conexión de operations a Supabase: 83 vuelos operativos con la fecha a corregir. | Hecho |
| Merge y deploy | fix/busqueda-dia-local fusionada con --squash desde main; workflows de los siete microservicios, el ESB y el gateway en verde (cambió packages/shared); Render desplegó el gateway. | Ver revisiones |
| Corrección de datos | Justo después del despliegue: fix-operational-flight-dates.cjs --yes en Supabase (<N> corregidos); nuevo conteo: 0 por corregir. | Hecho |
| Retiro de hello | Borrados el servicio hello-service de Cloud Run, la cuenta hello-service-runtime y sus imágenes del Artifact Registry. | Hecho |
| Evidencias | ESB y dependencias, revisiones, ausencia de hello, caso nocturno LIM → MAD por fecha local de Lima, búsqueda diurna UIO → GYE, ausencia de errores 42P01/P2010 y regresión de v1 con tokens reales de Supabase. | Ver evidencia |

## Evidencia

# Evidencias de despliegue: búsqueda por día local - 2026-11-08 11:39

## ESB: dependencias con llave
{"status":"HEALTHY","dependencias":[{"nombre":"inventory-service","status":"UP","latencia_ms":71},{"nombre":"pricing-service","status":"UP","latencia_ms":103},{"nombre":"ancillaries-service","status":"UP","latencia_ms":100},{"nombre":"reservation-service","status":"UP","latencia_ms":71},{"nombre":"ticketing-service","status":"UP","latencia_ms":101},{"nombre":"operations-service","status":"UP","latencia_ms":77},{"nombre":"webhooks-service","status":"UP","latencia_ms":78}],"expected":7,"correlationId":"54d9c655-4313-40ae-86b1-485be3e7f52c"}

## Commit desplegado (origin/main)
8a61737 fix: busqueda por fecha local del aeropuerto de origen (NFR-TI-01) y retiro de hello


## Revisiones y estado Ready
inventory-service -> inventory-service-00021-f8c	True
pricing-service -> pricing-service-00014-m9q	True
ancillaries-service -> ancillaries-service-00015-k6q	True
reservation-service -> reservation-service-00019-4bj	True
ticketing-service -> ticketing-service-00022-zmq	True
webhooks-service -> webhooks-service-00018-4gk	True
operations-service -> operations-service-00012-n8r	True
esb-service -> esb-service-00003-cjx	True


## hello retirado de Cloud Run (esperado vacío)


## Caso nocturno LIM ? MAD en la nube (el vuelo de las 01:30Z debe aparecer en la búsqueda del día anterior, hora de Lima)
Búsqueda del 2026-11-13 (fecha local de Lima) -> ofertas: 1 · salidas: 2026-11-14T01:30:00.000Z
Búsqueda del 2026-11-14 (fecha local de Lima) -> ofertas: 1 · salidas: 2026-11-15T01:30:00.000Z
Búsqueda del 2026-11-15 (fecha local de Lima) -> ofertas: 1 · salidas: 2026-11-16T01:30:00.000Z


## Búsqueda diurna UIO ? GYE (sin cambios esperados)
UIO ? GYE del 2026-11-13 -> ofertas: 2
UIO ? GYE del 2026-11-14 -> ofertas: 2


## Errores 42P01 o P2010 en los servicios (últimos 30 min, esperado 0)
0

## v1 health
200

## v2 health
200

## v1 reservas sin token (esperado 401)
401

## v1 smoke J1 (compra)
OK   sin token
OK   search
OK   seatmap
OK   hold
OK   booking
OK   detalle
OK   tickets


## v1 smoke J5 y J6 (postventa y check-in)
OK   J5 búsqueda
OK   J5 hold
OK   J5 reserva
OK   J5 equipaje opciones
OK   J5 equipaje
OK   J5 buscar cambio
OK   J5 cambio
OK   J5 cotización
OK   J5 cancelación
OK   J6 búsqueda
OK   J6 mapa
OK   J6 hold
OK   J6 reserva
OK   J6 check-in
OK   J6 pases


## v1 smoke administración y webhooks
OK   admin sin token
OK   webhooks sin token
OK   admin vuelos
OK   admin tarifas
OK   admin cuerpo con campo desconocido
OK   webhook registrado
OK   webhooks listados
OK   secreto enmascarado
OK   webhook eliminado
OK   webhook ajeno o inexistente




## ADRs creados
Ninguno en esta sesión (ADR-F12b1fix-02 en la rama).

## Pendientes / bloqueos
- Observaciones de audit-8 y audit-10 en BACKLOG.md.
- Siguiente entrega: F12b-2 (bus de eventos).

## Cierre
- Estado: listo para auditoría (despliegue).