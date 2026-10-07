# ADR-0-01 — Roles de servicio en Postgres local
- Estado: Aceptado · Fecha: 2026-10-06 · Fase/Tarea: 0 / F0-SEC-04

## Contexto
Postgres local no incluye los roles `anon` y `authenticated` de Supabase. El SQL inicial abortaba al revocar permisos de roles inexistentes y llevaba contraseñas de ejemplo incorporadas.

## Decisión
Crear roles de servicio `LOGIN` sin contraseña en el esquema inicial; las credenciales se asignan fuera del SQL. Revocar a `anon` y `authenticated` solo cuando existan. Otorgar `CONNECT` sobre la base actual sin revocar permisos globales de `PUBLIC`, ya que Supabase usa una base compartida. Probar privilegios locales mediante `SET ROLE` desde una conexión administrativa.

## Consecuencias
El mismo script se puede aplicar a Postgres local y Supabase. Configurar las contraseñas y las URLs por servicio queda a cargo del aprovisionamiento de cada entorno.
