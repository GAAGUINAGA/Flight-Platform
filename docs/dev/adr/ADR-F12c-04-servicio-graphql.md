# ADR-F12c-04 — Servicio GraphQL: Express + graphql-js, SDL como contrato, operaciones conocidas y límites propios
- Estado: Aceptado · Fecha: 2026-11-12 · Fase/Tarea: F12c-1
- Concreta `ADR-F12c-01-front-graphql-react` (decisión 10: «elección de librerías en F12c-1»). Diseño: `docs/dev/f12c0-diseno-front.md` §6–§10.

## Contexto
El plan pedía el servicio GraphQL (`platform/graphql`) con el SDL de §6.1, errores de §6.3, reglas de §7 y despliegue de §9. Criterios del diseño (Q5): licencias permisivas, `npm audit` sin altas ni críticas, el SDL es el contrato, y el cliente (otra fase) funciona igual en React Native.

## Decisión
1. **Servidor: `graphql` 16.11.0 (graphql-js, MIT) sobre Express 5**, sin NestJS ni Apollo/Yoga. Es la única dependencia nueva (una sola entrada en el `package-lock`, `jose` ya existía). Motivos: el SDL se carga tal cual con `buildSchema` (esquema primero, sin generar código); las reglas de seguridad (profundidad, complejidad, alias, introspección) son reglas de validación estándar de graphql-js; no hay inyección de dependencias que justificar en un servicio sin estado ni base de datos. La estructura sigue la regla hexagonal: `domain/` (errores y privacidad, sin librerías), `application/` (puertos, validación Zod y resolutores), `infrastructure/` (HTTP/Express, adaptador `fetch` del Gateway, `jose`, seguridad, registro).
2. **Un paquete `packages/graphql-schema`** con `schema.graphql` (SDL de §6.1 sin cambios) y `operations/operations.graphql` (todas las operaciones con nombre y fragmentos). `index.cjs` expone el SDL y `knownOperations()`: cada operación se separa en un documento de una sola operación con sus fragmentos ordenados, y el texto impreso por graphql-js es el **texto canónico**. La web y el móvil usarán este mismo paquete.
3. **Operaciones conocidas (Q6):** en producción un documento solo corre si su texto canónico coincide con el publicado (espacios/orden de fragmentos no importan; cualquier campo añadido, no). Fuera de producción corre cualquier documento válido. Producción **no arranca** con `INTROSPECTION=true` ni `KNOWN_OPERATIONS_ONLY=false`, ni con emisores sin `jwksUri`, Gateway que no sea https, o CORS con comodín/http.
4. **Directivas `@authenticated`/`@admin`** se leen del `astNode` del SDL y envuelven el resolutor ANTES de llamar al Gateway. El servicio valida el JWT (RS256/ES256, `iss`, `aud`, `exp`) con los mismos emisores del Gateway y solo reenvía un token válido. Un `partner` se trata como `customer` sin privilegios (el enum `Role` conserva `PARTNER` por el SDL, sin uso).
5. **Complejidad:** costo 1 por campo; las listas multiplican por 3 y las conexiones por `first` (literal; con variable se asume 10); máximo 4000 por omisión. Una prueba exige que toda operación publicada quepa en los límites por omisión (profundidad 8, alias 15).
6. **Errores:** el `message` sale de un catálogo propio por `code` (español, sin valores del usuario); la `category` se decide primero por el HTTP; solo `invalidParams[].name/reason` con caracteres seguros salen del cuerpo del Gateway; cualquier error que no sea del servicio (excepciones, coerción de variables, validación de la consulta) sale genérico: el texto de graphql-js puede contener el valor enviado.
7. **Paginación hacia delante:** `endCursor` = `nextCursor` del Gateway sin modificar. Como el Gateway no entrega cursor por fila, `edges[].cursor` es el `bookingId` (solo identifica la fila; **para paginar se usa `pageInfo.endCursor`**). La lista v2 solo trae `_links.self`, así que `BookingSummary.availableActions` va vacío; la fuente de las acciones es `booking(bookingId)`.
8. **Límite de peticiones propio** en memoria (huella + IP real con `trust proxy` = 1; por `sub` si hay sesión): riesgo conocido ya registrado en el diseño §7; no es global entre instancias.
9. **Entrada:** Zod valida en la frontera (IATA, fechas, UUID, longitudes) antes de llamar al Gateway. `createBooking` envía solo `holdId`, pasajeros y `payment.paymentReference` (sin `amount`: el servicio no guarda el precio congelado); el canal lo decide el Gateway por rol. `X-User-Id` y los campos de canal nunca se envían.
10. **Contenedor y despliegue:** `platform/graphql/Dockerfile` propio (no se modifica `infra/`), usuario no root, `PORT=8080`, `GET /health` HTTP. Workflow `deploy-graphql.yml` con `--update-env-vars` (las variables de configuración se ponen a mano una vez; no hay secretos propios) y humo del contenedor en CI (`scripts/ci/graphql-image-smoke.sh`). `check-deploy-env.cjs` verifica que el workflow no use `--set-*` y que cada variable exista en el código y en la guía.

## Alternativas descartadas
- NestJS + `@nestjs/graphql`/Apollo: más dependencias y superficie de auditoría para un servicio sin estado; el diseño solo fijaba NestJS «como el resto».
- graphql-yoga/Mercurius: añaden transporte y funciones (suscripciones, GET, multipart) que el diseño prohíbe y habría que desactivar.
- Persisted queries por hash enviado por el cliente: obligan a un protocolo extra; el texto canónico exacto cumple Q6 sin cambiar el cliente.
- Complejidad con `graphql-query-complexity`: dependencia nueva para algo que ya cabe en 40 líneas de regla de validación.

## Consecuencias
- Nuevos workspaces `packages/graphql-schema` y `platform/graphql`; nuevo workflow; `package-lock.json` cambia (todos los workflows con ese path se disparan una vez).
- Pendiente para F12c-2: tipos TypeScript generados (codegen) del SDL y de las operaciones, y el cliente GraphQL de la web; aquí el contrato queda probado con las pruebas del servicio.
- No cubierto por el recorrido local (sí por las pruebas con Gateway simulado y los contratos v2): check-in y pases dentro de la ventana, y cambio de fecha (`searchDateChange`/`confirmDateChange`).
