# Backlog

- Cada servicio y `packages/shared` debe exponer su propio script `test`, ejecutar sus pruebas de manera aislada y cargar Ãºnicamente su `.env`, para que un `DATABASE_URL` de otro workspace no contamine la ejecuciÃ³n global de Jest.
- Aislar el cliente Prisma de inventory-service con la misma convenciÃ³n que el resto (requiere correcciÃ³n auditada y redespliegue).
- ticketing-service: la integraciÃ³n tarda ~30â€“40 s; su `afterAll` puede exceder el timeout bajo carga.

## Para resolver al inicio de F10 (operations-service), observaciones de docs/audit/audits/F6/audit-1.md
- OPS-05: idempotencia de RecordOperationalUpdate. Repetir una cancelación no debe volver a cerrar el vuelo ni publicar flight.cancelled; un retraso repetido no debe republicar flight.schedule_changed si el horario no cambió.
- OPS-04: distinguir un vuelo inexistente (FLIGHT_STATUS_NOT_AVAILABLE) de Inventory no disponible (UNAVAILABLE ? 503), con una prueba propia para cada caso.
- OPS-SEC-01: pruebas de fecha inválida, campo extra y transición no permitida por RPC.

- operations-service/scripts/smoke.cjs: aceptar el target como argumento (como inventory, ticketing y pricing), documentar en su cabecera las variables requeridas e imprimir una línea OK/FAIL por paso.

- ancillaries-service compila a dist/main.js en la RAÍZ del repo (riesgo de colisión con otros servicios); debe emitir en su propia carpeta, como el resto.

- ancillaries-service no carga su .env en local (requiere node --env-file=.env); unificar el arranque local con el resto de servicios.

- F7: audit-1.md (RECHAZADO por ANC-SEC-02: owner-B podía comprar equipaje sobre la reserva de owner-A y las lecturas devolvían [] en vez de NOT_FOUND) se perdió al recrear el clon del auditor; su resolución consta en docs/audit/audits/F7/audit-2.md.
