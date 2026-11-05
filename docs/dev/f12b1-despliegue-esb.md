# F12b-1 — Despliegue del ESB (lo ejecuta el humano)

El ESB (`microservices/esb-service`) es un servicio **HTTP/1.1** (no gRPC) que recibe del Gateway las operaciones con nombre y las
enruta a los siete microservicios por gRPC. Despliegue solo desde `main`, después de la auditoría de código
(`docs/audit/context/flujo-cierre.md`). El workflow es `.github/workflows/deploy-esb.yml` (no usa `deploy-service.yml`, que despliega con
`--use-http2`). Nada de esto lo ejecuta el developer.

## 1. Cuenta de servicio y permisos

1. Crear la cuenta `esb-service-runtime@project-a1d2e3ba-f6ff-469e-854.iam.gserviceaccount.com` (la que usa el workflow).
2. La cuenta de despliegue (`GCP_DEPLOY_SA`, ya usada por los demás servicios) debe poder desplegar `esb-service` y actuar como
   `esb-service-runtime` (`roles/iam.serviceAccountUser`).
3. Los siete servicios Cloud Run siguen autenticando por **llave interna** (`x-internal-key`), igual que hoy con el Gateway: el ESB
   no necesita `roles/run.invoker` mientras los servicios mantengan el ingreso actual. Si el humano restringe alguno a invocación
   autenticada por IAM, hay que dar `roles/run.invoker` a `esb-service-runtime` sobre ese servicio.

## 2. Secretos y variables del servicio `esb-service`

| Nombre | Valor | Cómo |
|---|---|---|
| `INTERNAL_API_KEY` | Secret Manager `internal-api-key` (la misma de Gateway y servicios) | lo fija el workflow (`--set-secrets`) |
| `GRPC_TLS` | `true` | lo fija el workflow (`--update-env-vars`) |
| `INVENTORY_GRPC_URL`, `PRICING_GRPC_URL`, `ANCILLARIES_GRPC_URL`, `RESERVATION_GRPC_URL`, `TICKETING_GRPC_URL`, `OPERATIONS_GRPC_URL`, `WEBHOOKS_GRPC_URL` | `<host-del-servicio>:443` (los mismos valores que hoy tiene el Gateway en Render) | **manual**, una sola vez: `gcloud run services update esb-service --region us-east1 --update-env-vars INVENTORY_GRPC_URL=...` (el workflow no los toca; `--update-env-vars` conserva los existentes) |
| `ESB_DEFAULT_DEADLINE_MS`, `ESB_ORCHESTRATED_DEADLINE_MS`, `ESB_MAX_DEADLINE_MS`, `ESB_MAX_BODY_BYTES` | opcionales (5000 / 30000 / 30000 / 1048576) | solo si se quiere cambiar el valor por defecto |

No se escriben valores reales en el repositorio. `PORT` lo fija Cloud Run (8080).

## 3. Ingreso

El ESB se publica con `--allow-unauthenticated` (el Gateway en Render no tiene identidad de Google) **protegido por la llave interna**:
todo lo que cuelga de `/internal` y `/health/deps` responde `401` sin `X-Internal-Key` válida, antes de leer el cuerpo ni mediar. Solo
`GET /health` es público y no toca a los servicios. Alternativa más estricta (fuera de F12b-1): ingreso interno + VPC connector.

## 4. Gateway en Render (después de que el ESB esté sano)

1. Verificar el ESB: `curl https://<esb>/health` ⇒ `{"status":"ok"}`; con llave, `GET /health/deps` ⇒ 200 con los siete servicios `UP`.
2. En Render, variables del Gateway:
   - `ESB_URL=https://<esb>` (solo el origen, sin ruta; obligatoria en producción: sin ella el Gateway **no arranca**).
   - `GATEWAY_TRANSPORT=esb` (es el valor por defecto; `grpc` = vuelta atrás al transporte directo).
3. Redesplegar el Gateway. Las siete `*_GRPC_URL` del Gateway **se conservan** mientras exista la vuelta atrás `grpc` (se retira en F12b-3).
4. **Vuelta atrás:** `GATEWAY_TRANSPORT=grpc` + redeploy; no requiere tocar el ESB.

## 5. Precalentamiento (actualiza `docs/dev/f11c-scheduler-render.md`)

Antes de una sesión de prueba, además de los pasos existentes:
`curl.exe --fail --retry 12 --retry-delay 5 https://<esb>/health` y, con la llave en una variable de sesión (sin dejarla en historial),
`GET /health/deps` hasta 200. Cloud Run enfría el ESB igual que a los servicios: la primera llamada puede tardar; el Gateway lo trata como
transitorio (503 + `Retry-After`) si el ESB no responde a tiempo. Con `min-instances=1` en el ESB se evita el arranque en frío (decisión de costo del humano).

## 6. Medición de latencia (a hacer por el humano en Render)

El ESB añade un salto HTTP entre Gateway y servicios. Medir antes/después con las mismas peticiones (p. ej. `GET /api/v2/vuelos/health`,
una búsqueda de ofertas y una consulta de reserva), 30 repeticiones con el ESB caliente, comparando `GATEWAY_TRANSPORT=grpc` y `esb`.
El ESB registra `latencyMs` por operación (log JSON `operation`, `outcome`, `grpcCode`, `latencyMs`, `correlationId`, sin entradas ni identidad),
que sirve para separar el tiempo del ESB del tiempo del servicio. Resultado esperado: sobrecoste de un salto HTTP dentro de la misma región
(`us-east1`); registrar el real en la bitácora de despliegue.

## 7. Verificación posterior al despliegue

- `GET /health` público 200; `POST /internal/v1/operations/vuelos.buscar-ofertas` sin llave ⇒ 401.
- Recorridos de Render (`docs/dev/f11d2-render-journeys.md`) con `GATEWAY_TRANSPORT=esb`.
- Los logs del ESB muestran una línea por operación con el mismo `correlationId` que el Gateway.

## 8. Deuda registrada (F12b-3)

El cliente gRPC del stock externo de Booking sigue en el Gateway (ADR-F12b-03) y siete composiciones siguen en el Gateway (ADR-F12b-01).
