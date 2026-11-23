# Renovación del seed de Supabase

El seed genera **60 días de vuelos desde la fecha de ejecución**. Se renueva a mano antes de que la ventana se agote: **no se automatiza** (decisión del humano, 2026-11-22). Conviene renovarlo cuando falten unos 14 días para el último vuelo sembrado (y siempre antes de que queden menos de 3). Lo ejecuta únicamente el humano contra Supabase, desde `main` y después de confirmar las migraciones aplicadas.

**Última renovación:** 2026-11-22, con vuelos hasta fines de enero de 2027 (840 instancias de vuelo y 2520 tarifas aseguradas). **Próxima:** antes del 2027-01-07 (bitácora `docs/dev/progress/2026-11-22_dev_seed-supabase_1.md`).

## Orden obligatorio

1. Inventory crea primero las instancias de vuelo y sus cabinas.
2. Pricing crea después las tarifas para esas instancias.

## Procedimiento (los pasos que se usaron el 2026-11-22)

Desde cada carpeta de servicio, sin mostrar ni leer el contenido de los archivos de entorno (`.env.supabase` se carga con `dotenvx`; nunca se imprime):

1. **Migraciones al día.** En inventory y en pricing, `npx prisma migrate status` con `dotenvx`. Confirmar que el datasource apunta a `pooler.supabase.com` y que no hay migraciones pendientes. Si las hay, aplicar primero `npm run migrate:deploy` (también con `dotenvx`), volver a ejecutar `migrate status` y recién entonces sembrar.
2. **Generar el cliente Prisma** en inventory y en pricing (el cliente es código generado e ignorado por git: tras un `npm ci`, el seed de inventory falla con `@prisma/client did not initialize yet` si se omite).
3. **Seed de inventory** y **luego seed de pricing**, ambos con `dotenvx` y código de salida 0.
4. **Verificar:** que cada seed informe los registros asegurados (`... flight instances ensured`, `... fares ensured`) y que la búsqueda pública v2 devuelva ofertas para una fecha cercana al final de la nueva ventana.

```powershell
cd microservices/inventory-service
npx --yes @dotenvx/dotenvx run -f .env.supabase -- npx prisma migrate status
npx prisma generate
npx --yes @dotenvx/dotenvx run -f .env.supabase -- npm run seed

cd ../pricing-service
npx --yes @dotenvx/dotenvx run -f .env.supabase -- npx prisma migrate status
npx prisma generate
npx --yes @dotenvx/dotenvx run -f .env.supabase -- npm run seed

cd ../..
```

`migrate status` ya no se pide como `npm run migrate:status`: ese script **no existe** en inventory-service ni en pricing-service (sí existe `migrate:deploy`). Tras cada `migrate deploy` o `seed`, ejecutar de nuevo `npx prisma migrate status` con `dotenvx` y confirmar que el datasource apunta a `pooler.supabase.com` (AGENTS.md).

### Comprobación con la búsqueda pública

Búsqueda pública v2 (`POST /api/v2/vuelos/search`, sin token) de una ruta sembrada, por ejemplo UIO→GYE, en una fecha de la última semana de la ventana. El 2026-11-22 se comprobó UIO→GYE del 2027-01-15: 2 ofertas, con ECONOMY y BUSINESS, y el gateway respondió 200.

## Garantías y verificación

Los dos seeds son idempotentes: usan identificadores deterministas y `createMany({ skipDuplicates: true })`. Una repetición agrega únicamente los registros ausentes; no reinicia ni modifica `held` o `sold` de Inventory, por lo que no afecta holds ni reservas ya consumidas, ni los vuelos creados a mano desde el panel. Pricing depende de las instancias de Inventory, por eso invertir el orden deja tarifas incompletas.

Ante un resultado inesperado, no borres filas ni reinicies contadores: registra el incidente y escala al responsable de la base.

Después de renovar, registrar la sesión en `docs/dev/progress/` (fecha, resultado de cada paso, hasta qué fecha llegan los vuelos y la próxima fecha de renovación) y ejecutar los smokes del servicio que corresponda si hace falta.
