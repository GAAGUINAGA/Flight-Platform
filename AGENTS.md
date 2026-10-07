# Flight Platform

Fuentes de verdad, en orden: `contracts/openapi/vuelos-openapi.yaml`,
`docs/audit/context/PLAN.md`, `docs/audit/context/investigacion-base.md` y este
archivo. El contrato OpenAPI no se modifica.

El plan define el rol developer en §4.1, §4.2 y las plantillas en §4.3:
ejecuta la prueba de cada tarea, no modifica `contracts/openapi/` ni debilita
pruebas. El rol auditor sigue §4.1, §4.2 y §4.4, verifica en un clon limpio y
emite el informe con la plantilla de §4.3.

## Desarrollo

- Mantén `domain/` libre de NestJS, Prisma e infraestructura; casos de uso y
  puertos van en `application/`, adaptadores en `infrastructure/`.
- Ejecuta la prueba indicada por cada tarea antes de marcarla como terminada.
- Cada RPC valida su entrada con Zod; los accesos a recursos de usuario se
  filtran por owner y los RPC administrativos exigen rol.
- No registres PII ni secretos. No subas `.env` reales.
- Registra decisiones no cubiertas por el plan en `docs/dev/adr/` y cada sesión
  en `docs/dev/progress/`.

## Comandos

```powershell
npm install
npm run lint
npm test
npm run build
npm run gen:contracts
docker compose -f infra/docker-compose.yml up -d
```

Para desarrollo local usa Node 20 (ver `.nvmrc`). Los contratos se generan en
`packages/contracts`; los servicios gRPC se prueban contra Postgres local.

Antes de ejecutar las pruebas de un servicio en un clon limpio, genera su
cliente Prisma y construye las utilidades compartidas:

```powershell
npm run prisma:generate -w @flight-platform/<servicio>
npm run build -w @flight-platform/shared
npm test -w @flight-platform/<servicio> -- --runInBand
```

## Reglas aprendidas (obligatorias)
- Un solo developer activo a la vez. Trabaja en una rama `feat/<FASE>-<servicio>` en el checkout principal; sin worktrees.
- Prisma: `prisma` y `@prisma/client` fijados en `6.12.0` exacto (versiones posteriores traen deepmerge-ts con vulnerabilidad alta).
- El cliente de Prisma es código generado e ignorado por git: el workflow de CI debe ejecutar `prisma generate` antes de lint, build y test.
- CI ejecuta solo lint, build, `npm audit --audit-level=high` y pruebas unitarias del servicio. Integración, concurrencia y seguridad se ejecutan en local y en la auditoría (clon limpio con Docker). Nunca `npm test` de toda la raíz en el workflow de un servicio.
- Las pruebas deben fallar rápido si falta DATABASE_URL y cerrar servidores y conexiones en afterAll aunque beforeAll falle.
- Antes de "listo para auditoría", ejecutar en clon limpio (git clone + npm ci) los mismos pasos del workflow.
- No modificar infra/ ni ejecutar docker compose: la base local la administra el humano.
- Despliegue solo desde main, después de la auditoría de código (docs/audit/context/flujo-cierre.md).
- Antes de "listo para auditoría", construir la imagen Docker del servicio y ejecutarla con PORT=8080: el health gRPC debe responder SERVING desde el contenedor. Un build exitoso no basta.
