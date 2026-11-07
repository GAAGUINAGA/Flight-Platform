# ADR-F12b1fix-01 — Consultas a mano con esquema explícito
- Estado: Aceptado · Fecha: 2026-11-05 · Fase/Tarea: fix/sql-esquema-explicito (previa al cierre de F12b-1)
## Contexto
Incidente en producción (verificado por el humano en los logs de Postgres de Supabase): `ancillaries-service` fallaba en `getAssignments` con `P2010` y el error de Postgres `42P01 relation "booking_owners" does not exist`. Las consultas escritas a mano (`$queryRaw`/`$executeRaw`) usaban tablas sin esquema y dependían del `search_path` de la conexión. En local (conexión directa) el `search_path` es el del esquema y todo pasa; en Supabase el pooler en modo transacción reparte conexiones sin garantizarlo. Las consultas generadas por Prisma no fallan porque califican el esquema.
Mitigación ya aplicada por el humano en Supabase: `ALTER ROLE svc_<servicio> SET search_path = <esquema>, public`. La corrección de código no depende de ella.
Inventario de consultas a mano (todas revisadas): ancillaries (`booking_owners`, sin esquema → corregido), reservation (`baggage_purchases`, `reservations`, sin esquema → corregido), inventory, ticketing, webhooks y scheduler del gateway (ya calificadas con texto repetido → ahora desde un único lugar). `pg_advisory_xact_lock(hashtext(...))` (ancillaries) es una función de `pg_catalog`, que siempre está en el `search_path`: no usa tablas y no requiere cambio. Pricing y operations no tienen consultas a mano.
## Decisión
1. **Un único lugar por servicio**: `src/infrastructure/persistence/schema.ts` (`src/db-schema.ts` en el gateway) exporta `SCHEMA` y `table(nombre)`, que devuelve `Prisma.raw('"<esquema>"."<tabla>"')`. El nombre de tabla solo puede ser un literal del código y se valida con `^[a-z_][a-z0-9_]*$`; nunca se interpola un dato de entrada. Las consultas usan `${table('x')}` o una constante derivada.
2. **Prueba que reproduce el incidente** (una por servicio, en `test/integration/search-path*.spec.ts`): usa un cliente de una sola conexión (`connection_limit=1`), ejecuta `SET search_path TO public`, comprueba que la tabla sin esquema ya no se resuelve (`to_regclass`) y ejecuta cada consulta a mano. Con el código anterior, ancillaries y reservation fallan con `42P01`; inventory, ticketing, webhooks y gateway ya estaban calificadas y la prueba fija que sigan así.
3. **Comprobación automática** `scripts/check-raw-sql.cjs`, parte de `npm run lint` (con prueba `scripts/check-raw-sql.spec.ts`): analiza `$queryRaw`, `$executeRaw`, sus variantes `Unsafe` y `Prisma.sql` en `microservices/`, `platform/` y `packages/` (código y pruebas) y falla ante `FROM`/`JOIN`/`INTO`/`UPDATE`/`TABLE` con una tabla sin esquema. Se aceptan una interpolación (`table()`) o un nombre calificado.
4. **Segunda capa** en `infra/db/roles.sql` (la administra el humano; el agente no puede modificar `infra/`). Dentro del bucle de roles, tras crear el rol:
   ```sql
   EXECUTE format('ALTER ROLE %I SET search_path = %I, public', 'svc_' || service_name, service_name);
   ```
   Es idempotente y cubre a los ocho usuarios de servicio.
## Consecuencias
Un servicio nuevo con consultas a mano debe crear su `schema.ts`; si olvida el esquema, `npm run lint` falla. No hay cambios de lógica de negocio, contratos ni migraciones.
