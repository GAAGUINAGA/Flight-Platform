#!/bin/sh
# Humo de arranque de una imagen (F12b-2): la construye, la arranca con NODE_ENV=production y datos ficticios y falla si Prisma no puede cargar
# su motor (p. ej. falta openssl en la imagen: "could not locate the Query Engine"). Un error de conexión a la base ficticia NO cuenta como fallo.
# Uso: sh scripts/ci/image-startup-smoke.sh <ruta del Dockerfile> <nombre de la imagen> [variable=valor ...]
# No imprime ninguna credencial: todos los valores de este script son ficticios.
set -u
dockerfile="$1"; image="$2"; shift 2
container="smoke-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker build -f "$dockerfile" -t "$image" . || { echo "FALLA: no se pudo construir $image"; exit 1; }

extra=""
for pair in "$@"; do extra="$extra -e $pair"; done
# shellcheck disable=SC2086
docker run -d --name "$container" \
  -e NODE_ENV=production -e PORT=8080 \
  -e INTERNAL_API_KEY=0123456789abcdef0123456789abcdef0123 \
  -e DATABASE_URL=postgresql://smoke:smoke@127.0.0.1:1/smoke -e DIRECT_URL=postgresql://smoke:smoke@127.0.0.1:1/smoke \
  -e RABBITMQ_URL=amqps://smoke:smoke@127.0.0.1:1/smoke \
  -e WEBHOOK_SECRET_ENCRYPTION_KEY=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc= \
  $extra "$image" >/dev/null || { echo "FALLA: no se pudo arrancar $image"; exit 1; }

sleep 15
logs="$(docker logs "$container" 2>&1)"
state="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$container" 2>/dev/null || echo 'desconocido')"

# Fallos que esta prueba busca: el motor de Prisma no se encuentra o no se puede cargar.
if printf '%s' "$logs" | grep -Eiq 'could not locate the Query Engine|Unable to require\(|query[_ -]engine.*(not found|cannot|unable)|libssl|error while loading shared libraries'; then
  echo "FALLA: Prisma no pudo cargar su motor en $image (estado: $state)"; printf '%s\n' "$logs" | tail -n 40; exit 1
fi
# Si el contenedor terminó, solo es aceptable por una causa que no sea de inicialización de Prisma (p. ej. conexión a la base ficticia o configuración).
case "$state" in
  exited*)
    if printf '%s' "$logs" | grep -Eiq 'prisma' && ! printf '%s' "$logs" | grep -Eiq "P100[0-3]|Can't reach database|connect ECONNREFUSED|Authentication failed|Environment variable not found|is required"; then
      echo "FALLA: $image terminó por un error de inicialización de Prisma (estado: $state)"; printf '%s\n' "$logs" | tail -n 40; exit 1
    fi ;;
esac
echo "OK: $image arrancó sin errores del motor de Prisma (estado: $state)"
