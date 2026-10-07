# Backlog

- Cada servicio y `packages/shared` debe exponer su propio script `test`, ejecutar sus pruebas de manera aislada y cargar únicamente su `.env`, para que un `DATABASE_URL` de otro workspace no contamine la ejecución global de Jest.
