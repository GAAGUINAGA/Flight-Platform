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
