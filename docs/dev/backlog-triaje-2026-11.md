# Triaje del BACKLOG — 2026-11-22

Rama `docs/repaso-backlog`, desde `main` en `a640c11` (audit-53 APROBADO). Solo documentación: no se cambió código ni se tocó `BACKLOG.md`; el humano decide qué entradas se cierran.

## Cómo se hizo y qué límites tiene

- Se revisaron las **244 líneas** de `BACKLOG.md` y se agruparon en **138 entradas** (`B-001` a `B-138`). Algunas líneas aparecen duplicadas en el BACKLOG (L139/L141, L197/L201, L198/L202, L199/L203); aquí cuentan como una sola. Cada fila cita las líneas de origen (`L…`).
- Cada entrada se contrastó con el código, los ADR, las bitácoras y el historial de git de `main`. La columna **Verificación y razón** dice qué se comprobó; «Verificado» significa que se leyó el código o el archivo citado, «No verificado» que no se pudo comprobar así.
- **No se ejecutó ninguna prueba.** Las entradas de pruebas intermitentes o de datos locales (grupo G1) se mantienen como vigentes porque requieren la base local y Docker, que administra el humano (AGENTS.md); su estado real se conoce solo al repetirlas.
- Ante la duda se dejó la entrada como **Vigente**, nunca como resuelta.
- El propio `BACKLOG.md` tiene líneas con la codificación dañada (`?`, `Ã³`, espacios en lugar de tildes): L21–L23, L42–L45, L96, L103–L122, L134–L135 y otras. No se corrigió (tarea solo de lectura), pero conviene arreglarlo cuando se limpie el archivo.

**Estados:** Vigente · Resuelta (con commit o auditoría) · Obsoleta (ya no aplica, por diseño o por haberse retirado la causa) · Lección (regla de proceso, no una tarea).
**Categorías:** a defecto visible para clientes o socios · b seguridad o datos personales · c integridad de datos o dinero · d pruebas inestables o entorno local · e deuda técnica o de arquitectura · f operación y observabilidad · g decisión de negocio pendiente · h mejora o alcance nuevo · i lección o regla de proceso.
**Tamaño:** S (horas) · M (un día o dos) · L (varias jornadas o requiere diseño).

## Aviso urgente

- La **fecha límite 2026-11-23** de Zod (L103) **ya no existe**: la migración a Zod 4 se hizo en `d91f3b4` (2026-10-25) y no queda ninguna excepción de audit. Ver B-017 y B-057.
- El **seed de vuelos en Supabase** (B-042) cubre hasta ~2026-12-24 y no consta una renovación posterior al 2026-10-25. Es lo único con fecha real cercana.
- La contraseña de `svc_gateway` que estuvo en un ejemplo versionado (B-076) debe confirmarse como rotada.

## Resumen

| Categoría | Vigentes | Resueltas | Obsoletas | Lecciones | Total |
|---|---:|---:|---:|---:|---:|
| a Defecto visible para clientes o socios | 6 | 8 | 0 | 0 | 14 |
| b Seguridad o datos personales | 7 | 5 | 0 | 0 | 12 |
| c Integridad de datos o dinero | 7 | 6 | 0 | 0 | 13 |
| d Pruebas inestables o entorno local | 29 | 4 | 5 | 0 | 38 |
| e Deuda técnica o de arquitectura | 17 | 7 | 1 | 0 | 25 |
| f Operación y observabilidad | 8 | 0 | 2 | 0 | 10 |
| g Decisión de negocio pendiente | 6 | 0 | 0 | 0 | 6 |
| h Mejora o alcance nuevo | 7 | 2 | 0 | 0 | 9 |
| i Lección o regla de proceso | 3 | 0 | 3 | 5 | 11 |
| **Total** | **90** | **32** | **11** | **5** | **138** |

Las 90 vigentes por prioridad y tamaño: **Alta** 5 (4 S, 1 M) · **Media** 23 (9 S, 13 M, 1 L) · **Baja** 62 (50 S, 11 M, 1 L).

Lo que más pesa: casi la mitad de las vigentes son pruebas, entorno local o cobertura (categoría d y grupo G12) y casi todas son de prioridad baja; lo que toca al cliente o al dinero es poco y concreto (G8: puerta de embarque, pago pendiente, total de tarifa, oferta vencida).

## Grupos (lo que conviene resolver junto)

| Grupo | Tema | Entradas vigentes |
|---|---|---|
| G1 | Pruebas intermitentes y datos locales acumulados (incluye PST-03/04, hold-concurrency, BUS-I10, E2E-07/16) | B-020 B-040 B-054 B-081 B-083 B-088 B-095 B-096 B-105 B-108 B-113 B-114 B-122 B-123 B-130 B-132 B-135 |
| G2 | Operación y observabilidad en la nube (F12d): arranque en frío, salud del bus, script de infraestructura, depurado | B-052 B-085 B-091 B-120 |
| G3 | Reglas de pasajeros compartidas y GraphQL alineado; restos del día local | B-004 B-006 B-015 |
| G4 | Scripts `test`, arranque local y herramientas de desarrollo | B-016 B-018 B-019 B-024 B-047 B-055 B-103 B-106 B-138 |
| G5 | Errores internos con causa, plazos y lotes | B-037 B-038 B-053 B-061 |
| G6 | Seed rodante de Supabase | B-042 |
| G7 | F12b-3: orquestación en el ESB, unicidad y apertura de vuelos, eventos | B-086 B-087 B-124 B-125 B-128 B-131 |
| G8 | Contrato y comportamiento Pricing/Gateway visible para Booking | B-011 B-033 B-070 B-071 B-090 B-112 |
| G9 | Panel de administrador: ampliaciones | B-062 B-073 B-080 B-118 B-119 B-126 B-129 |
| G10 | Decisiones de negocio con Booking o el humano | B-002 B-007 B-009 B-102 B-121 |
| G11 | Documentación y archivos fuente | B-059 B-098 B-107 |
| G12 | Cobertura de pruebas pendiente | B-012 B-031 B-036 B-045 B-046 B-050 B-056 B-060 B-066 B-067 B-069 B-084 B-093 |
| G13 | Seguridad y datos: refuerzos y cabos sueltos | B-013 B-068 B-076 B-077 B-082 B-104 B-134 |
| G14 | Web: rendimiento, catálogo y herramientas | B-005 B-092 B-100 B-101 B-109 |

## Tabla completa

