#!/bin/sh
# Humo del contenedor del servicio GraphQL (F12c-1): construye la imagen, la ejecuta con PORT=8080 y datos ficticios de producción y comprueba
#   - GET /health responde 200 {"status":"ok"} desde el contenedor;
#   - en producción la introspección está apagada y solo corren operaciones conocidas (una consulta cualquiera responde 403).
# Uso: sh scripts/ci/graphql-image-smoke.sh [nombre-de-la-imagen]. Todos los valores son ficticios; no imprime credenciales.
set -u
image="${1:-graphql-service-smoke}"; container="graphql-smoke-$$"; port="${GRAPHQL_SMOKE_PORT:-18080}"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker build -f platform/graphql/Dockerfile -t "$image" . || { echo "FALLA: no se pudo construir $image"; exit 1; }
docker run -d --name "$container" -p "127.0.0.1:${port}:8080" \
  -e NODE_ENV=production -e PORT=8080 \
  -e GATEWAY_BASE_URL=https://gateway.example.invalid \
  -e 'JWT_ISSUERS=[{"iss":"https://auth.example.invalid/auth/v1","aud":"authenticated","jwksUri":"https://auth.example.invalid/jwks.json"}]' \
  -e CORS_ORIGINS=https://web.example.invalid \
  "$image" >/dev/null || { echo "FALLA: no se pudo arrancar $image"; exit 1; }

status=""; i=0
while [ "$i" -lt 30 ]; do
  status="$(curl -s -o /tmp/graphql-health.$$ -w '%{http_code}' "http://127.0.0.1:${port}/health" 2>/dev/null || true)"
  [ "$status" = "200" ] && break
  i=$((i + 1)); sleep 1
done
if [ "$status" != "200" ]; then echo "FALLA: /health no respondió 200 (último estado: ${status:-sin respuesta})"; docker logs "$container" 2>&1 | tail -n 30; exit 1; fi
grep -q '"status":"ok"' /tmp/graphql-health.$$ || { echo "FALLA: /health no devolvió status ok"; cat /tmp/graphql-health.$$; exit 1; }
rm -f /tmp/graphql-health.$$

blocked="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"query":"{ __schema { queryType { name } } }"}' "http://127.0.0.1:${port}/graphql")"
[ "$blocked" = "403" ] || { echo "FALLA: en producción una consulta no publicada debía responder 403 y respondió $blocked"; exit 1; }
user="$(docker exec "$container" id -un 2>/dev/null || echo desconocido)"
[ "$user" != "root" ] || { echo "FALLA: el contenedor corre como root"; exit 1; }
echo "OK: $image responde SERVING en /health con PORT=8080, la introspección/consultas libres están bloqueadas y corre como '$user'"
