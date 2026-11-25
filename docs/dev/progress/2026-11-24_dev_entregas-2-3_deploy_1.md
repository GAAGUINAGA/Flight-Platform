# Sesión dev — despliegue de las entregas 2 y 3 — 2026-11-24 #1
- Agente: humano (evidencia ejecutada por el humano)

## Objetivo de la sesión
Desplegar la entrega 2 (búsqueda por PNR con disponibilidad, aprobada en audit-55) y, más adelante, la entrega 3 (cumplir el contrato con Booking), con una sola auditoría de despliegue para ambas.

## Registro
| Tarea | Acción | Resultado |
|---|---|---|
| Entrega 2: merge | feat/pnr-disponibilidad fusionada con --squash en main (9eda48a); el código que entra es exactamente el de la rama aprobada (diff vacío); contrato con Booking sin cambios; sin migraciones. Workflows en verde; gateway Live; web con Manual Deploy. | Hecho |
| Entrega 2: producción | GraphQL con revisión nueva Ready; gateway y web 200; sin errores desde el despliegue. En el panel, la búsqueda de un PNR real se muestra como siempre, con su estado de check-in. El caso de Operations caído quedó verificado en local (no se provoca en producción). | El buscador funciona cuando se coloca el PNR completo, no solo un par de caracteres. Permite realizar el checkin. Cuando Operations esta caído, muestra el PNR pero no permite checkinear |
| Entrega 3 | Pendiente (en desarrollo; el despliegue espera la respuesta de Booking al aviso). | Pendiente |

## Cierre
- Estado: en curso (se marca "listo para auditoría (despliegue)" al desplegar la entrega 3).