| ID | Línea | Entrada | Estado | Cat. | Prior. | Tam. | Grupo | Verificación y razón |
|---|---|---|---|---|---|---|---|---|
| B-001 | L4 | Formulario de pasajeros: validación al escribir y errores por campo, reglas compartidas Reservation/web | Resuelta | a | — | — | — | `b5e970f`, bitácora `c70b1b6`, `audit-53` APROBADO. Verificado: `packages/shared/src/passenger-rules.ts` y `platform/web/src/purchase/`. |
| B-002 | L5 | Edad por tipo: PLAN Q-010 (YOUTH 12–15, ADULT ≥ 16 al último tramo) frente a Reservation/web (YOUTH 12–17, ADULT ≥ 18 a hoy) | Vigente | g | Alta | S | G10 | Verificado: `AGE_RANGES` sigue en 12–17 / 18+ (`passenger-rules.ts:60`). Cambia la regla de venta a menores: sin acuerdo con Booking cada canal puede rechazar o aceptar a distinta edad. Si cambia, es un solo archivo compartido. |
| B-003 | L6 (parte resuelta) | Nombres de campo de `VALIDATION_FAILED` de Reservation hasta la web (`invalid-params`) | Resuelta | a | — | — | — | `b5e970f` (ADR-F12b1fix-05 punto 12). Verificado: `invalid-params.ts` en shared, ESB, Gateway y web. |
| B-004 | L6 (pendientes a, b, c) | El Gateway repite el filtro de `invalid-params` (`platform/api-gateway/src/v2/invalid-params.ts`); los demás RPC de Reservation y Ancillaries no nombran campo/pasajero/tramo | Vigente | e | Baja | M | G3 | Verificado: existen dos copias (shared y Gateway). Riesgo: que diverjan al agregar un motivo. |
| B-005 | L7 | `libphonenumber-js/min` suma +31 KB gzip al chunk principal de la web; cargarlo en diferido | Vigente | e | Baja | S | G14 | Verificado: `purchase/phone.ts:2` lo importa de forma estática. Solo rendimiento de primera carga. |
| B-006 | L8 | Validación de GraphQL (`passengerInput`) más permisiva que las reglas compartidas | Vigente | e | Media | M | G3 | Verificado: `platform/graphql/src/application/validation.ts:29-35` (documento 4–20 con guion, nombres sin patrón, teléfono con espacios). El servidor decide, pero el error llega tarde y con otro mensaje. |
| B-007 | L9 | Cédula de Ecuador exige 10 dígitos solo en la web (decisión del humano, ADR punto 14) | Vigente | g | Baja | S | G10 | Decisión ya tomada; queda por si el producto quiere que la exija el servidor (avisar a Booking). `documentRule` sigue en `platform/web/src/purchase/passenger-rules.ts`. |
| B-008 | L10 | Los metadatos de `libphonenumber-js` envejecen: actualizar la librería a su ritmo | Lección | i | Baja | S | G11 | Regla de mantenimiento, no una tarea. Versión fija en `platform/web/package.json`. |
| B-009 | L11 | Fechas de nacimiento y expiración: límites solo de interfaz (aceptado, ADR punto 15) | Vigente | g | Baja | S | G10 | Decisión aceptada; Reservation no los impone (v1 y Booking pueden enviar fechas fuera de rango). Pasarlas a shared solo si el producto lo pide. |
| B-010 | L12 | `BAGGAGE_LIMIT_EXCEEDED` debe llegar como error del campo de maletas | Resuelta | a | — | — | — | `b5e970f` (la propia entrada lo marca «resuelto arriba»). |
| B-011 | L13 | El máximo total de maletas por pasajero/tramo (`BAGGAGE_MAX_ALLOWED`) no se publica antes de la reserva; la web lo duplica | Vigente | e | Media | M | G8 | La web mantiene `MAX_CHECKED_BAGS_PER_PASSENGER`; si el servidor cambia el valor, la web ofrecerá cantidades rechazadas. Exige cambio de contrato (no autorizado hasta ahora). |
| B-012 | L14 | Prueba de humo posterior al despliegue de la compra en BUSINESS con asiento (necesita destino de Ancillaries) y sembrar PREMIUM_ECONOMY y FIRST de B787 en Pricing y Ancillaries | Vigente | d | Media | M | G12 | Verificado: el seed de Inventory sí define PREMIUM_ECONOMY/FIRST para B787 (`prisma/seed.ts:12`); el de Pricing no. La causa del incidente de BUSINESS fue justo la falta de esta prueba (ver B-137). |
| B-013 | L15 | Restricciones CHECK en `gateway.admin_access_log` (result, action, error_code, subject) | Vigente | b | Baja | S | G13 | Verificado: las migraciones `20261115*` solo crean tabla, índices y trigger de solo inserción; no hay CHECK. La lista cerrada se impone en `buildAccessRow`. |
| B-014 | L16 | Búsqueda de vuelos por día LOCAL del aeropuerto de salida (NFR-TI-01) | Resuelta | a | — | — | — | Verificado: `packages/shared/src/airport-time.ts` (`flightLocalDay`) usado por inventory `flight-admin`, operations `check-in`/`flight-status`, reservation `post-sale-date-change`/`admin-view`, Gateway v2 `stock-sync`/`operations.controller` y el falso de Pricing. ADR-F12b1fix-02; despliegue 2026-11-08. |
| B-015 | L16 (restos) | Restos de día local: tabla de zonas horarias en base de datos (hoy estática), edad del pasajero con fecha local, seed en hora local, y `slice(0, 10)` de `reservation/queries.ts:11` | Vigente | e | Baja | M | G3 | Verificado parcialmente: `queries.ts:11` aún tiene `slice(0, 10)` (línea larga, no se comprobó su uso completo). La tabla de zonas es de 19 aeropuertos (ver B-090). |
| B-016 | L18 | Los demás servicios y el Gateway no toleran un BOM UTF-8 al inicio del `.env` | Vigente | d | Baja | S | G4 | Verificado: solo `esb-service/src/load-env.ts` lo trata. Afecta al entorno local en Windows PowerShell 5.1. |
| B-017 | L19 | Migrar de Zod 3 a Zod 4 y retirar la excepción `GHSA-mrhx-c7xc-m3w5` | Resuelta | e | — | — | — | `d91f3b4` (F11d-1, 2026-10-25). Verificado: todos los workspaces en `zod ^4.6.6` (instalado 4.6.7) y `security/npm-audit-exceptions.json` con `"exceptions": []`. |
| B-018 | L21, L220, L221 | Scripts `test` por servicio: esb, graphql, inventory y ticketing no lo tienen (`npm test -w` falla con «Missing script») | Vigente | d | Baja | S | G4 | Verificado: tienen `test` ancillaries, operations, pricing, reservation, webhooks, gateway y web; faltan esb, graphql, inventory, ticketing. La parte de «cargar solo su .env» no se comprobó. |
| B-019 | L22 | Aislar el cliente Prisma de inventory-service como el resto | Vigente | e | Baja | S | G4 | Verificado: `inventory-service/prisma/schema.prisma` no define `output`; pricing y ancillaries sí generan en `src/infrastructure/persistence/prisma-client`. Requiere redespliegue auditado. |
| B-020 | L23 | Integración de ticketing de ~30–40 s; su `afterAll` puede exceder el timeout bajo carga | Vigente | d | Baja | S | G1 | No re-ejecutado (requiere Postgres local administrado por el humano). Se conserva. |
| B-021 | L26 | OPS-05: idempotencia de `RecordOperationalUpdate` (no recerrar vuelo ni republicar) | Resuelta | c | — | — | — | Verificado: `operations/src/application/flight-status.ts:13-15` (`cancellationClosed`, `notifiedDepartureAt`). |
| B-022 | L27 | OPS-04: distinguir vuelo inexistente de Inventory no disponible | Resuelta | e | — | — | — | Verificado: `FLIGHT_STATUS_NOT_AVAILABLE` con 9 pruebas en `test/flight-status.spec.ts` (F10). |
| B-023 | L28 | OPS-SEC-01: pruebas de fecha inválida, campo extra y transición no permitida | Resuelta | b | — | — | — | Verificado: `test/security/operations-security.spec.ts` (8 menciones). |
| B-024 | L30 | `operations-service/scripts/smoke.cjs` debe aceptar el target como argumento y documentar variables | Vigente | d | Baja | S | G4 | Verificado: toma todo de variables de entorno (`smoke.cjs:7-12`), sin argumento. |
| B-025 | L32 | ancillaries compila a `dist/main.js` en la raíz del repo | Resuelta | e | — | — | — | Verificado: `tsconfig.json` con `outDir: dist` y Dockerfile con `microservices/ancillaries-service/dist/main.js`. |
| B-026 | L34 | ancillaries no carga su `.env` en local | Obsoleta | d | — | — | — | Ningún servicio carga `.env` desde `main.ts`; la plataforma local (`scripts/local-platform`) inyecta el entorno. Verificación solo por búsqueda en `main.ts`. |
| B-027 | L36 | El informe F7/audit-1 se perdió al recrear el clon del auditor | Obsoleta | i | — | — | — | Nota histórica; su resolución consta en `F7/audit-2.md`. Sin acción. |
| B-028 | L38 | Documentar `WEBHOOK_SECRET_ENCRYPTION_KEY` en `.env.example` de webhooks | Resuelta | e | — | — | — | Verificado: `webhooks-service/.env.example:6`. |
| B-029 | L40 | `npx dotenv` dejó de resolverse; usar `--env-file` o `dotenv-cli` | Obsoleta | d | — | — | — | Verificado: el `package.json` raíz no usa `dotenv-cli`; AGENTS.md ya fija `@dotenvx/dotenvx run -f .env.supabase`. |
| B-030 | L42–45 | Franquicia incluida por pasajero y owner en Ancillaries (F9) | Resuelta | c | — | — | — | Verificado: `ADR-F9-01-franquicia-por-pasajero.md`, `ADR-F9-04`, `ADR-F9-05`; la limitación de ADR-F8-06 fue la causa de esa tarea. |
| B-031 | L47 | La repetición idempotente de `CreateReservation` por gRPC devuelve la vista sin tickets (ADR-F8-05) | Vigente | e | Baja | S | G12 | No verificado en el código (el Gateway cubre la respuesta HTTP). Se conserva. |
| B-032 | L49 | Ordenar `pricingOptions` de forma determinista | Resuelta | e | — | — | — | Verificado: `pricing-service/src/application/search-offers.ts:105` ordena por precio, cabina y marca. |
| B-033 | L50, L84 | OP-02: `ResolveSegment` debe devolver el `offerId`; hoy un `offerId` inexistente o vencido con un segmento de otra oferta activa devuelve 200; actualizar ADR-F11-03 | Vigente | c | Media | M | G8 | Verificado: `ResolveSegmentResponse` solo trae `segment` (`pricing.proto:38`). Cambio aditivo del proto; un caso donde la oferta vencida no se detecta. |
| B-034 | L53 | Selecciones de tarifa por posición (`offers[0]`, `pricingOptions[0]`) | Resuelta | d | — | — | — | Verificado: sin `offers[0]` ni `pricingOptions[0]` en `pricing-hold-fixture.ts`, `resume-pending.ts` ni `post-sale-smoke.cjs`; el fixture elige por `fareBrand`. |
| B-035 | L54 | Exclusión de `ConfirmDateChange` por `changeOfferId` solo en memoria; confirmar que `markChangeOfferUsed` es atómico | Resuelta | c | — | — | — | Verificado: `prisma-offers.ts:51` usa `updateMany` con `usedAt: null` y `expiresAt > now`, y exige `count === 1`. |
| B-036 | L55 | El reembolso positivo (FLEX) solo se prueba de forma unitaria | Vigente | d | Baja | S | G12 | La condición (Pricing ordena `pricingOptions`) ya se cumple; falta el escenario real. |
| B-037 | L58 | Transacción de ancillaries (4 s + 4 s) puede superar el deadline gRPC de 5 s de Reservation | Vigente | f | Media | S | G5 | Verificado: `prisma-baggage.ts:12` mantiene 4000/4000 por omisión (ADR-F9-06 documenta el pool). Si en Cloud Run se configuraron variables distintas, no consta en el repo. |
| B-038 | L59, L211 | Los errores internos no registran causa: Pricing ya lo hace (`describeInternalError`); faltan los filtros de Inventory, Operations y los demás | Vigente | f | Media | S | G5 | Verificado: `describeInternalError` (shared) solo lo usa `pricing-service/.../filters.ts`. Sin él, un 500 en producción no se diagnostica. |
| B-039 | L60 | Confirmar con los logs de Cloud Run el código real del fallo de F9 (P2028) | Obsoleta | f | — | — | — | Investigación puntual de F9; ADR-F9-06 ya ajustó el pool y B-038 cubre el diagnóstico futuro. |
| B-040 | L63 | La prueba opt-in del smoke de postventa usa el puerto fijo 29661 | Vigente | d | Baja | S | G1 | Verificado: `rsv-12-real.spec.ts`. |
| B-041 | L64 | Archivos generados de `packages/contracts` salen modificados en el clon del auditor (reglas LF) | Resuelta | d | — | — | — | Verificado: `.gitattributes` fija `eol=lf` para `packages/contracts/src/generated/**`, `graphql-schema/generated/**` y `tokens.css`. |
| B-042 | L66, L79, L104, L113 | Seed de vuelos en Supabase: cubre 60 días desde 2026-10-25; renovar antes de que se agoten | Vigente | f | Alta | S | G6 | Verificado: la última renovación registrada es 2026-10-25 (`F11d1_deploy_1`), sin otra posterior; cubre hasta ~2026-12-24 y el procedimiento ya existe (`docs/dev/supabase-seed-renewal.md`). Sin vuelos futuros se detienen la compra y todos los smokes. Las líneas L66 y L104 hablan de «inicios de diciembre» (cifra anterior, ya vieja). |
| B-043 | L69 | Check-in en IN_PROGRESS tras caída de operations queda bloqueado | Resuelta | c | — | — | — | Verificado: `operations-service/src/application/recover-check-ins.ts` (F11c, scheduler). |
| B-044 | L70 | Si operations cae entre `complete` y `publish`, `booking.checked_in` no se publica | Resuelta | c | — | — | — | Verificado: `recover-check-ins.ts:22-26` reintenta `listUnpublished`. |
| B-045 | L71, L72, L83 | Pruebas faltantes: check-in con vuelo salido/cancelado o cupón no ISSUED, ConfirmSeats/ReleaseSeats, índice único de asiento CHECKED_IN, OP-05 liberar hold, hold de otro sub, listado ajeno | Vigente | d | Baja | M | G12 | No verificado una por una; el Gateway tiene las pruebas de recurso ajeno de PLT-SEC-03. Auditar la lista contra las suites actuales antes de trabajarla. |
| B-046 | L73 | Un asiento RELEASED aborta todo el check-in en vez de marcar solo a ese pasajero como FAILED | Vigente | c | Baja | M | G12 | No verificado en el código; comportamiento documentado en F10. |
| B-047 | L76 | El smoke de check-in no imprime vuelo, fecha ni minutos hasta la salida | Vigente | d | Baja | S | G4 | No verificado; cambio menor al script. |
| B-048 | L77 | La evidencia de despliegue debe incluir el `describe` de todos los servicios afectados | Lección | i | Baja | S | G11 | Regla de bitácora de despliegue. |
| B-049 | L82 | CI del Gateway solo ejecutaba `gateway.spec.ts` | Resuelta | d | — | — | — | Verificado: `gateway-ci.yml:22` ejecuta `npx jest platform/api-gateway/src --runInBand`. |
| B-050 | L85, L98 | Sin prueba con token partner contra rutas REST | Vigente | b | Baja | S | G12 | No verificado; hoy los canales partner (Booking) usan las rutas v2 y ESB, por lo que conviene confirmar la cobertura. |
| B-051 | L86 | El smoke de Supabase espera 403 en una ruta admin que llega en F11c | Obsoleta | d | — | — | — | La API admin interna existe desde `a9ae6f7` (F12c, `/api/admin/v1`). |
| B-052 | L89, L90, L92, L100, L243 | Arranques en frío en Cloud Run: 503 por plazo agotado (createReservation 6–7 s, checkIn), INTERNAL_ERROR tras 6953 ms, y 503 inmediatos del ESB (4–24 ms) en tareas programadas y `clientes.listar-eventos`; decidir entre instancias mínimas, precalentamiento o reintentos | Vigente | f | Alta | M | G2 | `2a6f682` respondió a audit-44: son transitorios preexistentes del escalado a cero; la decisión de costo sigue abierta (`f12b1-despliegue-esb.md:48`; el único `min-instances` en el repo es `0` en GraphQL). Afecta al cliente en el primer intento de cada flujo. Es F12d. |
| B-053 | L91 | El limitador de búsqueda responde 503 `RATE_LIMIT_EXCEEDED` cuando no consulta su almacén; usar `SERVICE_UNAVAILABLE` con `Retry-After`, documentar fallo cerrado y probar | Vigente | e | Baja | S | G5 | No localizado el punto exacto en `security.ts`/`v2-security.ts` (los 429 admin sí usan el código correcto). Se conserva; verificar al tomarlo. |
| B-054 | L95 | Las pruebas reales opt-in (`RUN_*_REAL`) usan el plazo de 5 s de Jest | Vigente | d | Baja | S | G1 | No verificado; se relaciona con las intermitentes por carga. |
| B-055 | L96 | Nombres de los it de F11b con `?` por codificación | Vigente | d | Baja | S | G4 | No verificado; el propio texto del BACKLOG tiene mojibake en varias líneas (L21–23, L42–45, L96, L103–L122, L134–L135). |
| B-056 | L97 | El Gateway tolera estados no declarados en `app.ts:83` | Vigente | e | Baja | S | G12 | No verificado (la línea pudo cambiar). |
| B-057 | L103 | FECHA LÍMITE 2026-11-23: vence la excepción de zod en `scripts/audit-policy.cjs` | Resuelta | b | — | — | — | Misma causa que B-017: `d91f3b4`; no queda excepción que venza. Hoy es 2026-11-22: ya no hay riesgo de CI roto mañana. |
| B-058 | L105 | `payloadData` de webhooks pasó a `.passthrough()` para aceptar `holdId` | Resuelta | b | — | — | — | Verificado: `webhooks-service/src/application/schemas.ts:5` es `.strict()` con `holdId` explícito. |
| B-059 | L106 | PLAN §1.3 (GAP-025) describe `hold.expired` como `{ status: "EXPIRED" }`; falta `holdId` (ADR-F11-13) | Vigente | i | Baja | S | G11 | Verificado: `PLAN.md:86` sin cambio. Es un documento fuente; cambiarlo lo decide el humano. |
| B-060 | L107 | Faltan pruebas de `PrismaSchedulerStore` contra Postgres y de la reversión de `RecoverCheckIns` (`markBlocked`) | Vigente | d | Baja | M | G12 | No verificado. |
| B-061 | L108 | `SCHEDULER_BATCH_SIZE` solo acota resume/recover; expireHolds y dispatch usan lotes fijos 500 y 100 | Vigente | e | Baja | S | G5 | No verificado. |
| B-062 | L110 | Operations notifica también a reservas ya canceladas; reintento de notificación fallida solo si el admin repite | Vigente | a | Media | S | G9 | No verificado en el código. Un socio puede recibir avisos de reservas que ya canceló. |
| B-063 | L111 | `webhook-security.spec.ts` no corre en CI | Obsoleta | d | — | — | — | Verificado: está en `test/security` y `deploy-webhooks.yml` corre solo `test/unit`, que es la regla de AGENTS.md (seguridad se ejecuta en local y en la auditoría). |
| B-064 | L115 | `deploy-hello.yml` fallaría con cambios en `platform/hello` | Resuelta | e | — | — | — | Hello retirado (la propia entrada lo marca). |
| B-065 | L117 | `gateway-ci.yml` no incluye `packages/contracts/**` | Obsoleta | d | — | — | — | Verificado: incluye `contracts/**` y `packages/shared/**`; el Gateway no importa `packages/contracts`. Sin efecto. |
| B-066 | L120 | `render-journeys.cjs` solo comprueba CORS si existe `SMOKE_CORS_ALLOWED_ORIGIN` | Vigente | d | Baja | S | G12 | Verificado: `render-journeys.cjs:244-248` imprime INFO y sigue. |
| B-067 | L121 | Matriz PLT-SEC-03: celdas de éxito sin releer el estado y celdas 401/403 sin comprobar ausencia de efectos | Vigente | b | Baja | M | G12 | No verificado. Refuerza pruebas de seguridad, no corrige un defecto. |
| B-068 | L122 | La negativa de ticketing a arrancar con `TICKETING_FAIL_MODE` depende de `NODE_ENV === 'production'` | Vigente | b | Baja | S | G13 | No verificado; el Dockerfile lo fija. |
| B-069 | L125, L126 | `render-journeys.cjs` no valida el cuerpo completo de `hold.expired` contra `WebhookPayload`; la firma real solo se verifica contra Render | Vigente | d | Baja | S | G12 | No verificado. |
| B-070 | L129 | Pricing: `pricePerPassengerType` trae `TOTAL` y `CHILDRE`; el Gateway v2 los filtra y normaliza | Vigente | e | Media | S | G8 | Verificado: `api-gateway/src/v2/shapes.ts:7` aún mapea `CHILDRE → CHILD`. Es un parche en el Gateway de un nombre mal escrito en Pricing; Booking solo ve el resultado limpio. |
| B-071 | L130 | Aceptar 202 con pago pendiente en equipaje y cambio de fecha (el contrato v2 lo admite) | Vigente | a | Media | M | G8 | Verificado: `v2/booking.controller.ts:90` devuelve 422 `PAYMENT_NOT_AUTHORIZED` (ADR-F12-04). |
| B-072 | L131 (CHECKED_IN) | `CHECKED_IN` del panel desde los check-ins de operations | Resuelta | a | — | — | — | `ADR-F12a2-02-checked-in-panel-operaciones.md` y `cae353b` (CHECKED_IN en el mapa de asientos). |
| B-073 | L131 (resto) | `BOARDED` (sin proceso de abordaje), `HELD` por asiento en el panel y `BOOKED` mientras la emisión v2 sea inmediata | Vigente | h | Baja | M | G9 | `HELD` se resolvió en `cae353b`; `BOARDED` sigue sin proceso que lo produzca. |
| B-074 | L134 | Redacción de logs sin `x-webhook-signature`, `x-api-key`, `x-user-id`, `x-device-fingerprint` | Resuelta | b | — | — | — | Verificado: `packages/shared/src/logger.ts:7-8`. La prueba de logs v2 no se localizó. |
| B-075 | L135 | `booking-events` sin `BOOKING_EVENTS_CLIENT_ID` apunta a reservas de cualquier cliente | Resuelta | b | — | — | — | Verificado: `api-gateway/src/config.ts:136` se niega a arrancar (salvo `NODE_ENV=test`). |
| B-076 | L136 | Rotar la contraseña de `svc_gateway` que estuvo en `.env.supabase.example` (commit `00a0a30`) | Vigente | b | Alta | S | G13 | No verificable desde el repo; solo el humano sabe si se rotó. Una credencial en el historial de git sigue siendo válida mientras no se rote. |
| B-077 | L137 | Relleno opcional de `boarding_passes.cabin_class` anteriores a la migración `20261027220000` | Vigente | c | Baja | S | G13 | No verificado; opcional (ADR-F12a2-02). |
| B-078 | L139, L141 | PRC-12 con `-t`: Jest no termina (recurso abierto, cliente gRPC) | Resuelta | d | — | — | — | Verificado: `inventory-real.spec.ts:63-68` cierra `inventoryClient`, `client` y las apps en `afterAll`. La entrada está duplicada. |
| B-079 | L144 | La búsqueda aplica `SEARCH_MAX_OFFERS` por tramo antes de combinar y puede devolver cero ofertas en multidestino | Resuelta | a | — | — | — | Verificado por lectura: `search-offers.ts:62-79` combina con un haz acotado que se ensancha hasta hallar combinaciones. `ADR-F12a2-01`. |
| B-080 | L145 | `CHECKED_IN` del panel debe excluir infantes sin asiento propio | Vigente | a | Baja | S | G9 | No verificado (no hay mención de infantes en `operations.controller.ts`). |
| B-081 | L146 | Una prueba del Gateway falló una vez en el clon limpio | Vigente | d | Baja | S | G1 | Observación, no reproducida. |
| B-082 | L151 | Rutas v2 protegidas con barra final o mayúsculas, sin token y cuerpo inválido, responden 400 en vez de 401 | Vigente | b | Baja | S | G13 | No verificado. No filtra datos, pero el orden de las validaciones difiere entre rutas. |
| B-083 | L152 | PLT-A/B e I5/I6 (`real-stack.e2e.spec.ts`) falló una vez | Vigente | d | Baja | S | G1 | Observación, no reproducida. |
| B-084 | L153 | Las pruebas de `BOOKING_EVENTS_CLIENT_ID` no fijan explícitamente el caso `test` | Vigente | d | Baja | S | G12 | Verificado: la excepción `NODE_ENV !== 'test'` sigue en `config.ts:136`. |
| B-085 | L155 | `infra/scripts/gcp-setup.sh` no incluye el ESB | Vigente | f | Baja | S | G2 | Verificado: ninguna mención a `esb` en el script. Nota: `infra/` no lo toca el developer (AGENTS.md); lo hace el humano. |
| B-086 | L158 | `booking.ticket_issuing` está permitido y en contratos pero ningún servicio lo emite | Vigente | g | Media | S | G7 | Reservation sí tiene el estado `TICKET_ISSUING` (`create-reservation.ts:107`), no se comprobó que emita el evento. Decidir con Booking si lo necesitan (F12b-3). |
| B-087 | L159 | Herramienta de reproceso de `q.webhooks.entrega.fallidos` y alarma por tamaño | Vigente | f | Media | M | G7 | Hoy es manual desde la consola de RabbitMQ (ADR-F12b-05). Una entrega fallida a un socio queda sin que nadie lo vea. |
| B-088 | L160–161 | Fallo intermitente de `p1-security.e2e.spec.ts` en la segunda corrida completa | Vigente | d | Baja | S | G1 | Observación; pasó aislado 49/49. |
| B-089 | L162 | Renombrar `ADR-F12c-01-pago-booking-cubre-tarifa.md` | Resuelta | e | — | — | — | Hecho en F12c-0: ahora `ADR-F12b2fix-02-…` (verificado en `docs/dev/adr/`). |
| B-090 | L165 | Puerta de embarque (`gate`) en `GET /vuelos/flights/{n}/status` y en los pases v2 | Vigente | a | Alta | S | G8 | Verificado: `departureGate` solo aparece como entrada en `v2/operations.controller.ts`; ninguna respuesta del Gateway devuelve `gate`, aunque el contrato v2 ya lo declara. El pasajero no ve su puerta. |
| B-091 | L166 | Salud del bus de eventos en el panel y en `/api/v2/vuelos/health` | Vigente | f | Media | S | G2 | Verificado: `v2/health.controller.ts` solo reporta los servicios que sondea el ESB. |
| B-092 | L167, L186 | Catálogo de aeropuertos/rutas y de vuelos por origen (hoy configuración estática, 19 aeropuertos aunque no todos operen) | Vigente | h | Media | M | G14 | Verificado: tabla única de zonas (`airport-time.ts`). Un cliente puede elegir un aeropuerto sin vuelos. |
| B-093 | L169 | v1 `POST /bookings` con `passengerId` no UUID responde 500 (P2023) en vez de 400 | Vigente | a | Media | S | G12 | No confirmado: `baggageSchema` ya exige GUID (`reservation.controller.ts:31`) pero no se pudo leer el esquema de `createReservation` (línea 23, muy larga). Verificar con una prueba. |
| B-094 | L172 | Migraciones históricas sin esquema calificado | Obsoleta | e | — | — | — | Decisión aceptada (ADR-F12b1fix-03): ya aplicadas, cambiarlas rompe la suma de verificación; `check-raw-sql.cjs` vigila las nuevas. |
| B-095 | L175 | PST-07 / C de Reservation falló una vez (esperaba `QUOTE_EXPIRED`) | Vigente | d | Baja | S | G1 | Revisar si depende del tiempo de vencimiento de la cotización. |
| B-096 | L176 | V2-P1-43 del Gateway falló una vez (503) | Vigente | d | Baja | S | G1 | Posible arranque lento de un servicio en la suite. |
| B-097 | L178 | La paginación de `GET /api/v2/vuelos/bookings` no funciona en la nube | Resuelta | a | — | — | — | `7f3c4d5` (F12c-1: «paginación de mis reservas»), `audit-27` APROBADO. |
| B-098 | L180 | `f12c1-graphql-despliegue.md` §2: orden de creación y nombre antiguo de ADR | Vigente | i | Baja | S | G11 | No verificado. |
| B-099 | L183 | `render.yaml`: verificar la URL de GraphQL antes de publicar | Obsoleta | f | — | — | — | La web ya se publicó y auditó (`6a78ac9`, `audit-29`). |
| B-100 | L184 | Web sin recarga en caliente de React | Vigente | h | Baja | S | G14 | Comodidad de desarrollo. |
| B-101 | L185 | Web sin `eslint-plugin-react-hooks` | Vigente | e | Baja | S | G14 | Verificado: no está en los `package.json`. Sin esa regla, un hook mal usado no lo detecta el lint. |
| B-102 | L187 | Fotografías CC BY / CC BY-SA de la marca provisional | Vigente | g | Baja | S | G10 | Reemplazar al definir la marca; hasta entonces el crédito visible es obligatorio. |
| B-103 | L188 | Al subir a Node 22: Vitest 5, jsdom, `@supabase/auth-js`, etc. | Vigente | e | Baja | M | G4 | `.nvmrc` sigue en Node 20 (AGENTS.md). |
| B-104 | L189 | `npm audit` informa vulnerabilidades bajas y moderadas de las dependencias de la web | Vigente | b | Baja | S | G13 | No re-ejecutado. CI solo bloquea nivel `high`. |
| B-105 | L191 | `rsv-12-real.spec.ts` falló una vez (1 de 280) | Vigente | d | Baja | S | G1 | Observación, no reproducida. |
| B-106 | L193 | `npm run codegen:check` no existe en la raíz | Vigente | e | Baja | S | G4 | Verificado: no hay script raíz; existe `-w @flight-platform/graphql-schema`. |
| B-107 | L195 | Documentar CORS sin barra final y sufijo de Render | Vigente | i | Baja | S | G11 | No verificado en `f12c2a-web-despliegue.md`. |
| B-108 | L197, L201 | E2E-07 de la web falló una vez (foco de ventana con la máquina ocupada) | Vigente | d | Baja | S | G1 | Entrada duplicada en el BACKLOG. |
| B-109 | L198, L202 | El mapa de asientos de una reserva pasa el `bookingId` donde va el `offerId` (ADR-F12c2b-01) | Vigente | e | Baja | M | G14 | Se rompe si el Gateway llega a validar que la oferta existe. Duplicada en el BACKLOG. |
| B-110 | L199, L203 | Tras construir la web con valores de producción, `local:up` debe correr sin `-SkipBuild`; en PowerShell 5.1 las variables con JSON van con `--env-file` | Lección | i | Baja | S | G11 | Duplicada en el BACKLOG. |
| B-111 | L205 | Dos holds simultáneos de la misma oferta: el segundo recibe 500 | Resuelta | c | — | — | — | `8a39a38` (ADR-F12b1fix-04), `audit-37` APROBADO. Verificado: `describeInternalError` y el traductor compartido existen. |
| B-112 | L207 | Pricing ignora un total distinto al guardar una tarifa; debe rechazarse | Vigente | c | Media | S | G8 | Verificado: `fare-admin.ts` calcula siempre `base + tasas` (`:21`, `:39`). Quien edita cree haber fijado un total que no se guardó. |
| B-113 | L208 | E2E-16 de la web intermitente tras volver a iniciar sesión (¿se pierde algún dato del formulario?) | Vigente | a | Media | S | G1 | Podría ser un defecto real del formulario tras sesión vencida, no solo ruido; reproducir con la versión nueva del formulario. |
| B-114 | L209 | El e2e del panel retrasa un vuelo local en cada corrida | Vigente | d | Baja | S | G1 | Reponer con `npm run local:seed`. |
| B-115 | L213 | Operación manual: creación de FP210 UIO→GPS | Resuelta | h | — | — | — | `207055b` (F12c-4c: crear vuelos desde el panel). |
| B-116 | L214 | Operación manual: check-in de J4R8GZ por el ESB con la llave interna | Resuelta | h | — | — | — | `207055b` (F12c-4b). |
| B-117 | L231 | Retirar el procedimiento manual con la llave interna de los apuntes del operador | Obsoleta | i | — | — | — | Depende de B-115 y B-116; es una nota personal fuera del repo. |
| B-118 | L217 | Cancelar reservas ajenas desde el panel | Vigente | h | Baja | L | G9 | Fuera de alcance de F12c-4 (decisión del humano, ADR-F12c4-01). |
| B-119 | L218 | Listado del registro de accesos del administrador en el panel | Vigente | h | Media | M | G9 | Hoy solo SQL (`docs/dev/f12c4a-pnr-despliegue.md` §4). Es el control del acceso a datos de clientes. |
| B-120 | L219 | Depurado del registro de accesos a los 12 meses (tarea manual con rol propietario) | Vigente | f | Baja | S | G2 | Sin fecha apremiante: la tabla es de 2026-11-15. |
| B-121 | L222 | La búsqueda por PNR falla completa si Operations no responde; ¿disponibilidad frente a integridad? | Vigente | g | Baja | S | G10 | Decisión del humano (ADR-F12c4-01). |
| B-122 | L224 | Filas de prueba de `admin_access_log` (actor `it-…`) no se pueden borrar | Vigente | d | Baja | S | G1 | Verificado: tabla de solo inserción por trigger; se depuran con el procedimiento de `f12c4a-pnr-despliegue.md` §5. |
| B-123 | L223 | BUS-I10 del ESB falló en la suite real completa y pasó sola | Vigente | d | Media | M | G1 | Hipótesis: depende de los datos acumulados en `outbox_events`. Mismo origen que B-132 y B-135. |
| B-124 | L225 | La orquestación «crear vuelo con tarifas» vive en el Gateway (`AdminApiController.executePlan`), no en el ESB | Vigente | e | Media | L | G7 | Deuda explícita para F12b-3 (ADR-F12c4-01 §2). |
| B-125 | L226 | Índice único `(flight_number, departure_local_date)` en Inventory no creado | Vigente | c | Media | M | G7 | Verificado: ningún `departure_local_date` en Inventory. La unicidad la comprueba la aplicación con ventana de carrera entre dos administradores. Migración aditiva ya propuesta; decisión del humano. |
| B-126 | L227 | Columnas `performed_by_role` / `performed_by` en check-ins de Operations | Vigente | h | Baja | M | G9 | El actor queda solo en `gateway.admin_access_log`. |
| B-127 | L228 | Una repetición de la misma `Idempotency-Key` no escribe otra fila en el registro de accesos | Obsoleta | i | — | — | — | Decisión de diseño ya documentada; no es una tarea. |
| B-128 | L229 | `OpenFlightInstance` abre un vuelo cerrado sin comprobar tarifas | Vigente | c | Baja | M | G7 | La comprobación está en el Gateway; una llamada directa a Inventory con rol admin podría abrir un vuelo sin tarifas. |
| B-129 | L230 | Falta «Cerrar vuelo» en el panel | Vigente | h | Baja | S | G9 | Solo `closeFlightInstance` (v1 deprecada, sin pantalla). |
| B-130 | L233 | Timeout de 5 s en `webhook-emitters.e2e.spec.ts` en la primera corrida | Vigente | d | Baja | S | G1 | Observación de audit-42. |
| B-131 | L234 | Apertura de vuelo: el servidor exige al menos una tarifa por cabina, no el conjunto de marcas que quiso crear el admin | Vigente | c | Media | M | G7 | Pendiente de decisión del humano: persistir el conjunto esperado, o exigir marcas obligatorias por cabina. Un vuelo puede abrirse con una marca (p. ej. Flex) faltante. |
| B-132 | L235 | PST-03/04 de `rsv-12-real` falla de forma estable en la base local (`sold = 1`) desde 2026-11-15 | Vigente | d | Media | M | G1 | No re-ejecutado (la base local la administra el humano). Hipótesis: vuelos creados por el e2e de F12c-4c cambian el vuelo elegido. Bloquea la verificación local del cambio de fecha. |
| B-133 | L237 | Mitigación temporal `HIDDEN_CABINS` y fallo de la compra en BUSINESS (`allocationOf` fijaba `ECONOMY`) | Resuelta | a | — | — | — | `f750ed9` (compra en ejecutiva), `audit-50/51` APROBADO, `323211d`: variable borrada en Render. Verificado: ya no hay `cabinClass: 'ECONOMY'` fijo en `reservation-service/src`. |
| B-134 | L237 (resto) | El mecanismo `HIDDEN_CABINS` sigue en el código del Gateway (`config.ts`, `hold.controller.ts`, `shopping.controller.ts`, `hidden-cabins.spec.ts`) | Vigente | e | Baja | S | G13 | Verificado. Dejarlo como interruptor de emergencia o retirarlo: decisión del humano. |
| B-135 | L238 | `hold-concurrency-inventory-real.spec.ts` de Pricing: 1 de 2 falla con `OFFER_NO_LONGER_AVAILABLE` en la base local | Vigente | d | Media | M | G1 | No re-ejecutado. Mismo origen que B-132. |
| B-136 | L240 | Lección: una rama construida sobre otra que entró con `--squash` se resuelve tomando el árbol aprobado (`git checkout <rama> -- .`) | Lección | i | Media | S | G11 | Ver sección de lecciones. |
| B-137 | L241 | Lección: ninguna prueba compraba en BUSINESS con asiento; cada cabina vendible necesita e2e, suite real y humo | Lección | i | Alta | S | G11 | Ver sección de lecciones; se concreta en B-012. |
| B-138 | L244 | `local:up` con otro programa en el puerto 3000 (Gateway responde HTML) | Vigente | d | Baja | S | G4 | Verificado: `common.ps1` define `Test-PortOpen` y `down.ps1` lo usa; no se comprobó que `up.ps1` verifique los puertos libres antes de arrancar. |

