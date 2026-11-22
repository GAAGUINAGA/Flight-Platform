# Sesión dev — formulario de pasajeros, deploy — 2026-11-22 #1
- Agente: humano (evidencia ejecutada por el humano) · Commit en main: b5e970f

## Objetivo de la sesión
Desplegar el formulario de pasajeros (reglas compartidas, filtrado, selectores y fechas con rango) y los errores por campo desde el servidor (invalidParams), aprobados en audit-52.

## Registro
| Tarea | Acción | Resultado |
|---|---|---|
| Booking | Aviso previo del patrón de nombres (más estricto) y de los invalidParams nuevos (aditivos; sin cambios en el contrato v2). | Hecho |
| Merge | fix/formulario-pasajeros fusionada con --squash en main; el código que entra es exactamente el de la rama aprobada (diff vacío); sin contratos ni migraciones. Workflows en verde; gateway Live; web con Manual Deploy. | Hecho |
| Servicios | reservation-service -> reservation-service-00035-rcj	True; esb-service -> esb-service-00014-958	True; graphql-service -> graphql-service-00010-k96	True. Gateway y web 200, cabeceras de seguridad presentes, sin errores desde el despliegue. | Hecho |
| Prueba en producción | filtrado del nombre al pegar; fechas con rango; nacionalidad con la bandera dentro de la caja; teléfono con selector; cédula de 10 dígitos con Ecuador; una compra completa confirmada y cancelada después | <resultado> |

## Pendientes / bloqueos
- La respuesta de Booking al aviso, y su compra de prueba en ejecutiva.
- El entorno local (los datos que rompen PST-03/04 y la prueba de Pricing) y el repaso del BACKLOG.

## Cierre
- Estado: listo para auditoría (despliegue).