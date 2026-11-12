# Sesión dev — F12c backend previo al front (deploy) — 2026-11-12 #1
- Agente: humano (evidencia ejecutada por el humano) · Commit en main: a9ae6f7

## Objetivo de la sesión
Desplegar el canal de pago WEB (con los topes aplicados por Reservation) y la API interna de administración /api/admin/v1, y habilitar la venta por la web al final.

## Registro
| Tarea | Acción | Resultado |
|---|---|---|
| Auditorías | audit-20, 21 y 22 RECHAZADAS (carrera de los topes; desincronización del contador, que llevó al rediseño; Reservation fallaba abierto sin topes); decisión del humano tras tres rechazos (PLAN §4.4): corrección acotada; audit-23 APROBADA. | Hecho |
| Hook de Supabase | Aplicado durante la verificación (claim email_verified, con la consulta protegida); inicio de sesión comprobado para customer y admin. | Hecho |
| Merge y deploy | feat/F12c-backend-previo fusionada con --squash desde main; sin migraciones; workflows de todos los servicios en verde (cambiaron shared y el .proto); gateway Live en Render. | Ver revisiones |
| Verificación | Ocho servicios Ready; Reservation con WEB_PAYMENT_MODE=simulated y sin perder ESB_URL ni la configuración de pagos de Booking; API interna 401/403/200; ESB HEALTHY; sin errores; smokes en OK; compra de Booking completa. | Ver evidencia |
| Habilitación | WEB_PAYMENT_MODE=simulated en Render al final; el aviso de canal deshabilitado desapareció. | Hecho |

## Evidencia

# Evidencias de despliegue: backend previo al front (canal WEB y API interna) - 2026-11-12 10:03

## Commit desplegado (origin/main)
a9ae6f7 feat(gateway,reservation): [F12c] canal de pago WEB con topes en Reservation y API interna de administracion /api/admin/v1


## Revisiones
inventory-service -> inventory-service-00024-lzl	True
pricing-service -> pricing-service-00017-472	True
ancillaries-service -> ancillaries-service-00018-nb4	True
reservation-service -> reservation-service-00027-n26	True
ticketing-service -> ticketing-service-00025-279	True
webhooks-service -> webhooks-service-00021-552	True
operations-service -> operations-service-00015-pzg	True
esb-service -> esb-service-00007-5jn	True


## API interna de administración
sin token: 401 (esperado 401)
con token de cliente: 403 (esperado 403)
con token de admin: 200 (esperado 200)

## v1 smoke J1
OK   sin token
OK   search
OK   seatmap
OK   hold
OK   booking
OK   detalle
OK   tickets


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
Ninguno en esta sesión (ADR-F12c-02 y F12c-03 en la rama).

## Pendientes / bloqueos
- Pruebas con tokens reales S-1 a S-6 (diseño F12c-0 §5.4), antes de F12c-1.
- Observaciones de audit-20 a audit-23 en BACKLOG.md.

## Cierre
- Estado: listo para auditoría (despliegue).