# F12c-3 — Panel de administrador de la web

Complementa `docs/dev/f12c2a-web-despliegue.md` y `docs/dev/f12c2b-web-compra.md`. Diseño: `docs/dev/f12c0-diseno-front.md` (§3.13, §4 R4, §5, §6, §10.3). Decisiones: `ADR-F12c3-01`, `ADR-F12c3-02` y la adenda de `ADR-F12c-04`.

**Nada de esto se ejecuta solo:** lo despliega el humano, después de la auditoría de código y desde `main`.

## Orden de despliegue (obligatorio)

1. **`graphql-service` primero.** Esta entrega agrega la consulta `adminWebBookings` (y su operación publicada `AdminWebBookings`: ahora **29** operaciones). Producción solo acepta operaciones publicadas: si la web nueva se publica antes, la pantalla «Reservas web» recibiría `GRAPHQL_OPERATION_NOT_ALLOWED`. Workflow: `deploy-graphql`. Sin cambios de variables.
2. **La web después** (Render, *Manual Deploy*). Sin variables nuevas: el panel no necesita configuración propia.

El Gateway, los microservicios y los contratos no cambian (la API interna `/api/admin/v1/web-bookings` ya está en producción).

## Qué hay

Ruta `/admin` (fragmento cargado aparte; no se descarga para los clientes): Dashboard (ocupación por cabina de los vuelos de una fecha y salud de la plataforma, con actualización cada 30 s), Vuelos (lista y cambio de estado con confirmación), Tarifas, Promociones y Reservas web (solo lectura). «Socios y webhooks» y «Telemetría» son de F12d. La salud del bus de eventos (H-8) no existe todavía: el panel muestra solo lo que reporta `platformHealth`.

## Comprobaciones después de publicar (las hace el humano con un usuario REAL con rol admin)

Un token real de Supabase con `app_role = admin` (hook de Supabase) y el scope `flights:admin`. Comandos contra Supabase, solo el humano.

- Con un **cliente**: `/admin` muestra «No tienes permiso para esta sección»; el enlace «Administración» no aparece; en la pestaña de red no se pide el fragmento `AdminRoutes-*.js`. Una llamada directa a una operación `@admin` devuelve `FORBIDDEN` (GraphQL) y, contra el Gateway, 403 (S-2, S-6).
- Con un **admin**: el dashboard muestra la ocupación y la salud (con un servicio detenido, `DEGRADED`); en Vuelos, un cambio reversible (p. ej. a `BOARDING`) y, en un vuelo de prueba, un retraso con hora estimada (pide escribir el número del vuelo); el estado público del vuelo lo refleja; `INVALID_STATUS_TRANSITION` se explica.
- Tarifas: editar y restaurar un importe de un vuelo de prueba (la confirmación muestra antes y después). Promociones: ver el acuerdo; el descuento fuera de 0–100 se rechaza antes de enviar.
- Reservas web: aparecen las compras de prueba del canal web, sin datos personales (el titular es un hash opaco).
- Una sesión vencida lleva a «Tu sesión expiró» y, al volver a entrar, al mismo punto del panel.

## Local

```powershell
npm run local:up -- -SkipDocker -Web      # SIN -SkipBuild: se reconstruye graphql y la web (nueva operación)
npm run test:e2e -w @flight-platform/web  # incluye el panel (admin.e2e.ts); el administrador sale del acceso local de pruebas
npm run local:down
```

El e2e del panel retrasa un vuelo de prueba lejano (8 a 14 días; un retraso no se deshace) y, si no hay uno programado, la prueba se marca como no aplicable: `npm run local:seed` repone los datos. El administrador local lo crea el propio e2e con `POST /local/admin-user` (ADR-F12c3-02).
