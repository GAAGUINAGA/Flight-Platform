# Bitácora de desarrollo — F4 Dockerfile — 2026-10-10 #1

**Rama:** `fix/F4-dockerfile`  
**Commit de código verificado:** `ddba1fa`

## Objetivo

Corregir el build Docker del Gateway para Render: construir `@flight-platform/shared` antes del Gateway, instalar OpenSSL en build y runtime, y excluir artefactos y credenciales del contexto.

## Registro

| Tarea | Acción | Resultado |
|---|---|---|
| Dockerfile | Se alinearon las etapas build/runtime con Ticketing: `openssl` y `ca-certificates`, compilación explícita de `@flight-platform/shared` antes de `@flight-platform/api-gateway`, y usuario no root en runtime. | El build Docker del Gateway terminó correctamente; Prisma generó el cliente sin aviso de OpenSSL. |
| Contexto Docker | Se completó `.dockerignore` para excluir dependencias, `dist`, `.env`/`.env.*` salvo ejemplos, `infra/dev-keys`, clientes Prisma generados, coverage y `.git`. | Ninguna credencial local se transfirió al contexto. |
| Helper de prueba | `test-grpc.ts` quedó excluido de `tsc` de producción y solo se requiere dinámicamente cuando `NODE_ENV=test`. | La suite `npx jest platform/api-gateway/src/gateway.spec.ts --runInBand --silent` pasó. |
| Regla | Se añadió en `AGENTS.md` la obligación de verificar cada Dockerfile desde un clon limpio. | Regla registrada. |

## Verificación en clon limpio

Clon creado desde `ddba1fa` en `C:\Proyectos\fp-f4-docker-clean-ddba1fa`; inicialmente no tenía directorios `dist` ni archivos `.env`.

| Comando | Salida resumida |
|---|---|
| `docker build -f platform/api-gateway/Dockerfile -t flight-platform-api-gateway-f4-docker:clean .` | Exit 0. `@flight-platform/shared` y luego `@flight-platform/api-gateway` compilados. Prisma generó el cliente sin avisos de OpenSSL. |
| `docker run ... -e NODE_ENV=production -e PORT=8080 -e DATABASE_URL=<URL de prueba> -e JWT_ISSUERS=<JSON JWKS de prueba> -e INTERNAL_API_KEY=<valor de prueba de 32+ caracteres> flight-platform-api-gateway-f4-docker:clean` seguido de `GET /flights/v1/health` | `HTTP 200 {"status":"ok"}`. Contenedor temporal eliminado. |
| Con `platform/api-gateway/.env` de prueba en el clon: `docker run --rm flight-platform-api-gateway-f4-docker:clean ls -la /app/platform/api-gateway` | Apareció `.env.example`, pero no `.env`; comprobación final: `CHECK: .env ausente de la imagen`. |

No se imprimieron ni leyeron credenciales locales. Los valores de configuración usados en el smoke fueron exclusivamente datos de prueba y se han omitido de esta bitácora.

## Cierre

- Estado: listo para auditoría (código).
