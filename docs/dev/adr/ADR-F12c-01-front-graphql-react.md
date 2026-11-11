# ADR-F12c-01 — Front: GraphQL antes que la app, React web y luego React Native, solo v2, panel admin solo web, reparto V1/después
- Estado: **Propuesto** (revisión 2, pendiente de aprobación del humano) · Fecha: 2026-11-11 · Fase/Tarea: F12c-0
- Diseño completo: `docs/dev/f12c0-diseno-front.md`
- Nota de nombre: el ADR anterior con este prefijo (`pago-booking-cubre-tarifa`) pasó a `ADR-F12b2fix-02-pago-booking-cubre-tarifa.md` (decisión Q1 del humano).
## Contexto
La plataforma está en producción hasta F12b-2 y las correcciones posteriores. Falta el front. El contrato público v1 (`/flights/v1`) está **deprecado**; el contrato v2 (`/api/v2/vuelos`) es el vigente. Los contratos OpenAPI no cambian. Hay una plantilla visual (`plantilla-portal-aereo`) que reproduce la marca de LATAM Airlines y no tiene licencia.
## Decisión
1. **GraphQL antes que la app.** Diseño de pantallas y esquema (F12c-0), luego el servicio GraphQL (F12c-1, `platform/graphql`, capa 5), que llama al Gateway reenviando el JWT de Supabase y el `X-Correlation-Id`, sin guardar sesión. Las apps no hablan con el Gateway.
2. **Solo v2.** El servicio GraphQL, la web y el móvil usan únicamente `/api/v2/vuelos` para el cliente. Nada llama a `/flights/v1`. El dueño de un usuario de Supabase en v2 es su `sub` (verificado en el código; sin ajuste).
3. **React web y luego React Native**, con paquetes compartidos (operaciones y tipos GraphQL, sesión, formato, tokens de diseño y marca).
4. **Panel de administrador solo web y solo para `admin`**, en la misma app (`/admin`, carga perezosa). Autorización real en el servicio GraphQL (`@admin`) y el Gateway. Usa lo que ya existe en v2 (panel de operaciones, PATCH de estado, acuerdo de promociones) y una **API interna de administración** nueva (B-2), separada del contrato v2 con Booking, para lista de vuelos con ids y tarifas.
5. **Pago.** Pago simulado, único método, rotulado de prueba. Hoy un cliente de Supabase no pasa por la verificación de Booking y cae en el verificador simulado por omisión; se propone un **canal `WEB` explícito** (B-1) que decide el Gateway solo por el rol del token. Se decide aparte.
6. **Reparto V1/después.** V1: públicas, cliente (incluida postventa y check-in) y admin (dashboard, vuelos y estado, tarifas, promociones); ida, ida y vuelta y multidestino. Después: perfil, socios y webhooks, telemetría (F12d), catálogo por origen, creación y cierre de vuelos, «buscar mi reserva» (propuesta tras hablar con Booking). Puerta de embarque y salud del bus: BACKLOG con prioridad alta.
7. **Diseño visual.** La plantilla es referencia de pantallas y estructura; no se copian su código ni activos. Marca provisional concentrada en `packages/design-tokens` y `packages/brand`.
8. **Autenticación.** Supabase Auth con PKCE desde el cliente; las credenciales no pasan por GraphQL ni el Gateway.
9. **Seguridad del servicio GraphQL.** Solo operaciones conocidas en producción; introspección desactivada en producción; límites de profundidad, complejidad y tamaño; CORS por lista blanca; sin datos personales ni tokens en logs; límite propio por huella de dispositivo + IP real (riesgo conocido: la huella la controla el cliente).
10. **Elección de librerías (cliente y servidor GraphQL)** en F12c-1. Criterios: el cliente funciona igual en React Native, licencias permisivas, `npm audit` sin altas ni críticas, el SDL es el contrato.
11. **Despliegue.** GraphQL en Cloud Run; web en Render Static. Estado de carga amable para arranques en frío y servicio GraphQL en el precalentamiento.
## Consecuencias
- Nuevos workspaces: `platform/graphql`, contenido de `platform/web`, `packages/{graphql-schema,session,format,design-tokens,brand}`; `apps/mobile` después.
- **Cambios de backend previos a F12c-1** (diseño §14): B-1 canal de pago `WEB` y B-2 API interna de administración (bloqueantes); topes por usuario, puerta, salud del bus y precalentamiento (recomendados). No se modifican los contratos OpenAPI.
- Pruebas previas con tokens reales (S-1 a S-6), incluido el aislamiento entre clientes y frente a socios.
- No se modifican contratos, servicios, workflows ni `infra/` en F12c-0.
