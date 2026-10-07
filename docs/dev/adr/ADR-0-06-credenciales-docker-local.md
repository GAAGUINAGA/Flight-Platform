# ADR-0-06 — Credenciales locales de Postgres
- Estado: Aceptado · Fecha: 2026-10-06 · Fase/Tarea: F0 / F0-SEC-04, F0-SEC-05
## Contexto
El SQL de roles debe servir tanto en Supabase como en Docker local. Los roles locales no tenían contraseña, y un volumen Postgres existente no vuelve a ejecutar scripts de inicialización.
## Decisión
Mantener `roles.sql` independiente de secretos. Generar una contraseña aleatoria de 32 bytes para cada rol, otra para el superusuario local y una clave interna compartida de 32 bytes. Guardarlas solo en `infra/.env` y en los `.env` locales ignorados de los siete servicios. Un script separado asigna las contraseñas durante la inicialización de Docker y se puede ejecutar manualmente sobre un volumen existente.
## Consecuencias
Docker Compose requiere `infra/.env`; no se publican secretos en plantillas ni en Git. Las credenciales locales no se reutilizan para Supabase o GCP. El script de configuración se niega a sobrescribir credenciales ya configuradas.
