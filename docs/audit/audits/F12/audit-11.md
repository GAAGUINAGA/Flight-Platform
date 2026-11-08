# Auditoría F12 — #11
- Fecha: 2026-11-08 · Commit auditado: 8a61737c885606ade61c363c7ee56b970e9444d2 · Veredicto: APROBADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ Despliegue: ocho revisiones `Ready` con 100 % del tráfico; `hello-service` ausente; búsquedas LIM → MAD y UIO → GYE correctas. Corrección de datos y smoke v1: evidencia humana en `docs/dev/progress/2026-11-08_dev_F12b1fix_deploy_1.md`. |
| Pruebas de seguridad | ✔ Evidencia humana: v1 reservas, administración y webhooks sin token rechazados; la búsqueda pública se verificó sin llave ni token. |
| Checklist de cierre | ✔ Health v1/v2 200; sin P2010/42P01 en logs desde el despliegue; operaciones recientes del scheduler en ESB con `outcome=ok`. |
| Conformidad con el contrato | ✔ `POST /api/v2/vuelos/search` devolvió 200 y ofertas con salida a las 01:30Z en la fecha local anterior de Lima; búsqueda diurna UIO → GYE con dos ofertas. Código aprobado en audit-10. |

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|

## Observaciones (no bloquean → BACKLOG)
Ninguna.