## Propuesta de próximas entregas (en orden)

El orden pone primero lo que tiene fecha o toca a clientes y socios, luego lo que ahorra tiempo a las demás entregas, y deja para después lo que depende de decisiones.

### 1. Cierre operativo antes del 21 de diciembre (S–M)
- **Alcance:** B-042 (renovar el seed con el procedimiento de `docs/dev/supabase-seed-renewal.md`, y decidir si se vuelve automático para no repetir esta fecha); B-076 (confirmar la rotación de `svc_gateway`); B-038 y B-037 (registrar tipo y código de la causa en los filtros de Inventory y Operations, y ajustar o documentar los plazos de la transacción de Ancillaries frente al deadline de 5 s de Reservation); B-085 (agregar el ESB a `gcp-setup.sh`; lo hace el humano porque `infra/` está vedado al developer).
- **Por qué primero:** sin vuelos futuros se detienen la compra y los smokes; la rotación y el diagnóstico de los 500 son las únicas piezas de seguridad y operación con riesgo hoy.
- **Prueba de aceptación:** consulta de vuelos futuros tras el seed; prueba unitaria de cada filtro que verifique que el log trae tipo y código sin mensaje.

### 2. Comportamiento visible para Booking y clientes (M)
- **Alcance (G8, sin cambiar `contracts/openapi/`):** B-090 (devolver `gate` en el estado del vuelo y en los pases; el contrato v2 ya lo declara); B-071 (aceptar 202 con pago pendiente en equipaje y cambio de fecha, que el contrato ya admite); B-112 (Pricing rechaza con `VALIDATION_FAILED` el total que no cuadra); B-070 (corregir `CHILDRE` y separar `TOTAL` en Pricing, y quitar el parche del Gateway); B-033 (`ResolveSegment` devuelve `offerId`: cambio aditivo de `pricing.proto` con ADR y actualización de ADR-F11-03); B-093 (confirmar con una prueba y, si se reproduce, validar el formato en Reservation).
- **Por qué segundo:** son los defectos con efecto directo en pasajeros y en el dinero de las ofertas, y están acotados.
- **Fuera de esta entrega:** B-011 (publicar el máximo de maletas) cambia el contrato; queda como decisión.

