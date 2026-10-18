# ADR-F9-06 — Pool y transacciones de Ancillaries en producción
- Estado: Aceptado · Fecha: 2026-10-17 · Fase/Tarea: F9 / corrección de producción
## Contexto
Supabase usa PgBouncer en modo transacción y la URL de producción establece `pgbouncer=true&connection_limit=3` por instancia de Prisma. En una reproducción local con una conexión ocupada 2,5 s, el máximo de espera implícito de 2 s para iniciar una transacción provoca P2028. Cloud Run solo registraba el nombre de la excepción, así que todavía no se conoce el código del fallo real.
## Decisión
Mantener tres conexiones por instancia en la URL gestionada por el humano; no aumentar el pool sin considerar el número de instancias y el límite global de Supabase. Los `maxWait` y `timeout` de las transacciones interactivas de Ancillaries se configuran con `ANCILLARIES_TX_MAX_WAIT_MS` y `ANCILLARIES_TX_TIMEOUT_MS`, por defecto 4000 ms cada uno, enteros positivos. `pool_timeout` de Prisma se configura en la URL; la reproducción utiliza 10 s. Hay que ajustar estos límites junto con el deadline gRPC (5 s) y la latencia real: la espera más la ejecución pueden exceder el deadline, y un reintento de compra debe reutilizar su identificador de operación.

Las lecturas y liberaciones simples permanecen fuera de transacciones interactivas. La lectura de opciones y las dos liberaciones de `ReleaseAll` se ejecutan secuencialmente. La franquicia usa una sola lectura por lote después de la inserción. Las transacciones de equipaje contienen solo consultas de base de datos y el advisory lock transaccional `pg_advisory_xact_lock`, liberado al terminar la transacción y compatible con PgBouncer en modo transacción; nunca se usa un lock de sesión. Se conserva la serialización que impide exceder el límite y la comprobación de owner.

Ambos filtros registran código P2xxx y únicamente identificadores de modelo, campo o índice permitidos por el esquema; nunca mensajes ni valores. La respuesta gRPC sigue siendo genérica.
## Consecuencias
La prueba con presión de pool reproduce P2028 con la espera anterior y pasa con la nueva configuración. No garantiza ausencia de agotamiento bajo cargas o bloqueos arbitrarios; los límites y capacidad deben observarse en Cloud Run. No se modifica el contrato ni el esquema de base de datos.
