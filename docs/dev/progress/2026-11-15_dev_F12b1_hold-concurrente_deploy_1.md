# Sesión dev — corrección de holds concurrentes en Pricing, deploy — 2026-11-15 #1
- Agente: humano (evidencia ejecutada por el humano) · Commit en main: 8a39a38

## Objetivo de la sesión
Desplegar la corrección de los holds simultáneos de la misma oferta (Pricing) y del traductor de errores compartido.

## Registro
| Tarea | Acción | Resultado |
|---|---|---|
| Auditoría | audit-36 APROBADA. | Hecho |
| Merge | fix/pricing-hold-concurrente fusionada con --squash desde main; sin cambios en contratos, gateway, GraphQL, web ni migraciones; todos los workflows de los servicios en verde (cambió packages/shared). | Hecho |
| Verificación | Los nueve servicios con revisiones nuevas; ESB y servicios HEALTHY; sin errores; prueba en la web con dos cuentas compitiendo por el mismo asiento (ver evidencia). | Ver evidencia |

## Evidencia

# Evidencias de despliegue: holds concurrentes en Pricing - 2026-11-15 09:56

## Commit desplegado (origin/main)
8a39a38 fix(pricing): holds concurrentes de la misma oferta sin INTERNAL_ERROR, precio bloqueado idempotente y errores de catalogo de dependencias en el traductor compartido

## Servicios (redesplegados por el cambio de packages/shared)
inventory-service ->inventory-service-00028-rdn	True
pricing-service ->pricing-service-00021-8m2	True
ancillaries-service ->ancillaries-service-00022-9tw	True
reservation-service ->reservation-service-00031-fzr	True
ticketing-service ->ticketing-service-00029-m2r	True
webhooks-service ->webhooks-service-00025-45b	True
operations-service ->operations-service-00019-mdf	True
esb-service ->esb-service-00011-xm4	True
graphql-service ->graphql-service-00007-46q	True
ESB y servicios HEALTHY. Sin errores desde el despliegue.

## Prueba en el navegador (humano)
Dos cuentas eligiendo la misma oferta y el mismo asiento casi a la vez; una siguio y la otra recibio 'Ese asiento acaba de ser ocupado. Elige otro.' sin error interno; lo apartado se cancelo despues

## Booking
Aviso enviado. Su compra de prueba queda pendiente de su disponibilidad (su contrato no cambio).



## ADRs creados
Ninguno en esta sesión (ADR-F12b1fix-04 en la rama).

## Pendientes / bloqueos
- F12c-4: crear vuelos con su tarifa, buscar una reserva por PNR y el check-in hecho por la aerolínea.
- La compra de prueba de Booking tras este despliegue.

## Cierre
- Estado: listo para auditoría (despliegue).