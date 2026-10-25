# F11c-1: scheduler y precalentamiento de Render

## Variables nuevas del Gateway en Render

Configurar estas variables de entorno en el servicio Gateway. Los valores de
abajo son los valores por defecto; los intervalos est\u00e1n expresados en
milisegundos.

| Variable | Valor recomendado | Prop\u00f3sito |
| --- | --- | --- |
| `SCHEDULER_ENABLED` | `true` | Activa la ronda inicial y los trabajos peri\u00f3dicos. Debe ser `false` en pruebas unitarias. |
| `SCHEDULER_EVERY_MS` | `60000` | Frecuencia de `ExpireHolds`, `ResumePending`, `DispatchPending` y recuperaci\u00f3n de check-ins. |
| `SCHEDULER_PURGE_EVERY_MS` | `3600000` | Frecuencia de purga de claves de idempotencia vencidas. |
| `SCHEDULER_BATCH_SIZE` | `50` | M\u00e1ximo de elementos de cada RPC de mantenimiento por ejecuci\u00f3n. |
| `SCHEDULER_LOCK_LEASE_MS` | `55000` | Duraci\u00f3n del lease durable que evita que una tarea se solape consigo misma. Debe ser menor que `SCHEDULER_EVERY_MS`. |

El scheduler se ejecuta dentro del proceso del Gateway en Render, con rol
interno `system`. Al iniciar, ejecuta una ronda inmediata y luego programa los
intervalos. Cada tarea toma un lease en la base del Gateway, procesa un lote y
lo libera; por tanto es segura ante reinicios y ante una instancia adicional.
Los fallos se registran por dependencia y c\u00f3digo, sin PII, y no detienen las
dem\u00e1s tareas ni el Gateway.

Render puede suspender el Gateway despu\u00e9s de inactividad; durante esa
suspensi\u00f3n las rondas no corren. Es aceptable en las ventanas de prueba: los
holds vencen tambi\u00e9n al consultarlos, conforme D-04. Una petici\u00f3n al health
reanuda el proceso y provoca la ronda de arranque.

Adem\u00e1s de estas variables siguen siendo obligatorias las existentes:
`INTERNAL_API_KEY`, `JWT_ISSUERS`, `DATABASE_URL`, las siete
`*_GRPC_URL`, `GRPC_TLS`, CORS, rate limits e idempotencia. Los secretos se
administran en Render; nunca se versionan ni se imprimen.

## Precalentamiento para una sesi\u00f3n de prueba

1. Obt\u00e9n los endpoints publicados vigentes del Gateway de Render y de cada
   servicio Cloud Run. En una terminal que ya tenga credenciales de operador,
   llama al health REST del Gateway hasta recibir 200:

   ```powershell
   curl.exe --fail --retry 12 --retry-delay 5 https://<gateway>/flights/v1/health
   ```

2. Conserva `INTERNAL_API_KEY` solo como secreto de sesi\u00f3n (no lo escribas en
   historial ni archivos). Para cada uno de `inventory`, `pricing`,
   `ancillaries`, `reservation`, `ticketing`, `webhooks` y `operations`, llama
   al health gRPC con HTTP/2 y reintenta hasta `SERVING`:

   ```powershell
   grpcurl -H "x-internal-key: $env:INTERNAL_API_KEY" -H "x-role: system" -d '{"service":""}' <service-url>:443 grpc.health.v1.Health/Check
   ```

3. Repite cualquier llamada que responda temporalmente `UNAVAILABLE` o un 503,
   esperando cinco segundos entre intentos. No ejecutes los recorridos J2--J4
   hasta que Gateway y los siete servicios respondan saludables. El primer
   health del Gateway despierta Render y permite que la ronda inicial del
   scheduler ponga al d\u00eda los trabajos pendientes.