### 3. Estabilizar pruebas y entorno local (M)
- **Alcance:** G1 (B-123, B-132, B-135 con un vuelo propio por prueba o limpieza de datos locales; B-040 puerto libre dinámico; B-054 plazo propio para `RUN_*_REAL`; reproducir B-113, que podría ser un defecto real del formulario); G4 (scripts `test` en esb, graphql, inventory y ticketing; alias `codegen:check` en la raíz; verificación de puertos libres en `local:up`; BOM en `.env`; aceptar target en `smoke.cjs`).
- **Por qué tercero:** no cambia el producto, pero hoy una suite local falla de forma estable (PST-03/04) y puede esconder regresiones reales; las entregas posteriores se verifican mejor con esto hecho.
- **Prueba de aceptación:** las suites reales de Reservation, Pricing y ESB pasan dos veces seguidas sin limpiar la base.

### 4. F12d — operación en la nube (M, con decisión previa)
- **Alcance:** B-052 (instancias mínimas en el ESB y en los servicios críticos, o precalentamiento, o reintentos con espera en las tareas programadas), B-091 (salud del bus), B-087 (herramienta de reproceso de la cola de fallidos y alarma por tamaño), B-120 (depurado a 12 meses).
- **Condición:** el humano decide primero el costo de las instancias mínimas (decisión 2 abajo).
- **Después:** F12b-3 (G7: orquestación en el ESB, índice único, apertura de vuelos con el conjunto esperado, `ticket_issuing`) es una entrega mayor (L) que depende de las decisiones 4, 5 y 6; las ampliaciones del panel (G9) llegan tras ella.

