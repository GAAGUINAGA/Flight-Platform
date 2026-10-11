# Backlog

- Cada servicio y `packages/shared` debe exponer su propio script `test`, ejecutar sus pruebas de manera aislada y cargar únicamente su `.env`, para que un `DATABASE_URL` de otro workspace no contamine la ejecución global de Jest.
- Aislar el cliente Prisma de inventory-service con la misma convención que el resto (requiere corrección auditada y redespliegue).
- ticketing-service: la integración tarda ~30–40 s; su `afterAll` puede exceder el timeout bajo carga.
