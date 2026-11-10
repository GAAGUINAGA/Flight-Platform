# Auditoría F12 — #12
- Fecha: 2026-11-08 · Commit auditado: 1877440 · Veredicto: RECHAZADO

## Verificaciones ejecutadas
| Verificación | Resultado |
|---|---|
| Pruebas de tareas | ✔ Nueve workflows desde clon limpio; integraciones ESB 10/10 y Webhooks 9/9 por separado, dos veces; suites reales de seis servicios y Gateway, dos veces; Postman 8/8. |
| Pruebas de seguridad | ✔ Suites de seguridad y unitarias en verde; llave, entrada inválida, rol, TLS, errores y logs revisados. |
| Checklist de cierre | ✘ El redespliegue de Webhooks no conserva `RABBITMQ_URL`; imágenes y recorrido local acreditados por el humano. |
| Conformidad con el contrato | ✔ Sin cambios en `contracts/`; regresión v1/v2 y feed en suites reales, dos veces. |

## Hallazgos (bloquean)
| # | Tarea | Dónde | Problema |
|---|---|---|---|
| H1 | F12b-2 D | `.github/workflows/deploy-webhooks.yml:23`; `.github/workflows/deploy-service.yml:100` | `extra_secrets` omite `RABBITMQ_URL` y `--set-secrets` sustituye los secretos configurados: tras desplegar Webhooks desde `main`, el consumidor arranca sin broker y no retira eventos. |

## Observaciones (no bloquean → BACKLOG)
Ninguna.
