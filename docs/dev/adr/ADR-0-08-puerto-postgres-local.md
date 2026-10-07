# ADR-0-08 — Puerto local de Postgres Docker
- Estado: Aceptado · Fecha: 2026-10-06 · Fase/Tarea: F0 / F0-11
## Contexto
El host Windows ya tiene otro proceso `postgres` escuchando en `0.0.0.0:5432`. Publicar el contenedor en `127.0.0.1:5432` falló con `ports are not available`.
## Decisión
Publicar Postgres de Docker solo en `127.0.0.1:15432`, conservando `5432` dentro del contenedor. Ajustar los `.env` locales ignorados y las plantillas `.env.docker.example` de los siete microservicios. No detener ni alterar el Postgres preexistente del host.
## Consecuencias
Las conexiones locales a Docker usan `127.0.0.1:15432`; las de Supabase y sus poolers no cambian. El puerto publicado no acepta conexiones externas al host.
