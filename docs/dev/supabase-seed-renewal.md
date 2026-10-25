# Renovación del seed de Supabase

Renueva el seed semanalmente y también antes de que la ventana de 60 días de
vuelos disponibles se acerque a 14 días. Lo ejecuta únicamente el humano contra
Supabase, desde `main` y después de confirmar las migraciones aplicadas.

## Orden obligatorio

1. Inventory crea primero las instancias de vuelo y sus cabinas.
2. Pricing crea después las tarifas para esas instancias.

Desde cada carpeta de servicio, sin mostrar ni leer el contenido de los
archivos de entorno, ejecutar:

```powershell
cd microservices/inventory-service
npx --yes @dotenvx/dotenvx run -f .env.supabase -- npm run seed
npx --yes @dotenvx/dotenvx run -f .env.supabase -- npm run migrate:status

cd ../pricing-service
npx --yes @dotenvx/dotenvx run -f .env.supabase -- npm run seed
npx --yes @dotenvx/dotenvx run -f .env.supabase -- npm run migrate:status
```

Tras cada `migrate:status`, confirmar que el datasource apunta a
`pooler.supabase.com`. Si hay migraciones pendientes, aplicar primero
`migrate:deploy`, volver a ejecutar `migrate:status` y recién entonces el seed.

## Garantías y verificación

Los dos seeds son idempotentes: usan identificadores deterministas y
`createMany({ skipDuplicates: true })`. Una repetición agrega únicamente los
registros ausentes; no reinicia ni modifica `held` o `sold` de Inventory, por
lo que no afecta holds ni reservas ya consumidas. Pricing depende de las
instancias de Inventory, por eso invertir el orden deja tarifas incompletas.

Verificar que ambos comandos informen los registros asegurados y ejecutar los
smokes del servicio que corresponda. Ante un resultado inesperado, no borres
filas ni reinicies contadores: registra el incidente y escala al responsable de
la base.