## Decisiones que necesitan al humano o a Booking

| # | Decisión | Entradas | Quién | Por qué importa |
|---|---|---|---|---|
| 1 | Edad por tipo: PLAN Q-010 (YOUTH 12–15, ADULT ≥ 16 a la fecha del último tramo) o la regla actual (12–17 y ≥ 18 a la fecha de hoy) | B-002 | Booking y humano | Define quién puede reservar como adulto; si cambia es un solo archivo compartido, pero Booking debe aplicar lo mismo. |
| 2 | Instancias mínimas (costo) frente a reintentos con espera para el escalado a cero | B-052 | Humano | Decide si el primer intento de cada flujo puede fallar con 503. |
| 3 | Confirmar si se rotó la contraseña de `svc_gateway`, y quién y cuándo renueva el seed | B-076, B-042 | Humano | Seguridad y continuidad con fecha. |
| 4 | Persistir el conjunto esperado de tarifas por vuelo, o exigir un conjunto fijo de marcas por cabina | B-131, B-128 | Humano | Hoy un vuelo puede abrirse con una marca faltante. |
| 5 | Crear el índice único `(flight_number, departure_local_date)` con la migración aditiva ya propuesta | B-125 | Humano | Cierra la ventana de carrera entre dos administradores; requiere consulta previa de duplicados. |
| 6 | ¿Necesita Booking el evento `booking.ticket_issuing`? | B-086 | Booking | Si no, se quita de la lista permitida; si sí, F12b-3 lo emite. |
| 7 | Publicar el máximo de maletas con la oferta (cambia el contrato OpenAPI) | B-011 | Humano y Booking | Hoy la web duplica el valor del servidor. |
| 8 | ¿Se imponen en el servidor la cédula de 10 dígitos para Ecuador y los límites de fechas de nacimiento y expiración? | B-007, B-009 | Humano y Booking | Hoy solo la web los aplica; un socio puede enviar otros valores. |
| 9 | La búsqueda por PNR: ¿disponibilidad (mostrar el check-in «desconocido») o integridad (fallar)? | B-121 | Humano | Comportamiento ante la caída de Operations. |
| 10 | ¿Conservar `HIDDEN_CABINS` como interruptor de emergencia o retirar su código? | B-134 | Humano | Hoy la variable está borrada pero el mecanismo sigue. |
| 11 | Actualizar PLAN §1.3 (GAP-025) con `holdId` en `hold.expired` | B-059 | Humano (fuente) | El plan describe un cuerpo distinto del real. |
| 12 | Alcance nuevo: cancelar reservas ajenas, listado del registro de accesos, premium y primera clase (siembra de tarifas), catálogo de rutas | B-118, B-119, B-012, B-092 | Humano | Orden y prioridad de ampliaciones; el listado del registro es el control de acceso a datos de clientes. |
| 13 | Marca definitiva y reemplazo de las fotos CC BY | B-102 | Humano | Crédito obligatorio mientras sean provisionales. |
| 14 | Qué entradas se cierran en `BACKLOG.md` | Resueltas: B-001, B-003, B-010, B-014, B-017, B-021, B-022, B-023, B-025, B-028, B-030, B-032, B-034, B-035, B-041, B-043, B-044, B-049, B-057, B-058, B-064, B-072, B-074, B-075, B-078, B-079, B-089, B-097, B-111, B-115, B-116, B-133. Obsoletas: B-026, B-027, B-029, B-039, B-051, B-063, B-065, B-094, B-099, B-117, B-127 | Humano | Son las 43 que el repaso no encontró vigentes; el repaso no las borró. |

## Lecciones de proceso (para llevar a la documentación de flujo)

Candidatas a `AGENTS.md` («Reglas aprendidas») o a `docs/audit/context/flujo-cierre.md`; no se editó ninguno de los dos.

1. **Cada cabina vendible se prueba de punta a punta (B-137, B-012).** La compra en BUSINESS con asiento falló en producción porque ninguna prueba (e2e, suite real ni humo posterior al despliegue) la cubría. Regla propuesta: la prueba de humo de cada despliegue y la suite real recorren una compra por cada cabina que el inventario vende.
2. **Ramas apiladas sobre una que entra con `--squash` (B-136).** Con otro `--squash` aparecen conflictos por los mismos cambios por dos caminos; se toma el árbol aprobado (`git checkout <rama> -- .`) y se comprueba que la diferencia con la rama quede vacía.
3. **Prueba intermitente: guardar la salida completa al primer fallo.** Varias entradas (B-081, B-083, B-088, B-095, B-096, B-105, B-130) dicen «falló una vez» sin guardar el detalle; sin el mensaje no se puede diagnosticar. Regla propuesta: al ver un fallo no reproducible, adjuntar la salida completa y el commit a la bitácora.
4. **Toda excepción traducida a un error genérico registra tipo y código de la causa, sin datos personales (B-038).** El 500 de los holds concurrentes se tardó en diagnosticar porque el registro solo decía «internal error: Error».
5. **Verificar los despliegues con el `describe` de todos los servicios afectados, no solo los modificados (B-048).**
6. **Verificaciones locales con la web de producción (B-110):** tras construir la web con valores de producción, `local:up` corre sin `-SkipBuild`; en PowerShell 5.1 las variables con JSON se pasan a Docker con `--env-file`.
7. **Dependencias con metadatos que envejecen (B-008):** actualizar `libphonenumber-js` a su ritmo y registrar la versión.
8. **Archivos del BACKLOG en UTF-8.** El propio BACKLOG tiene texto dañado por la codificación; los archivos de proceso se guardan en UTF-8 sin BOM.
9. **Notas del BACKLOG con fecha y estado.** Este repaso encontró 43 de 138 entradas que ya no estaban vigentes (31 %), incluida una «fecha límite» ya superada. Al resolver algo, marcar la línea en la misma entrega evita repasos grandes después.
