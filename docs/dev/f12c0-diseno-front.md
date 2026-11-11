# F12c-0 — Diseño del front: pantallas, esquema GraphQL y estructura

- Fase: F12c-0 (solo documentación; sin código, sin contratos, sin servicios, sin workflows)
- Fecha: 2026-11-11 · Rama: `docs/F12c0-diseno-front` · Commit base: `da007f1`
- ADR asociado: `docs/dev/adr/ADR-F12c-01-front-graphql-react.md`
- Estado: **revisión 2** (v1 deprecado → solo v2) **para aprobación del humano.** Nada de esto está implementado.

Fuentes usadas: `contracts/openapi/vuelos-openapi-v2.yaml` (v2, base del front; solo lectura), `contracts/openapi/vuelos-openapi.yaml` (v1, **deprecado**, solo contexto), `docs/audit/context/PLAN.md` (§1.3, §1.4, §2), el código del Gateway (`platform/api-gateway/src`), los ADR F12 y la plantilla `C:\Proyectos\plantilla-portal-aereo\portal-aereo` (no modificada).

---

## 0. Resumen y puntos que requieren decisión

> **Revisión 2 (2026-11-11, tras la revisión con el humano).** El contrato **v1 (`/flights/v1`) está deprecado**. El front (servicio GraphQL, web y móvil) usa **solo v2 (`/api/v2/vuelos`)** para el cliente. Se rehicieron §3 (datos), §5, §6, §10, §12 y se agregó §14 (cambios de backend previos). Decisiones del humano incorporadas: Q1 (ADR renombrados), Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10.

**Qué se propone.** Un servicio GraphQL (`platform/graphql`) que traduce las pantallas V1 a llamadas al API Gateway **v2** reenviando el JWT de Supabase y el `X-Correlation-Id`; una app web React (Vite + TypeScript) en `platform/web` con el área de cliente y, bajo `/admin`, el panel solo para `admin`; y paquetes compartidos (`packages/*`) para operaciones GraphQL y tipos generados, sesión, formato, tokens de diseño y marca, de modo que la app React Native posterior los reutilice.

**Lo más importante antes de aprobar:**

1. **La plantilla no se puede publicar tal cual.** Reproduce la marca de LATAM Airlines (logotipo, fuente propietaria *LATAM Sans*, fotos, paleta, textos) y no tiene licencia. Se usa como referencia de estructura y diseño de pantallas, no como código ni activos. Ver §1.5.
2. **Todo el cliente cabe en v2** (búsqueda, mapa con `HELD`, hold con `assignedSeats`, reserva, boletos, listado, detalle, postventa completa —incluido el cambio de asiento—, check-in y pases). Para un cliente final solo faltan los huecos de §5.3, y dos son bloqueantes del backend: **B-1 (canal de pago propio de la web)** y **B-2 (API interna de administración)**. Ver §14.
3. **Dueño en v2 (verificado en el código):** un usuario de Supabase queda con `ownerId = sub` (sin formato de socio) y no ve ni toca reservas de socios ni de otros usuarios. No hace falta ajuste. Falta la prueba con tokens reales (S-1). Ver §5.1.
4. **Pago en v2 (crítico):** por el código, un cliente de Supabase **no** pasa por la verificación de pagos de Booking; cae en el verificador simulado por omisión (`pay_ok_*`). La web podría vender hoy, pero depende de un comportamiento por omisión no declarado y le faltan cosas (§5.1.2). Se propone un canal `WEB` explícito (B-1); se decide aparte.
5. **El panel de administrador ya no puede usar `/flights/v1/admin`.** Lo que existe en v2 (panel de operaciones, PATCH de estado, acuerdo de promociones) se sigue usando; lista de vuelos con identificadores y tarifas requieren una API interna nueva (B-2, §5.5).
6. **Límite de peticiones:** el Gateway cuenta por `X-Device-Fingerprint` (pública) o `sub` (autenticada). Ver §6.5 y §7 (riesgo conocido: la huella la genera el cliente y puede cambiarse).
7. **ADR:** `ADR-F12c-01-pago-booking-cubre-tarifa` pasó a `ADR-F12b2fix-02-pago-booking-cubre-tarifa` (Q1) y este diseño usa `ADR-F12c-01-front-graphql-react`.
8. **«Buscar mi reserva» sin sesión** sigue como propuesta (§11), y «Mis reservas» avisa a quien compró por un socio.

**Fuera de este documento (por instrucción):** código, cambios al contrato OpenAPI, servicios, workflows y la plantilla.

---

## 1. La plantilla `portal-aereo`

### 1.1 Tecnología y estructura

| Aspecto | Hallazgo |
|---|---|
| Naturaleza | Mockup navegable «de referencia visual LATAM Ecuador» (README). Sin Supabase ni backend; datos y roles de demostración. |
| Stack | React (el README dice 18) cargado como archivos locales `public/assets/react.js` y `react-dom.js` (cabecera `@license React`), JSX compilado con un Babel vendido en `vendor/babel.cjs` mediante `build.cjs`; servidor estático `server.cjs`. **Sin `package.json` de dependencias**, sin bundler, sin TypeScript, sin pruebas. |
| Código | `src/app.jsx` (≈540 líneas, un solo componente `App` con todo el estado y casi todas las pantallas como funciones internas), `src/styles.css` (minificado en pocas líneas, ≈7 líneas enormes), `src/index.html`. |
| Enrutado | Hash (`#inicio`, `#resultados`, …) con `location.hash`. |
| Estado | `useState` local; reservas en `localStorage`; rol de demostración en `sessionStorage`. |
| Iconos | Mapa propio de trazados SVG en `app.jsx` (`icons`) y un componente `Icon`. |
| Pantallas | 19 + guía de componentes: inicio, resultados, estado, acceso, asientos, pasajeros, pago, confirmación, reservas, reserva, postventa, check-in, perfil, dashboard, vuelos, tarifas, promociones, socios, telemetría, componentes. |

Defectos de estructura relevantes para llevarla a React real: los componentes se definen **dentro** de `App` (se recrean en cada render y pierden estado/foco), la mayoría de la lógica de negocio está simulada (apartado de 10 min en memoria, precios fijos, ocupados por fórmula), y la regla de check-in usa una zona horaria fija (`-05:00`) en lugar de la del aeropuerto.

### 1.2 Componentes reutilizables identificados

| Componente (clases CSS) | Uso en la plantilla | En React |
|---|---|---|
| Barra de prototipo (`.demobar`) | Aviso + acceso al mapa de pantallas | **No** (solo en la plantilla; en el producto, un aviso «Entorno de pruebas» condicionado por configuración) |
| Cabecera global (`header`, `.header-inner`, `.mainnav`, `.header-right`, `.login`) | Logo, navegación, moneda, acceso | `AppHeader` |
| Pie (`footer`, `.footergrid`, `.footerbottom`) | Enlaces, legales | `AppFooter` (contenido desde la configuración de marca) |
| Hero + pestañas de producto (`.hero`, `.products`) | Fondo con buscador | `Hero`; las pestañas de productos que no tenemos (paquetes, hoteles, autos, eSIM…) **se eliminan** |
| Buscador (`.searchbox`, `.route-fields`, `.field`, `.pills`, `.swap`) | Origen/destino, fechas, pasajeros, cabina | `SearchForm`, `Field`, `SegmentedControl`/píldoras |
| Botones (`.btn`, `.secondary`, `.small`, `.textbtn`) | Acciones | `Button`, `LinkButton` |
| Tarjeta/panel (`.panel`) | Contenedor general | `Card` |
| Tarjeta de destino (`.destination`, `.dest-img`, `.tag`) | Rutas destacadas | `RouteCard` |
| Tarjeta de vuelo (`.flight`, `.flightbody`, `.flightpath`, `.flightprice`) | Resultado de búsqueda | `OfferCard`, `FlightPath` |
| Pasos (`.stepper`) | Compra en 4 pasos | `Stepper` |
| Resumen fijo (`.summary`, `.two-col`) | Total de la compra | `PurchaseSummary` |
| Tarifas (`.fare`, `.radio-dot`) | Elegir marca tarifaria | `FareOption` |
| Mapa de asientos (`.aircraft`, `.seatrow`, `.seat`, `.legend`) | Libre/apartado/ocupado/elegido | `SeatMap`, `SeatButton`, `SeatLegend` |
| Avisos (`.notice`, `.notice.warning`, `.toast`) | Mensajes | `Notice`, `Toast` |
| Formularios (`.field`, `.checklabel`, `.authform`) | Campos con etiqueta superior | `Field`, `Checkbox`, `AuthForm` |
| Tablas (`table`, `.tablewrap`) | Admin | `DataTable` |
| Estadísticas y barras (`.stats`, `.bar`, `.occupancy`) | Dashboard | `StatCard`, `ProgressBar` |
| Menú lateral admin (`.adminlayout`, `.adminnav`) | Navegación del panel | `AdminLayout` |
| Pase de abordar (`.boarding`, `.barcode`) | Check-in | `BoardingPass` |
| Estados vacíos/éxito (`.empty`, `.success`, `.bookingcode`) | Estados | `EmptyState`, `SuccessState` |
| Cajón lateral (`.drawer`) | Navegación móvil | `Drawer` (solo menú móvil) |
| «Saltar al contenido» (`.skip`) | Accesibilidad | se conserva |

### 1.3 Sistema visual de la plantilla (referencia)

| Aspecto | Valor en la plantilla |
|---|---|
| Paleta | Azul `#10004F`, magenta de acción `#E40046`, lavanda `#F1EFFA`, neutro `#F7F7F8`, texto `#1B1449`, gris `#646271`, línea `#DEDDE4`; foco `#6954D9` |
| Asientos | libre lavanda con borde; apartado ámbar `#FCE7B1`; ocupado gris `#E5E3EA` con cruz; elegido azul sólido |
| Tipografía | *LATAM Sans* (propietaria) con Arial de respaldo. Títulos 32/28/20, cuerpo 14, etiquetas 10–12 px |
| Espaciado | Escala 4/8/16/24/32/48; contenedor máx. 1200 px; botón principal 48 px |
| Forma | Radios 4–12 px, hero con esquinas inferiores 17 px; sombras suaves |
| Responsive | Cortes en 1500, 1200, 960 y 640 px; impresión (`@media print`) para pase/comprobante |

Observaciones: hay tamaños de 7–10 px (p. ej. `.adminnav small{font-size:8px}`, `.boardingbody small{9px}`) que no cumplen legibilidad mínima; `.tag.pink` blanco sobre `#E40046` es ≈4,3:1 (límite AA de texto normal 4,5:1); el CSS repite valores literales en vez de usar variables (solo 7 variables en `:root`).

### 1.4 Correspondencia de pantallas

| Pantalla nuestra | Base en la plantilla | Qué cambia |
|---|---|---|
| Inicio | `#inicio` | Quitar pestañas de producto, alojamiento, «más opciones», millas, código promocional, campaña de Bogotá, LATAM Pass. Conservar hero + buscador + rutas destacadas + experiencia |
| Resultados | `#resultados` | Datos reales; varias ofertas; ida y vuelta/multidestino reales (la plantilla solo emite el primer tramo) |
| Estado de un vuelo | `#estado` | Número de vuelo + fecha local de salida; la puerta solo si el Gateway la devuelve (H-6) |
| Acceso / registro / recuperar | `#acceso` | Supabase real; **falta** la pantalla «definir nueva contraseña» tras el enlace del correo |
| Detalle de oferta y asientos | `#asientos` | Un asiento por pasajero con tipo de pasajero; estado `HELD` real; temporizador del hold del servidor |
| Pasajeros y equipaje | `#pasajeros` | Datos completos del contrato (documento, nacionalidad, nacimiento, género, contacto); equipaje por pasajero y tramo |
| Pago simulado | `#pago` | Se mantiene el aviso «PAGO SIMULADO»; referencia de prueba en lugar de tarjeta |
| Confirmación | `#confirmacion` | PNR y boletos reales; estado `PENDING_PAYMENT`/`TICKET_ISSUING` (202) |
| Mis reservas | `#reservas` | Lista paginada con filtros |
| Detalle de reserva | `#reserva` | Itinerarios, pasajeros, boletos, historial |
| Postventa | `#postventa` | Cotización real (equipaje, fecha, cancelación) y cambio de asiento |
| Check-in y pase | `#checkin` | Ventana según Operations; hora local del aeropuerto |
| Dashboard | `#dashboard` | Ocupación real por cabina y salud real |
| Vuelos | `#vuelos` | Lista por fecha + cambio de estado, puerta, retraso (PATCH v2) |
| Tarifas | `#tarifas` | Por vuelo, cabina y marca (no un único campo) |
| Promociones | `#promociones` | **Es un único acuerdo de la aerolínea** (ADR-F12-10), no una lista de socios con códigos |
| Perfil, Socios y webhooks, Telemetría | `#perfil`, `#socios`, `#telemetria` | Fuera de V1: no se construyen (la plantilla ya las marca «Después») |

**Sin equivalente en la plantilla** (diseño propuesto con el mismo estilo, §3.4): callback de autenticación (confirmar correo), nueva contraseña, sesión expirada, 403 «sin permiso», 404, error de servicio/indisponible (503 con `Retry-After`), apartado vencido (410) y pago pendiente (202).

### 1.5 Licencia y dependencias

| Punto | Hallazgo | Impacto |
|---|---|---|
| Licencia | No hay `LICENSE` ni campo `license`; `package.json` es `private`. Autoría y términos desconocidos | No debe suponerse permiso de publicación del código ni de los activos |
| Marca y activos de terceros | `logo.svg`, `logo-dark.svg` (logotipo LATAM), `regular/bold/light.woff` (*LATAM Sans*), fotografías (`hero.png`, `bogota.png`, `cuenca.jpg`, …) y textos «LATAM», «LATAM Pass». El README: «pertenecen a sus titulares… reemplazarlos por la marca y activos del producto final» y «sin afiliación» | **Impide publicar.** Marca registrada y fuente propietaria; origen de las fotos sin acreditar. Se reemplazan todos (§2) |
| React vendido | `react.js`/`react-dom.js` con cabecera `@license React` (MIT). Versión no verificable desde los archivos (README: 18) | Reemplazar por `react`/`react-dom` desde npm con versión fijada y `npm audit` |
| Babel vendido | `vendor/babel.cjs` minificado, versión no verificable (aparecen cadenas `version:"7.x"` de varios paquetes internos) | No reutilizar; Vite lo reemplaza. No se puede auditar con `npm audit` |
| Dependencias innecesarias | Ninguna en `package.json`, pero hay ≈2 archivos JS de terceros y un compilador vendidos dentro del repositorio | Evitar copiar `vendor/` y `public/assets/*.js` al monorepo |
| Servidor | `server.cjs` valida que la ruta quede dentro de `dist` (bien) pero sirve sin cabeceras de seguridad | No se reutiliza (Render sirve estáticos con cabeceras propias) |
| Vulnerabilidades | No se puede ejecutar `npm audit` (sin manifiesto de dependencias). Riesgo no cuantificable por los binarios vendidos | Se resuelve con dependencias de npm auditables (CI: `npm audit --audit-level=high`) |
| Accesibilidad | Buenas bases (enlace «saltar al contenido», `aria-label` en asientos, foco visible), pero textos de 7–10 px y contrastes justos | Corregir al pasar a tokens |

**Conclusión:** reutilizar *tal cual* solo el **diseño** (disposición, jerarquía, escala de espaciado, estados). El código y los activos se **reescriben** como componentes TypeScript con tokens; nada del directorio `vendor/` ni de `public/assets/` viaja al repositorio.

### 1.6 Qué se reutiliza y qué se reescribe

| Se conserva como diseño (se reimplementa) | Se reescribe | Se descarta |
|---|---|---|
| Disposición de cada pantalla, escala 4/8/16/24/32/48, tamaños de botón y campo, estados (vacío, éxito, rechazo, vencimiento), leyenda de asientos, jerarquía tipográfica | Todo el CSS → tokens + CSS Modules; todos los componentes → TS, uno por archivo, fuera del componente raíz; enrutado hash → React Router; estado → hooks + GraphQL | Logo, fuente, fotos, textos LATAM, React/Babel vendidos, `server.cjs`, datos de demostración, rol «selector» de demostración, `localStorage` de reservas, pestañas de productos fuera de alcance |

### 1.7 Llevarla a React (Vite + TypeScript) sin amarrarse a la web

- **Estilos:** CSS Modules + variables CSS generadas desde `packages/design-tokens` (un solo archivo fuente TS). React Native consume el mismo objeto TS con `StyleSheet`. Sin Tailwind (los tokens ya son la fuente y RN no usa CSS).
- **Componentes web** en `platform/web/src/components` (usan DOM/CSS); **lógica sin pantalla** (reglas de check-in, formato, validación de pasajeros, mapeo de errores a mensajes) en paquetes sin dependencia de DOM, para que RN la importe.
- **Iconos:** `lucide-react` (ISC) en web; `lucide-react-native` en móvil; ambos nombran los iconos igual. Se descarta el mapa de trazados de la plantilla (origen no acreditado).
- **Rutas:** React Router (`BrowserRouter`). Render estático necesita regla de reescritura a `index.html` (§9).
- **Impresión:** `@media print` para comprobante y pase, como en la plantilla.

---

## 2. Marca provisional y cómo reemplazarla

La marca de GabatAIR no está definida. Se usa una **marca provisional** concentrada en cuatro lugares; las pantallas nunca contienen colores, textos de marca, rutas de imágenes ni el logo escritos a mano.

### 2.1 Dónde vive cada cosa

| Qué | Archivo único | Lo consume |
|---|---|---|
| Colores, tipografía (familia, escala, pesos), radios, espaciado, sombras, puntos de corte | `packages/design-tokens/src/tokens.ts` (objeto TS sin dependencias; neutral entre web y RN). Un script genera `tokens.css` (variables `--color-primary`, …) | Web (CSS Modules vía variables), RN (`StyleSheet`) |
| Logotipo claro y oscuro | `packages/brand/assets/logo.svg` y `logo-dark.svg` | Componente `<Logo variant="light|dark" />` (web: importa el SVG; RN: `react-native-svg`). **Es el único lugar que lee los SVG** |
| Nombre comercial, razón social, eslogan, textos institucionales (pie, «sobre nosotros», avisos de prueba), correo de contacto, **rutas destacadas por origen** con su fotografía | `packages/brand/src/brand.config.ts` | Cabecera, pie, Inicio, títulos de página (`<title>`) |
| Fotografías de destinos y del hero | `packages/brand/assets/photos/*` referenciadas **solo** desde `brand.config.ts` | Tarjetas de ruta, hero |
| Archivos de fuente | `packages/brand/assets/fonts/*` referenciados **solo** desde `tokens.ts` (familia) y un `fonts.css` generado | Web; RN los carga por nombre de familia |

### 2.2 Marca provisional propuesta

| Elemento | Valor provisional | Razón |
|---|---|---|
| Nombre | «GabatAIR» (configurable) | Nombre de trabajo |
| Primario (azul noche) | `#0B2A5B` | Contraste 14:1 sobre blanco; distinto de la paleta de la plantilla |
| Acento (acciones) | `#C2410C` (hover `#9A3412`) | Texto blanco sobre el acento ≈5:1 (AA) |
| Superficie suave | `#EEF3FB`; neutro `#F6F7F9`; línea `#D9DEE7`; texto `#14213D`; gris `#5B6678` | Equivalentes de lavanda/neutro/línea |
| Estados | éxito `#067647`, aviso `#B54708`, error `#B42318`, info `#175CD3` | Texto sobre fondos suaves ≥ 4,5:1 |
| Asientos | libre `#EEF3FB` + borde; apartado `#FEF0C7` + borde `#B54708`; ocupado `#E4E7EC` + cruz; elegido `#0B2A5B` | El estado nunca se comunica solo por color (cruz/texto accesible) |
| Tipografía | *Inter* (SIL OFL 1.1) autoalojada, respaldo `system-ui, Arial, sans-serif`; escala 12/14/16/20/24/28/32; mínimo 12 px | Fuente libre; sin tamaños <12 px |
| Espaciado | 4/8/12/16/24/32/48 | Igual que la plantilla + 12 |
| Radios | 4/8/12/pill | |
| Logo | Marca de texto provisional «GabatAIR» en SVG propio (a crear en F12c-2) | No se usa ningún activo de la plantilla |
| Fotos | Imágenes con licencia clara (p. ej. dominio público/CC0) o generadas; cada una con crédito en `brand.config.ts` | Origen acreditado |

### 2.3 Guía para reemplazar la marca (cuando el humano la defina)

1. **Logotipo.** Reemplazar `packages/brand/assets/logo.svg` (para fondos claros) y `logo-dark.svg` (para fondos oscuros) conservando el nombre y la proporción (`viewBox`). Sin tocar componentes. Verificar en cabecera, pie, pase de abordar e impresión.
2. **Paleta.** Editar solo los colores en `packages/design-tokens/src/tokens.ts` (`color.primary`, `color.accent`, `color.surface`, estados, asientos); ejecutar `npm run build -w @flight-platform/design-tokens` para regenerar `tokens.css`. Comprobar contraste (primario/acento sobre blanco y texto blanco sobre ellos ≥ 4,5:1) con la prueba de contraste de F12c-2, que falla si no se cumple.
3. **Tipografía.** Copiar los archivos de fuente a `packages/brand/assets/fonts/`, cambiar `font.family` (y, si cambia la escala, `font.size`) en `tokens.ts` y regenerar. Verificar la licencia de la fuente y que incluya los caracteres españoles (á, é, í, ó, ú, ñ, ¿, ¡).
4. **Fotografías.** Sustituir los archivos de `packages/brand/assets/photos/` y actualizar solo las entradas de `featuredRoutes` y `hero` en `brand.config.ts` (ruta, texto alternativo, crédito). Mantener relación de aspecto 16:9 (tarjetas 4:3 se recortan por CSS).
5. **Nombre y textos.** Editar `brand.config.ts` (`name`, `legalName`, `tagline`, textos del pie, aviso de entorno de pruebas, correo). Los `<title>` de las páginas salen de `name`.
6. **Verificación.** `npm run build` y las pruebas de F12c-2 (hay una que falla si algún archivo de `platform/web/src` contiene un color hexadecimal, una ruta de imagen o la cadena de marca literal fuera de `packages/brand` y `packages/design-tokens`).
7. **Móvil.** La app React Native importa los mismos `tokens.ts`, `brand.config.ts` y SVG; no requiere pasos adicionales.

Archivos que se tocan: `packages/design-tokens/src/tokens.ts`, `packages/brand/src/brand.config.ts`, `packages/brand/assets/**`. Ninguna pantalla.

---

## 3. Pantallas V1

Convenciones para todas: **cargando** = esqueleto/indicador con `aria-busy`; **vacío** = mensaje + acción; **error** = `Notice` con el mensaje del catálogo (§6.3) y el `correlationId` visible en «Detalles» para soporte; **éxito** = confirmación. Fechas y horas de vuelo **siempre en hora local del aeropuerto** (§3.0). Importes con la moneda del contrato (`USD`) y formato `es-EC`, sin aritmética de coma flotante (cadenas decimales).

### 3.0 Reglas transversales de las pantallas

| Regla | Detalle |
|---|---|
| Hora local del aeropuerto (ADR-F12b1fix-02) | `departureDate`, `newDepartureDate` y la fecha de estado son la **fecha local del aeropuerto de origen**. Una hora de salida se muestra en la zona de su aeropuerto y la de llegada en la del suyo, con indicación de zona («08:35 · hora de Quito»). Nunca en la zona del navegador. La tabla IATA→zona IANA es `AIRPORT_ZONES` de `packages/shared/src/airport-time.ts`; el paquete `packages/format` la expone al front (§8). Aeropuerto sin zona: se muestra en UTC con la etiqueta «UTC», sin fallar (igual que la lectura del backend) |
| Día siguiente | Si la llegada cae en otro día local que la salida, mostrar «+1» |
| Dinero | `MoneyAmount` son cadenas; total = `total`; «Tasas incluidas» solo si `taxes` viene; sin redondeos propios |
| Pago de prueba | Todo pago de la web usa una **referencia de prueba** (`pay_ok_<uuid>`, aceptada por el canal de pago simulado `WEB`, que es el hueco bloqueante B-1). Siempre rotulado «PAGO SIMULADO · sin cobro» (§3.7). Los escenarios `pay_denied_`, `pay_pending_`, `pay_mismatch_` solo aparecen si la configuración pública de pruebas los habilita |
| Idempotencia | Cada mutación lleva una `Idempotency-Key` UUID que genera el cliente **una vez por intención del usuario** y reutiliza en reintentos (doble clic, reconexión) |
| Identificadores | `bookingId`, `holdId` UUID; los ids de pasajero y ticket los define el backend |
| Datos personales | El documento se muestra enmascarado salvo en el formulario de captura; no se guarda en `localStorage`; no se envía a analítica ni se escribe en logs del front |
| Roles | La visibilidad por rol es solo experiencia de usuario (PLAN §2.3); la barrera real es el Gateway y el servicio GraphQL |
| Accesibilidad | Teclado completo, foco visible, etiquetas, `aria-live` para avisos, contraste AA, mínimo 12 px, estado de asiento por texto |

### 3.1 Inicio (público)

- **Objetivo:** buscar vuelos y descubrir rutas. **Rol:** anónimo/cualquiera.
- **Campos:** tipo de viaje (solo ida · ida y vuelta · multidestino), origen, destino (con intercambio), fecha(s) (fecha local del origen), pasajeros (adultos ≥1, jóvenes, niños, infantes), cabina (filtro de visualización en el cliente: la búsqueda no filtra por cabina).
- **Acciones:** «Buscar vuelos» → Resultados; tarjeta de ruta destacada → **abre el buscador con origen y destino prellenados y el foco en la fecha** (no lanza la búsqueda sola: no hay catálogo de precios ni fecha por defecto fiable). Selector «Destinos destacados desde» (Quito/Guayaquil) cambia la lista.
- **Estados:** cargando — n/a (contenido estático); error de validación — campos con mensaje (origen = destino, fecha pasada, infantes > adultos, >9 pasajeros si el contrato lo restringe); vacío — n/a.
- **Reglas:** fecha mínima = hoy en la zona del aeropuerto de origen; vuelta ≥ ida; multidestino hasta 6 tramos (contrato). Las listas de aeropuertos salen de la configuración (§5.3 hueco H-1).
- **Datos:** ninguno del backend para las rutas destacadas (lista en `brand.config.ts`; **sin precios**, no hay dato).

```
┌ Logo      Descubre · Mis viajes · Estado de vuelo        [Iniciar sesión] ┐
├──────────────────────────────────────────────────────────────────────────┤
│  (hero)  ¿A dónde quieres ir?        (•Ida y vuelta) (Solo ida) (Multi)  │
│  [Desde ▾][⇄][Hacia ▾][Ida 📅][Vuelta 📅][1 adulto · Economy ▾]  [Buscar]│
├──────────────────────────────────────────────────────────────────────────┤
│  Destinos destacados desde [Quito ▾]                                      │
│  [foto Galápagos][foto Cuenca][foto Lima][foto Bogotá]   (abre buscador)  │
│  Experiencia: Preparar · Aeropuerto · Durante el vuelo                    │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Resultados de búsqueda (público)

- **Objetivo:** comparar varias ofertas y elegir una. **Rol:** anónimo.
- **Campos/acciones:** ordenar (precio — por defecto, el que devuelve el servicio — o hora de salida); filtros en el cliente: solo directos, cabina; «Modificar búsqueda»; en cada oferta: tramos, duración, escalas, precio total y la opción tarifaria más barata; «Elegir».
- **Estados:** cargando (esqueletos); vacío `totalOffers = 0` («No hay vuelos para esa fecha. Prueba otra fecha»); error 400 (formulario inválido), 429 («Demasiadas búsquedas, reintenta en N s» con `Retry-After`), 503 (indisponible, botón reintentar); éxito.
- **Reglas:** el servicio devuelve hasta `SEARCH_MAX_OFFERS` (10) ofertas ordenadas por precio, hora de salida y vuelos (ADR-F12a2-01); no hay paginación ni filtros en servidor. Cada oferta es un snapshot con TTL: si al elegir ha vencido → `OFFER_NO_LONGER_AVAILABLE` → volver a buscar. Horas en hora local (§3.0).
- **Datos:** `POST /api/v2/vuelos/search` (público; `X-Device-Fingerprint` obligatorio).

```
 UIO → GPS · 10 dic 2026 · 2 adultos       [Modificar búsqueda]   Ordenar: [Precio ▾]
 ┌ Filtros ─┐ ┌ FP103 ───────────────────────────────────────────┐
 │ ☐ Directo │ │ 08:35 UIO ──────✈────── 10:30 GPS    desde       │
 │ Cabina ▾  │ │       1 h 55 min · Directo        USD 254,78 [Elegir]│
 └──────────┘ └──────────────────────────────────────────────────┘
```

### 3.3 Estado de un vuelo (público)

- **Objetivo:** consultar el estado operativo. **Rol:** anónimo.
- **Campos:** número de vuelo (p. ej. `FP103`), fecha (**local de salida**).
- **Estados:** cargando; error 404 `FLIGHT_STATUS_NOT_AVAILABLE` («No encontramos ese vuelo en esa fecha. La fecha es la de salida, en hora del aeropuerto de origen»); éxito con salida/llegada programada, estimada y real, terminal, aeronave, estado (`SCHEDULED, BOARDING, DEPARTED, DELAYED, ARRIVED, CANCELLED, DIVERTED`).
- **Reglas:** horas en la zona de cada aeropuerto. La **puerta** (`gate`) y `delayMinutes` se muestran solo si vienen: el contrato v2 declara `gate` pero hoy no se llena (H-6, BACKLOG prioridad alta).
- **Datos:** `GET /api/v2/vuelos/flights/{flightNumber}/status?date=`.

### 3.4 Iniciar sesión, registrarse, recuperar contraseña (público)

- **Objetivo:** autenticar con Supabase Auth. **Rol:** anónimo.
- **Pantallas:** (a) iniciar sesión (correo + contraseña), (b) registrarse (nombre opcional, correo, contraseña), (c) recuperar (correo → «Si existe una cuenta, enviamos un enlace»), (d) **nueva contraseña** (tras el enlace; sin equivalente en la plantilla), (e) confirmación de correo (callback).
- **Reglas:** Authorization Code + **PKCE** (`flowType: 'pkce'`, `docs/dev/f11a-supabase-auth.md`); las credenciales **nunca pasan por GraphQL ni por el Gateway**: el navegador habla con Supabase directamente. Mensajes genéricos que no revelan si el correo existe. Mínimo de contraseña según Supabase. Tras iniciar sesión, vuelve a la ruta de origen (`returnTo` validado: solo rutas internas). Usuario nuevo = rol `customer` (hook de Supabase); `admin` solo desde `app_metadata`.
- **Estados:** cargando (botón con indicador), error (credenciales inválidas; límite de intentos de Supabase), éxito (redirección), correo pendiente de confirmar.
- **Datos:** solo Supabase (`signUp`, `signInWithPassword`, `resetPasswordForEmail`, `updateUser`).

### 3.5 Detalle de la oferta y mapa de asientos (cliente)

- **Objetivo:** confirmar la oferta, elegir tarifa y asiento por pasajero. **Rol:** `customer` (necesita sesión desde «Continuar»).
- **Campos/acciones:** por tramo, elegir marca tarifaria (`pricingOptions`: cabina, marca, reglas de reembolso/cambio, equipaje incluido, asientos libres); elegir un asiento por pasajero con asiento (los infantes no ocupan asiento: `INFANT_SEAT_NOT_ALLOWED`); «Continuar» crea el hold.
- **Estados del asiento:** libre, **apartado (HELD)** por otro hold vigente, ocupado (reservado/emitido/check-in), elegido por mí; leyenda siempre visible; `aria-label` «Asiento 8A, ventana, libre».
- **Estados de pantalla:** cargando mapa; error `SEAT_TAKEN` (409: «Ese asiento acaba de ser ocupado», se refresca el mapa y se conserva el resto de la selección); `SEAT_CABIN_MISMATCH` (422); hold: contador con `expiresAt` del servidor; al vencer (410) → aviso y volver a la oferta; sin sesión → llevar a iniciar sesión y volver.
- **Reglas:** el mapa solo permite asientos de la cabina de la tarifa elegida; máximo un asiento por pasajero con asiento y por tramo; el hold dura `ttlMinutes` (5–30); el asiento apartado se libera al vencer (sin tarea programada, ADR-F12b2fix-01); el mapa se reconsulta al volver.
- **Datos:** mapa con `HELD` (`GET /api/v2/vuelos/offers/{offerId}/seatmap`, público), hold con asientos (`POST /api/v2/vuelos/offers/hold`, `flights:hold`; `assignedSeats` es un acuerdo por encima del contrato, H-3), estado/tiempo del hold (`GET …/hold/{holdId}`), liberar (`DELETE …/hold/{holdId}`).

```
 Elige tus asientos · FP103 UIO→GPS            Tu viaje (resumen fijo)
 Tarifa: (•)Light USD127 ( )Standard ( )Full   2 adultos · Economy Light
 Pasajero 1 ▸ 8A    Pasajero 2 ▸ (elegir)      Total USD 254,78
 □libre ■elegido ▨apartado ✕ocupado             Apartado: 09:12 restantes
   A B C   D E F
 8 □ □ □ 8 ■ □ ▨      [ Continuar a datos de pasajeros ]
```

### 3.6 Datos de pasajeros, asiento y equipaje (cliente)

- **Objetivo:** capturar los pasajeros y extras. **Rol:** `customer`.
- **Campos por pasajero** (contrato `PassengerItem`): tipo (ADULT/YOUTH/CHILD/INFANT), nombres, apellidos, tipo y número de documento (`PASSPORT`/`NATIONAL_ID`), vencimiento del pasaporte, nacionalidad, nacimiento, género (M/F/X), contacto (correo y teléfono), infante → adulto asociado; asiento elegido (solo lectura aquí, enlace «cambiar»); equipaje adicional por pasajero y tramo (0–3, precio de `extraCheckedBaggagePrice`).
- **Reglas** (ADR-F12-05, validadas por el Gateway; el front las anticipa pero no las reemplaza): internacional (algún aeropuerto fuera de los nacionales) → pasaporte obligatorio; documento vigente hasta después del último vuelo; todo infante con un adulto asociado; cantidades que coinciden con las del hold; máximo 3 maletas por pasajero y tramo.
- **Estados:** validación por campo (nunca se muestra el valor del dato en el mensaje), `VALIDATION_FAILED` con `invalidParams` mapeados al campo; hold vencido → 410 volver a asientos; precio congelado del hold visible.
- **Datos:** el hold ya consultado (precio congelado, pasajeros); precios de equipaje de la oferta.

### 3.7 Pago simulado (cliente)

- **Objetivo:** pagar de prueba y crear la reserva. **Rol:** `customer`.
- **Contenido:** aviso fijo «PAGO SIMULADO · No se solicita tarjeta ni se realiza ningún cobro»; total (precio congelado + equipaje); botón «Simular pago y reservar».
- **Acción:** genera la referencia de prueba (`pay_ok_<uuid>`) y ejecuta `createBooking`.
- **Estados:** procesando (botón deshabilitado; no se repite sin la misma `Idempotency-Key`); 201 → Confirmación; **202** (`PENDING_PAYMENT`/`TICKET_ISSUING`) → Confirmación con estado «En proceso» y consulta periódica; errores: 409 `SEAT_TAKEN`/`OFFER_NO_LONGER_AVAILABLE`, 410 hold vencido, 422 `AMOUNT_MISMATCH`/`PAYMENT_*`, 503 (reintentar con la misma clave).
- **Datos:** `POST /api/v2/vuelos/bookings` (201 `CONFIRMED` / 202 `PENDING_PAYMENT` o `TICKET_ISSUING`), con la referencia de prueba del canal `WEB` (B-1). Si el pago falla por 422 (`PAYMENT_NOT_AUTHORIZED`, `AMOUNT_MISMATCH`) el hold sigue vigente mientras no venza.

### 3.8 Confirmación (cliente)

- **Objetivo:** mostrar el resultado de la compra. **Rol:** `customer` (dueño).
- **Contenido:** código de reserva (`pnr`), estado, itinerario, pasajeros con asiento, boletos (`eTicketNumber`, estado), total; acciones: «Ver mi reserva», «Imprimir comprobante», «Hacer check-in» (si procede).
- **Estados:** éxito (`CONFIRMED`); en proceso (`PENDING_PAYMENT`, `TICKET_ISSUING`: consulta el detalle cada pocos segundos con tope; texto «Estamos emitiendo tus boletos»); fallo (`FAILED`: «No pudimos completar la reserva», sin cobro real).
- **Datos:** respuesta de la creación + `GET /bookings/{id}` y `…/tickets`.

### 3.9 Mis reservas (cliente)

- **Objetivo:** listar las reservas propias. **Rol:** `customer` (y `admin` ve solo las propias).
- **Campos:** filtros `pnr`, `status`, rango de fechas de creación; lista (PNR, ruta, fecha de salida local, estado, total); «Cargar más».
- **Estados:** cargando; vacío («Aún no tienes reservas» + Buscar vuelos); error; éxito. Reservas ajenas nunca aparecen (404 si se intenta por id).
- **Datos:** `GET /api/v2/vuelos/bookings` (`limit` ≤ 50, `cursor`; `_links` por estado). Sin total de resultados (hueco H-9).
- **Aviso fijo bajo el título:** «¿Compraste por una agencia o con un socio? Gestiona tu reserva con quien te la vendió. Aquí solo aparecen las reservas hechas en este sitio.» con enlace a «Buscar mi reserva» cuando exista (§11). Las reservas de un socio tienen otro dueño y no se listan (H-18).

### 3.10 Detalle de una reserva (cliente)

- **Objetivo:** ver y gestionar una reserva. **Rol:** `customer` dueño.
- **Contenido:** estado, itinerarios con tramos (horas locales), pasajeros (documento enmascarado, asiento, equipaje), boletos, historial (`changes`); acciones según estado: check-in, equipaje, asiento, cambio de fecha, cancelar.
- **Reglas de acciones:** postventa solo en `CONFIRMED` (`BOOKING_NOT_CONFIRMED` 409 en otro estado); `CHANGE_PENDING`/`CANCELLATION_PENDING` bloquean acciones y muestran «En proceso»; `CANCELLED` solo lectura.
- **Estados:** cargando; 404 (inexistente **o ajena**: mismo mensaje «Reserva no encontrada»); éxito.
- **Datos:** `GET /bookings/{id}`, `…/tickets`.

### 3.11 Postventa (cliente)

Una pantalla con cuatro pestañas; cada una cotiza antes de confirmar y nunca cambia nada sin confirmación explícita.

| Pestaña | Flujo | Reglas y errores |
|---|---|---|
| **Equipaje** | Ver opciones por pasajero/tramo (precio, máximo, ya comprado) → elegir cantidad → confirmar con pago simulado | 200 síncrono; `BAGGAGE_LIMIT_EXCEEDED` (422); `PAYMENT_NOT_AUTHORIZED` si el pago queda pendiente (H-20) |
| **Asiento** | Mapa del tramo (HELD/ocupado) → elegir asientos nuevos → confirmar | `PUT /api/v2/vuelos/bookings/{id}/seats`; sin costo; solo `CONFIRMED`; `SEAT_TAKEN` 409; `SEAT_CABIN_MISMATCH`/`INFANT_SEAT_NOT_ALLOWED` 422; tras check-in `CUTOFF_PASSED` 409 |
| **Fecha** | Elegir nueva fecha (local de origen) por tramo → «Buscar» → lista de ofertas con diferencia (tarifa, tasas, cargo, **total a pagar**) y vencimiento → confirmar (con pago simulado si hay importe) | `FARE_NOT_CHANGEABLE`, `CUTOFF_PASSED`, `FLIGHT_ALREADY_DEPARTED` 409; `CHANGE_OFFER_EXPIRED` 410; 202 → `CHANGE_PENDING` |
| **Cancelar** | «Cotizar» → muestra reembolso, penalidad y vencimiento de la cotización → casillas de confirmación → «Cancelar reserva» | `QUOTE_EXPIRED` 409 → volver a cotizar; `ALREADY_CANCELLED` 409; 202 → `CANCELLATION_PENDING`; **el reembolso es calculado, no ejecutado** (pago simulado: «sin movimiento de dinero») |

- **Estados comunes:** cargando cotización; error con mensaje del catálogo; éxito con regreso al detalle actualizado; cotización con cuenta regresiva.
- **Datos:** `GET …/baggage-options`, `POST …/baggage`, `POST …/date-change/search`, `POST …/date-change`, `GET …/cancellation-quote`, `POST …/cancel`; todo bajo `/api/v2/vuelos/bookings/{id}/…` (§5.2).

### 3.12 Check-in y pase de abordar (cliente)

- **Objetivo:** hacer check-in y obtener el pase. **Rol:** `customer` dueño.
- **Reglas:** ventana de check-in controlada por Operations (`CHECKIN_OPEN_HOURS` = 48 h y `CHECKIN_CLOSE_MINUTES` = 60 min por defecto; ADR-F12-10). El front muestra una **ayuda** calculada con la salida del primer tramo pendiente **en hora local del aeropuerto** («Abre el 8 dic a las 08:35, hora de Quito»), pero la autoridad es el servidor: `409 CHECK_IN_NOT_AVAILABLE` → «El check-in aún no está disponible / ya cerró». El botón no se deshabilita por la ayuda del cliente si el reloj del dispositivo puede estar mal: se permite intentar y se traduce el error. `POST` sin cuerpo hace check-in de todos los elegibles (GAP-027). No aplica a `CANCELLED`.
- **Estados:** no disponible (antes/después de la ventana), disponible, en progreso, completado (`CHECKED_IN` por pasajero/tramo), fallido (`CHECK_IN_FAILED` 422, reintentar), pase no disponible (`BOARDING_PASS_NOT_AVAILABLE`).
- **Pase:** por pasajero y tramo: nombre, vuelo, origen/destino, fecha y hora locales, asiento, grupo/posición de embarque si vienen, código (`AZTEC`/`PDF417`/`QR`) y rótulo «Pase de prueba» si el entorno es de pruebas. La **puerta** se muestra solo si el pase la trae (el contrato v2 declara `gate`; hoy no se llena: H-6); la hora de embarque no existe en el contrato. Imprimible.
- **Datos:** `POST /bookings/{id}/check-in`, `GET /bookings/{id}/boarding-passes`. El estado «ya hizo check-in» se deduce de que los pases existan (H-7).

### 3.13 Panel de administrador (solo web, rol `admin`)

Layout con menú lateral (Dashboard, Vuelos, Tarifas, Promociones; «Socios y webhooks» y «Telemetría» ocultos en V1). Guardia de ruta por rol (UX) + GraphQL + Gateway.

**Dashboard operativo**
- **Objetivo:** ocupación por cabina y salud. **Datos:** ocupación del día elegido (selector de fecha local; filtros origen/destino/estado), tarjetas: vuelos del día, ocupación media, holds activos; lista por vuelo con barras por cabina (`seatsByStatus`) y alertas (`LOW_AVAILABILITY`, `DELAYED`, `CANCELLED`, `CHECKIN_OPEN`); salud: semáforo `HEALTHY/DEGRADED/DOWN` y los siete servicios (`dependencias`) con latencia.
- **Estados:** cargando; vacío (sin vuelos ese día); error 403 (rol insuficiente: «Sin permiso»); salud `DOWN` (503 con el mismo cuerpo: se muestra, no es error de pantalla); actualización manual y automática cada 30 s con pausa en segundo plano.
- **Reglas:** `BOOKED`, `CHECKED_IN` y `BOARDED` pueden figurar en 0 (ADR-F12-10: no hay conteo por vuelo; verificar el comportamiento vigente antes de implementar). **Salud del bus de eventos: hueco H-8** (la salud solo cubre los siete servicios y alcanzar el ESB).
- **Datos:** `GET /api/v2/vuelos/operaciones/vuelos`, `GET /api/v2/vuelos/health` (público).

**Vuelos y cambio de estado**
- **Objetivo:** ver los vuelos de una fecha y cambiar estado/puerta/retraso/cancelación. **Campos:** fecha, lista (vuelo, ruta, salida local, estado, puerta, ocupación); acción por vuelo: estado destino (transiciones válidas), hora estimada de salida/llegada, puerta de embarque, motivo (≤200).
- **Reglas:** transición validada por el Gateway (`409 INVALID_STATUS_TRANSITION`); repetir el estado es válido; `CANCELLED` cierra la venta y **notifica a las reservas afectadas**: confirmación explícita con el número de reservas afectadas, que el servidor devuelve **después** (`affectedBookings`); un retraso que alcanza el umbral genera `flight.schedule_changed`; `Idempotency-Key` opcional. Las horas estimadas se capturan en hora local del aeropuerto y se envían con desplazamiento.
- **Estados:** cargando; vacío; éxito (toast con `eventId`); 404/409/403.
- **Datos:** lista de vuelos del día con estado y ocupación: `GET /api/v2/vuelos/operaciones/vuelos?date=` (da `flightNumber` y `date`, que es lo que pide el cambio); cambio: `PATCH /api/v2/vuelos/flights/{flightNumber}/status` (acepta puerta, motivo y estimadas; valida la transición). No necesita la API interna.
- *Después (Q3):* crear/actualizar vuelo y cerrar la venta, vía la API interna de administración (B-2, §5.5).

**Tarifas**
- **Objetivo:** consultar y editar tarifas de un vuelo. **Campos:** vuelo (de la lista), cabina, marca tarifaria, precio (`total`, `baseFare`, `taxes`), reglas (reembolsable, cambiable), equipaje incluido, precio de equipaje extra. **Reglas:** la clave natural (vuelo, cabina, marca) actualiza y conserva `fareId`; USD; entrada validada (campo extra → 400). **Estados:** cargando; vacío; éxito; 400/403. **Datos:** API interna de administración (B-2, §5.5): `GET /admin/flights` (selector de vuelo con `flightInstanceId`), `GET/PUT /admin/fares`. **Pantalla bloqueada hasta B-2.**

**Promociones**
- **Objetivo:** el acuerdo B2B de promociones **único de la aerolínea** (no hay lista de socios ni códigos). **Campos:** permite promociones, descuento máximo (0–100), destinos, rutas (`UIO-GYE`), cabinas, vigencia, condiciones. **Reglas:** `422 PROMOTION_DISCOUNT_OUT_OF_RANGE` fuera de 0–100; `GET` sin acuerdo → 404 (estado vacío «Aún no hay acuerdo»); `PUT` con `Idempotency-Key`. **Datos:** `GET/PUT /api/v2/vuelos/promociones/contrato` (`flights:read` / `flights:admin`).

### 3.14 Pantallas de sistema (sin equivalente en la plantilla)

| Pantalla | Cuándo | Diseño |
|---|---|---|
| Sesión expirada | 401 o refresco fallido | Aviso + «Iniciar sesión»; conserva `returnTo` |
| Sin permiso | 403 / rol insuficiente | «No tienes permiso para esta sección», enlace a Inicio |
| No encontrado | ruta o recurso inexistente/ajeno | Mensaje único (no distingue ajeno de inexistente) |
| Servicio no disponible | 503 / red | «Estamos teniendo problemas», `Retry-After`, reintentar, `correlationId` |
| Apartado vencido | 410 en hold | «Tu apartado venció», volver a la oferta |
| Pago en proceso | 202 | Estado con consulta periódica y tope |
| Mantenimiento/entorno de pruebas | configuración | Banda fija con el nombre del entorno |

---

## 4. Recorridos principales

**R1 — Búsqueda → compra → confirmación**
1. Inicio/Resultados (anónimo) → elegir oferta → 2. [si no hay sesión: acceso y regreso] → 3. Tarifa y asientos: el servicio crea el hold con los asientos (precio y vencimiento congelados) → 4. Pasajeros y equipaje → 5. Pago simulado: `createBooking` con la `Idempotency-Key` del intento → 6. Confirmación (201 `CONFIRMED` o 202 y consulta) → 7. Mis reservas.
Rutas alternativas: hold vencido → volver a la oferta; `SEAT_TAKEN` → mapa actualizado; oferta vencida → nueva búsqueda; 503 → reintentar con la misma clave.

**R2 — Mis reservas → postventa**
Mis reservas → Detalle → Postventa (Equipaje | Asiento | Fecha | Cancelar) → cotización → confirmación → detalle actualizado (o «En proceso» si 202).

**R3 — Check-in → pase de abordar**
Detalle (o aviso de «el check-in abre el…») → Check-in → ventana abierta → confirmar → pase por pasajero/tramo → imprimir. Fuera de ventana: mensaje con fecha/hora local de apertura.

**R4 — Administrador**
Iniciar sesión (rol `admin`) → Dashboard (fecha, ocupación, salud) → Vuelos (elegir vuelo → cambiar estado/puerta/retraso/cancelación con confirmación) → verificar en «Estado de un vuelo» público; Tarifas (vuelo → cabina/marca → guardar); Promociones (ver/actualizar acuerdo).

---

## 5. Datos de cada pantalla y operaciones del Gateway (solo v2)

El contrato v1 está **deprecado**: ninguna pantalla, operación GraphQL ni prueba de este diseño llama a `/flights/v1/*`. Todo el cliente va por `/api/v2/vuelos/*` con el JWT de Supabase. Convención: «pub» = sin token; los scopes son los del contrato v2 (`PartnerOAuth2`).

### 5.1 Canales, dueño y pago

| Actor | Ruta | Token | Alcance |
|---|---|---|---|
| Cliente | `/api/v2/vuelos/*` | JWT de Supabase, `app_role = customer`, scopes `flights:read flights:hold flights:book flights:cancel` | Recursos propios |
| Administrador (existente en v2) | `/api/v2/vuelos/operaciones/vuelos`, `PATCH /vuelos/flights/{n}/status`, `GET/PUT /vuelos/promociones/contrato`, `GET /vuelos/health` | JWT de Supabase con `app_role = admin` | Ver nota de scopes |
| Administrador (nuevo, B-2) | API interna de administración del Gateway (§5.5) | JWT de Supabase, rol `admin` + `flights:admin` | Lista de vuelos con ids y tarifas |

**Scopes del admin.** El hook de Supabase da al admin `flights:read flights:hold flights:book flights:cancel flights:webhooks flights:admin` (no `flights:ops`). Las rutas v2 de operaciones piden `flights:ops`, y el Gateway las concede con `flights:admin` (`v2/http.ts:48`; ADR-F12-10). El acuerdo de promociones pide `flights:admin` (PUT) y `flights:read` (GET). Un token de admin tiene, por tanto, los scopes necesarios; falta comprobarlo con un token real (S-2).

#### 5.1.1 Quién es el dueño (`ownerId`) en v2 — verificado en el código

`authenticateV2` (`v2/v2-security.ts:35-54`):
1. Intenta primero el emisor propio de partners (`devAuth.verify`). Un JWT de Supabase no es suyo → `null`.
2. Valida el JWT con los emisores configurados (`verifyBearer`) y obtiene `{ ownerId: sub, role, scopes }`.
3. **Solo si el rol es `partner`** (o el token es del dev-auth) se calcula `clientId` y el dueño compuesto `<clientId>~<X-User-Id>` (o la huella del dispositivo). Las cabeceras `X-User-Id` y `X-Device-Fingerprint` se leen únicamente dentro de ese `if`: **para `customer` y `admin` se ignoran**.

Resultado: un usuario de Supabase (`customer` o `admin`) tiene `ownerId = sub`, sin `~` y sin `clientId`. Todas las operaciones de reserva pasan `ownerId` al servicio (`callGatewayGrpc(..., { ...input, ownerId: req.auth.ownerId })`) y Reservation filtra por dueño: una reserva ajena responde 404.

Aislamiento frente a otros dueños:
- **Entre clientes:** distinto `sub` ⇒ distinto dueño.
- **Frente a socios:** los dueños de socios son `<clientId>~<usuario>`, o el `clientId` solo si no hay usuario. El `~` no puede aparecer en un `sub` de Supabase (UUID); el `clientId` de un socio del dev-auth se valida con `isValidClientId` (`dev-auth.ts:13-16`), que **rechaza formas UUID**, así que no puede coincidir con el `sub` de un cliente. Un partner de Supabase (cuenta de Booking) tiene su propio `sub`, distinto de los clientes.
- **`admin`:** es un `sub` más; no ve reservas ajenas (PLAN §2.3).

**Conclusión:** no hace falta ajuste de código. Queda como verificación con tokens reales (S-1: aislamiento entre dos clientes y entre un cliente y un socio). Detalle menor: en el registro de estado v2 el `clientId` de una reserva de cliente es el propio `sub` (`ownerClient(sub)`); no tiene efecto funcional (los eventos de webhooks solo van a suscripciones del mismo dueño).

#### 5.1.2 Pago en v2 para un cliente de la web — hueco bloqueante B-1

Lo que hace hoy el código al crear una reserva (`v2/booking.controller.ts:52-56`):

```
const partner = Boolean(req.auth.clientId);            // solo partners tienen clientId
createReservation({ …, payment: { paymentReference },
                    ...(partner ? { paymentChannel: 'BOOKING', deferIssuanceFailure: true } : {}) })
```

y en Reservation `RoutingPaymentVerifier.verify` (`routing-payment-verifier.ts:11`): sin canal → `fallback.verify` = `FakePaymentVerifier` (`pay_ok_*` autoriza, `pay_pending_*` pendiente, `pay_denied_*`/`pay_invalid_*`/`pay_mismatch_*` errores; `main.ts:38`). El postventa v2 aplica lo mismo (`postsale.controller.ts:36`: `paymentChannel` solo si hay `clientId`).

**Hallazgos:**
1. **La regla D4 (pago de Booking ≥ total, ADR-F12b2fix-02) no se exige a un usuario de Supabase.** Solo la verificación de Booking exige un pago real, y solo para `partner`. Nuestra web **puede vender hoy** con una referencia `pay_ok_<uuid>` (43 caracteres; el límite v2 es 64).
2. **Pero depende de un comportamiento por omisión no declarado:** «sin canal = verificador simulado» es un resto del camino v1. Si se endurece (p. ej. exigir canal, retirar el simulado de producción al deprecar v1), la web deja de vender sin aviso. No hay hoy un canal con nombre, ni interruptor, ni marca en los datos que distinga «pago simulado de la web».
3. **Faltan cosas para clientes:** `deferIssuanceFailure` solo se envía a partners; para un cliente, si Ticketing falla después de consumir el hold, la creación **falla** en lugar de responder 202 `TICKET_ISSUING` y reintentarse (ADR-F12-04). Los eventos `booking.ticket_issued/ticket_failed` se publican solo cuando hay canal de pago (ADR-F12-04), y un pago pendiente de un cliente no sigue el mismo camino que el de Booking.
4. **La referencia del contrato v2** (`PaymentReference`) trae `provider: BOOKING_PROTOTIPO | AIRLINE_DIRECT`; el Gateway lo ignora. No debe usarse para decidir el canal (lo controla el cliente).

**Propuesta (decidir aparte; no toca el contrato con Booking):**
- **Canal explícito `WEB`.** El Gateway decide el canal **solo por el rol del token**, nunca por el cuerpo: `partner` → `BOOKING` (sin cambios), `customer`/`admin` → `WEB`. Aplica a `createReservation`, `addBaggage`, `confirmDateChange` y cambio de asiento (que no cobra).
- **Reservation:** nuevo verificador `WebSimulatedPaymentVerifier` registrado como canal `WEB` en `RoutingPaymentVerifier` (mismas reglas de prefijos que el simulado actual), activo solo con `WEB_PAYMENT_MODE=simulated` (variable explícita; sin ella el canal `WEB` responde `PAYMENT_NOT_AUTHORIZED`/`VALIDATION_FAILED` y nada se vende). La columna `payment_channel` ya existe (valor `WEB`); sin cambio de `.proto` ni de migración. `deferIssuanceFailure` y los eventos de emisión se aplican a **todos** los canales v2.
- **Fallback sin canal:** se mantiene para tests/v1 mientras v1 exista; su retiro será una decisión posterior (la web ya no depende de él).
- **Front:** referencia `pay_ok_<uuid>` generada por el cliente, `amount` = precio congelado, rótulo «PAGO SIMULADO · sin cobro» siempre visible; los escenarios `pay_denied_`/`pay_pending_` solo en pruebas.
- **Riesgos:** (a) cualquier usuario registrado puede obtener boletos sin pagar, por diseño; mitigación: rótulo, límite por usuario (holds y reservas simultáneas), interruptor `WEB_PAYMENT_MODE`, limpieza por vencimiento de hold, sin efecto monetario; (b) abuso de inventario (agotar asientos) y del stock que se sincroniza con Booking, que ve disminuir el inventario por ventas de prueba; (c) regresión en el camino de Booking: se cubre con las pruebas existentes de pagos de Booking (`PAY-*`, `BookingPaymentVerifier`) y una prueba nueva de que un `customer` no puede forzar `BOOKING` ni un `partner` caer en `WEB`; (d) un canal simulado en producción debe estar autorizado por el humano y reflejado en el ADR.
- **Prueba (S-5):** con token real de `customer`, `POST /bookings` con `pay_ok_*` crea y emite; con `pay_denied_*` responde `PAYMENT_NOT_AUTHORIZED`; con un token de partner y `pay_ok_*` **no** se acepta (exige Booking).

### 5.2 Matriz pantalla → operación v2

Rutas bajo `/api/v2/vuelos`. «Cliente» = JWT de Supabase `customer`.

| Pantalla | Dato | Operación | Scope |
|---|---|---|---|
| Inicio | Rutas destacadas | — (configuración de marca) | — |
| Inicio/Resultados | Ofertas | `POST /search` (`X-Device-Fingerprint`) | pub |
| Estado de vuelo | Estado | `GET /flights/{flightNumber}/status?date=` | pub |
| Acceso | Sesión | Supabase Auth (no el Gateway) | — |
| Asientos | Mapa con `HELD` | `GET /offers/{offerId}/seatmap?segmentId=` | pub |
| Asientos | Crear hold (con `assignedSeats`, `ttlMinutes`) | `POST /offers/hold` + `Idempotency-Key` | `flights:hold` |
| Asientos/Pasajeros | Estado y tiempo del hold | `GET /offers/hold/{holdId}` | `flights:read` |
| Asientos | Liberar hold | `DELETE /offers/hold/{holdId}` | `flights:hold` |
| Pago | Crear reserva (201 / 202) | `POST /bookings` + `Idempotency-Key` | `flights:book` |
| Confirmación | Reintentar emisión si 202 | `POST /bookings/{id}/tickets` | `flights:book` |
| Confirmación/Detalle | Reserva | `GET /bookings/{id}` | `flights:read` |
| Confirmación/Detalle | Boletos | `GET /bookings/{id}/tickets` (`…/{ticketId}`) | `flights:read` |
| Mis reservas | Lista | `GET /bookings?pnr&status&createdFrom&createdTo&limit&cursor` | `flights:read` |
| Postventa equipaje | Opciones / comprar | `GET …/baggage-options`, `POST …/baggage` | `flights:read` / `flights:book` |
| Postventa asiento | Cambiar | `PUT /bookings/{id}/seats` | `flights:book` |
| Postventa fecha | Buscar / confirmar | `POST …/date-change/search`, `POST …/date-change` | `flights:read` / `flights:book` |
| Postventa cancelar | Cotizar / cancelar | `GET …/cancellation-quote`, `POST …/cancel` | `flights:read` / `flights:cancel` |
| Check-in | Check-in / pases | `POST …/check-in`, `GET …/boarding-passes` | `flights:book` / `flights:read` |
| Admin dashboard | Ocupación del día | `GET /operaciones/vuelos?date&origin&destination&status&limit&cursor` | `flights:ops` (admin vía `flights:admin`) |
| Admin dashboard | Salud | `GET /health` | pub |
| Admin vuelos | Lista de vuelos del día | `GET /operaciones/vuelos` (da `flightNumber`, `date`, estado, ocupación) | `flights:ops` |
| Admin vuelos | Cambio de estado/puerta/retraso/cancelación | `PATCH /flights/{flightNumber}/status` | `flights:ops` |
| Admin tarifas | Listar y guardar | **No existe en v2** → API interna B-2 (§5.5) | — |
| Admin promociones | Acuerdo | `GET/PUT /promociones/contrato` | `flights:read` / `flights:admin` |

`_links` de `BookingDetail` y `BookingListResponse` reflejan el estado (`bookingLinks`, `v2/links.ts`): `cancel`/`cancellation-quote` salvo `CANCELLED/FAILED/CANCELLATION_PENDING/CHANGE_PENDING`; `baggage-options` y `date-change-search` en `CONFIRMED`; `seats`, `check-in` y `boarding-passes` en `CONFIRMED` con boletos emitidos; `issue-tickets` en `PENDING_PAYMENT`/`TICKET_ISSUING`. El servicio GraphQL las expone como `availableActions` y el front las usa para mostrar u ocultar acciones; **no** reflejan la ventana de check-in (sigue siendo del servidor, §3.12).

### 5.3 Huecos: lo que una pantalla necesita y v2 NO ofrece hoy para un cliente final

| # | Hueco | Efecto en el diseño |
|---|---|---|
| **B-1** | **Canal de pago propio de la web** (§5.1.2): hoy funciona solo por el verificador simulado por omisión y sin `deferIssuanceFailure` para clientes | **Bloqueante** para formalizar la venta; propuesta en §5.1.2 y §14 |
| **B-2** | **API de administración para lista de vuelos con `flightInstanceId`, tarifas (GET/PUT)** (v1 deprecado; v2 no las tiene) | **Bloqueante** de las pantallas Tarifas; propuesta en §5.5 y §14 |
| H-1 | No hay catálogo de aeropuertos/rutas ni de vuelos por origen | Listas y rutas destacadas desde configuración estática; sin precios en las tarjetas |
| H-3 | `assignedSeats` en el hold y el estado `HELD` del mapa son un **acuerdo por encima del contrato v2** (ADR-F12b2fix-01), no parte de su texto | Se usan; el SDL los declara; si el contrato v2 cambia, se revisa |
| H-6 | **Puerta de embarque:** el contrato v2 declara `gate` en el estado de vuelo y en el pase, pero Operations no lo devuelve aún | Se muestra solo si viene; **BACKLOG con prioridad alta** (pequeño: Operations ya la guarda) — Q9 |
| H-7 | No hay consulta del estado de check-in sin ejecutarlo; el detalle no trae «ya hizo check-in» (se deduce de `boarding-passes`) | Ayuda de ventana en el cliente (48 h/60 min), autoridad del servidor |
| H-8 | **Salud del bus de eventos** no está en `GET /health` (solo siete servicios) | Dashboard muestra servicios y ESB; **BACKLOG con prioridad alta** (el ESB ya informa el bus en `/health/deps`) — Q9 |
| H-9 | La lista de reservas no trae total ni orden configurable; filtros solo `pnr`, `status`, fechas de creación | Paginación «cargar más» sin contador |
| H-10 | La búsqueda no filtra por cabina ni pagina/filtra por precio | Filtros de cabina/escalas en el cliente |
| H-11 | Sin edición de perfil ni pasajeros frecuentes | «Mi perfil» es «después» |
| H-12 | El panel de operaciones es de **una fecha** | El dashboard consulta por día |
| H-13 | `BOOKED/CHECKED_IN/BOARDED` pueden figurar en 0 en el panel (ADR-F12-10; verificar vigencia) | Barras por cabina pueden subestimar |
| H-14 | El acuerdo de promociones es **único** (no hay socios ni códigos) | Pantalla de un solo registro |
| H-16 | Límite de peticiones públicas por huella/IP (`security.ts:68`) | Reenvío de la huella del cliente + límite propio del servicio GraphQL; **riesgo conocido** (§7) |
| H-17 | `X-Device-Fingerprint` es obligatorio en la búsqueda v2 | El cliente genera un UUID por dispositivo |
| H-18 | Reservas compradas por un socio (Booking) tienen dueño `<clientId>~<usuario>`: **el cliente de la web no las ve** | Aviso en «Mis reservas» (§3.9) y «Buscar mi reserva» (§11) |
| H-19 | Reembolso: v2 **calcula** (`refund.status CALCULATED`) pero no ejecuta; con el pago simulado no hay movimiento de dinero | Texto «reembolso de prueba» |
| H-20 | `BAGGAGE_LIMIT_EXCEEDED` es 422 en v2; un pago pendiente en equipaje/cambio de fecha responde 422 `PAYMENT_NOT_AUTHORIZED` (el 202 del contrato queda para F12b, ADR-F12-04) | Mensajes del catálogo; sin estado «pendiente» en equipaje |

### 5.4 Pruebas previas (primer paso de F12c-1, con tokens reales de Supabase; las ejecuta el humano/auditor, sin leer `.env`)

| ID | Qué se comprueba | Si falla |
|---|---|---|
| **S-1** | **Recorrido completo del cliente en v2** con un token real de `customer`: buscar → mapa → hold con `assignedSeats` → reserva con referencia simulada → boletos → listado/detalle → equipaje → cambio de asiento → cambio de fecha → cotizar y cancelar → check-in → pases. **Aislamiento:** (a) un segundo `customer` recibe 404 en todo recurso del primero (detalle, boletos, postventa, check-in, pases, hold); su listado no lo incluye; (b) un token de **partner** (Booking) no ve las reservas del cliente y el cliente no ve las del partner; (c) el cliente no puede publicar como partner ni forzar canal por el cuerpo | Corregir el Gateway antes de F12c-1; bloquea la entrega |
| S-2 | Con token real de `admin`: `GET /operaciones/vuelos`, `PATCH /flights/{n}/status` y `GET/PUT /promociones/contrato` responden 200 (no 403) y un `customer` recibe 403 | Revisar scopes/hook de Supabase |
| S-3 | `customer` real: `PUT /bookings/{id}/seats` sobre una reserva creada por v2 de la misma cuenta | Ocultar la pestaña «Asiento» |
| S-4 | El límite de peticiones se aplica por `X-Device-Fingerprint` (pública) y por `sub` (autenticada) cuando la petición llega desde un servidor | Revisar la clave del límite con el humano |
| **S-5** | **Pago (§5.1.2):** `pay_ok_*` crea y emite; `pay_denied_*` → `PAYMENT_NOT_AUTHORIZED`; `pay_pending_*` → 202; con token de partner `pay_ok_*` no se acepta; tras B-1, el canal `WEB` con `WEB_PAYMENT_MODE` apagado no vende | Ver B-1 |
| S-6 | Tras B-2: `customer` y `partner` reciben 403 en la API interna; `admin` 200; el contrato v2 con Booking no cambia (suite de contrato) | Corregir B-2 |

### 5.5 API interna de administración (B-2) — propuesta, hueco

**Problema.** El panel V1 usaba `/flights/v1/admin/*` (lista de vuelos con `flightInstanceId`, tarifas, actualizaciones operacionales, crear/cerrar). Está en v1, deprecado; el contrato v2 con Booking no debe contener operaciones propias de nuestro panel.

**Propuesta.** Una **API interna de administración en el Gateway**, separada de `/api/v2/vuelos`:
- Prefijo propio (p. ej. `/api/admin/v1/*`), con su **propio OpenAPI interno** (`contracts/openapi/internal/admin-openapi.yaml`, archivo nuevo; **no** modifica `vuelos-openapi.yaml` ni `vuelos-openapi-v2.yaml`), validado por el Gateway con su propia instancia del validador y excluida de los contratos que se comparten con Booking.
- **Solo rol `admin` con scope `flights:admin`** (sin aceptar `partner`, ni siquiera con el scope), propagando `x-role` y exigiéndolo de nuevo cada servicio (los RPC ya lo hacen). Errores con `ProblemDetails` de v2 (§6.3).
- Reutiliza los manejadores existentes de `AdminController` (`admin.controller.ts`, esquemas Zod de `admin.schemas.ts`), re-montados bajo el nuevo prefijo; es cambio de rutas y contrato, no de lógica.

**Operaciones que necesita el panel V1 (Q3: el admin lista vuelos y cambia su estado; crear y cerrar, después):**

| Operación interna | Para qué pantalla | Origen actual |
|---|---|---|
| `GET /admin/flights?date&limit&cursor` → vuelos con `flightInstanceId`, `closed`, cabinas/capacidad | Selector de vuelo de **Tarifas** (el listado de **Vuelos** usa el panel v2) | `GET /flights/v1/admin/flights` |
| `GET /admin/fares?flightInstanceId` | Tarifas (leer) | `GET /flights/v1/admin/fares` |
| `PUT /admin/fares` | Tarifas (guardar; la clave natural vuelo+cabina+marca actualiza) | `PUT /flights/v1/admin/fares` |
| *(después)* `POST /admin/flights`, `POST /admin/flights/{id}/close` | Crear y cerrar la venta de un vuelo | v1 admin |
| *(no necesaria)* actualizaciones operacionales | El cambio de estado/puerta/retraso/cancelación usa `PATCH /vuelos/flights/{n}/status` de v2 | — |

Riesgos: bajo (rutas ya existentes, cambian de prefijo); hay que dar de baja la superficie v1 admin sin dejar rutas duplicadas con distinta autorización, y cubrir con pruebas de rol (`customer`/`partner` → 403) y de que las pruebas de contrato v2 siguen iguales.

---

## 6. Esquema GraphQL

### 6.1 SDL propuesto (V1)

Los comentarios `# GW:` indican la operación del Gateway **v2** (rutas bajo `/api/v2/vuelos`; `ADMIN-API` = API interna de administración, B-2). Los nombres siguen `camelCase`; los códigos de error son los de `ProblemDetails` v2. Los campos marcados *(forma a confirmar)* se completan con el OpenAPI interno de B-2.

```graphql
# ───────── Directivas ─────────
directive @authenticated on FIELD_DEFINITION          # exige JWT (el Gateway valida igualmente)
directive @admin on FIELD_DEFINITION                  # exige app_role = admin en GraphQL (además del Gateway)

# ───────── Escalares ─────────
scalar Date        # AAAA-MM-DD; fecha LOCAL del aeropuerto indicado por el campo
scalar DateTime    # ISO-8601 con desplazamiento; instante absoluto
scalar Decimal     # importe como cadena decimal ("630.00"); nunca número flotante

# ───────── Enumeraciones ─────────
enum Role { CUSTOMER ADMIN PARTNER }
enum CabinClass { ECONOMY PREMIUM_ECONOMY BUSINESS FIRST }
enum PassengerType { ADULT YOUTH CHILD INFANT }
enum DocumentType { PASSPORT NATIONAL_ID }
enum Gender { M F X }
enum BookingStatus { PENDING PENDING_PAYMENT TICKET_ISSUING CONFIRMED FAILED CHANGE_PENDING CANCELLATION_PENDING CANCELLED }
enum TicketStatus { PENDING ISSUING ISSUED FAILED VOIDED REFUNDED }
enum HoldStatus { HELD RELEASED EXPIRED CONSUMED }
enum SeatStatus { AVAILABLE HELD BOOKED TICKETED CHECKED_IN BOARDED }
enum CancelReasonCode { CUSTOMER_REQUEST OTHER }                  # SAGA_COMPENSATION y FLIGHT_CANCELLED son de uso interno/socios
enum RefundStatus { CALCULATED SETTLED NOT_REFUNDABLE }
enum InventoryRestorationStatus { RESTORED PENDING }
enum SeatCharacteristic { WINDOW AISLE EXTRA_LEGROOM EMERGENCY_EXIT }
enum FlightStatusCode { SCHEDULED BOARDING DEPARTED DELAYED ARRIVED CANCELLED DIVERTED }
enum CheckInStatus { NOT_ELIGIBLE AVAILABLE IN_PROGRESS COMPLETED FAILED }
enum PassengerCheckInStatus { CHECKED_IN NOT_CHECKED_IN FAILED }
enum BarcodeType { AZTEC PDF417 QR }
enum Outcome { COMPLETED PENDING }                    # 200/201 vs 202
enum ErrorCategory { VALIDATION UNAUTHENTICATED FORBIDDEN NOT_FOUND CONFLICT GONE UNPROCESSABLE RATE_LIMITED UNAVAILABLE INTERNAL }
enum HealthStatus { HEALTHY DEGRADED DOWN }
enum DependencyStatus { UP DOWN DEGRADED }

# ───────── Comunes ─────────
type Money { currency: String! total: Decimal! baseFare: Decimal taxes: Decimal }
type PageInfo { endCursor: String hasNextPage: Boolean! }
type Viewer { userId: ID! role: Role! }               # del JWT; no hay sesión en el servidor

# ───────── Búsqueda ─────────
input PassengerCountsInput { adults: Int! = 1  youths: Int = 0  children: Int = 0  infants: Int = 0 }
input ItineraryQueryInput { origin: String! destination: String! departureDate: Date! }  # IATA ^[A-Z]{3}$; fecha local del origen
input SearchInput { itineraries: [ItineraryQueryInput!]! passengers: PassengerCountsInput! }   # 1..6 tramos

type Airline { code: String name: String }
type Endpoint { iataCode: String! at: DateTime! terminal: String }
type Segment {
  segmentId: ID! flightNumber: String! departure: Endpoint! arrival: Endpoint!
  layoverMinutes: Int marketingCarrier: String! operatingCarrier: String!
  aircraft: String durationMinutes: Int status: FlightStatusCode
}
type FareRules { isRefundable: Boolean! isChangeable: Boolean! }
type BaggageAllowance { personalItemIncluded: Boolean carryOnIncluded: Int checkedBaggageIncluded: Int }
type PassengerTypePrice { passengerType: PassengerType price: Money }
type CabinPricing {
  cabinClass: CabinClass! fareBrand: String! availableSeats: Int! fareRules: FareRules!
  baggageAllowance: BaggageAllowance! extraCheckedBaggagePrice: Money
  pricePerPassengerType: [PassengerTypePrice!]!
}
type Itinerary { itineraryId: ID! totalDurationMinutes: Int! stopsCount: Int! segments: [Segment!]! pricingOptions: [CabinPricing!]! }
type FlightOffer { offerId: ID! airline: Airline! itineraries: [Itinerary!]! grandTotal: Money! }
type SearchResult { totalOffers: Int! offers: [FlightOffer!]! }

# ───────── Mapa de asientos ─────────
type Seat { seatNumber: String! status: SeatStatus! isAvailable: Boolean! characteristics: [SeatCharacteristic!]! }   # v2: isAvailable == (status = AVAILABLE)
type SeatRow { rowNumber: Int! seats: [Seat!]! }
type SeatMapCabin { cabinClass: CabinClass! rows: [SeatRow!]! }
type SeatMap { segmentId: ID! cabins: [SeatMapCabin!]! }

# ───────── Estado de vuelo ─────────
type StatusEndpoint { iataCode: String! terminal: String gate: String scheduledAt: DateTime! estimatedAt: DateTime actualAt: DateTime }   # gate: hoy no se llena (H-6)
type FlightStatus {
  flightNumber: String! date: Date! marketingCarrier: String! operatingCarrier: String!
  departure: StatusEndpoint! arrival: StatusEndpoint! aircraft: String status: FlightStatusCode! delayMinutes: Int updatedAt: DateTime
}

# ───────── Hold ─────────
input ItinerarySelectionInput { itineraryId: ID! cabinClass: CabinClass! fareBrand: String! }
# `seats` = `assignedSeats` del hold (acuerdo ADR-F12b2fix-01, formato de docs/booking-integration.md §5.1): se reparten en el orden de los pasajeros; a lo sumo tantos por tramo como pasajeros con asiento
input HoldOfferInput { offerId: ID! selections: [ItinerarySelectionInput!]! passengers: PassengerCountsInput! seats: [SeatAssignmentInput!] ttlMinutes: Int }   # ttlMinutes 5..30
type Hold { holdId: ID! status: HoldStatus! expiresAt: DateTime remainingSeconds: Int ttlMinutes: Int lockedPrice: Money! }

# ───────── Reservas ─────────
input ContactInput { email: String! phone: String! }
input SeatAssignmentInput { segmentId: ID! seatNumber: String! }
input ExtraBaggageInput { itineraryId: ID! quantity: Int! }                              # 0..3
input PassengerInput {
  passengerId: ID! passengerType: PassengerType! associatedAdultId: ID
  firstName: String! lastName: String! documentType: DocumentType! documentNumber: String!
  nationality: String! documentExpiryDate: Date birthDate: Date! gender: Gender! contact: ContactInput!
  assignedSeats: [SeatAssignmentInput!] extraBaggage: [ExtraBaggageInput!]
}
input CreateBookingInput { holdId: ID! passengers: [PassengerInput!]! paymentReference: String! }

type SeatAssignment { segmentId: ID! seatNumber: String! }
type ExtraBaggage { itineraryId: ID! quantity: Int! }
type BookingPassenger {
  passengerId: ID! passengerType: PassengerType! firstName: String! lastName: String!
  documentType: DocumentType! documentNumberMasked: String!       # solo últimos caracteres; el número completo no sale del servicio
  nationality: String birthDate: Date gender: Gender assignedSeats: [SeatAssignment!] extraBaggage: [ExtraBaggage!]
}
type TicketSegment { segmentId: ID! status: String! couponNumber: String }
type Ticket { ticketId: ID! passengerId: ID! eTicketNumber: String status: TicketStatus! issuedAt: DateTime segments: [TicketSegment!] failureReason: String }
type BookingChange { changedAt: DateTime description: String }
type Booking {
  bookingId: ID! pnr: String! status: BookingStatus! grandTotal: Money! createdAt: DateTime! updatedAt: DateTime
  availableActions: [String!]!    # claves de `_links` (cancel, check-in, seats, baggage-options, date-change-search, issue-tickets…): reflejan el estado, no la ventana de check-in
  itineraries: [Itinerary!] passengers: [BookingPassenger!] tickets: [Ticket!] changes: [BookingChange!]
}
type BookingSummary { bookingId: ID! pnr: String! status: BookingStatus! origin: String destination: String departureDate: Date grandTotal: Money availableActions: [String!]! }
type BookingEdge { cursor: String! node: BookingSummary! }
type BookingConnection { edges: [BookingEdge!]! pageInfo: PageInfo! }
input BookingFilterInput { pnr: String status: BookingStatus createdFrom: Date createdTo: Date }
type CreateBookingPayload { outcome: Outcome! booking: Booking! }

# ───────── Postventa ─────────
type BaggageOption { passengerId: ID! itineraryId: ID! price: Money maxAllowed: Int alreadyPurchased: Int }
input AddBaggageInput { bookingId: ID! passengerId: ID! itineraryId: ID! quantity: Int! paymentReference: String! }
type AddBaggagePayload { passengerId: ID! itineraryId: ID! totalBaggage: Int! }

input DateChangeInput { itineraryId: ID! newDepartureDate: Date! }                       # fecha local del origen del tramo
type DateChangePrice { fareDifference: Decimal taxDifference: Decimal changeFee: Decimal totalToPay: Decimal }
type DateChangeOffer { changeOfferId: ID! expiresAt: DateTime! segments: [Segment!]! priceDifference: DateChangePrice! }
input ConfirmDateChangeInput { bookingId: ID! changeOfferId: ID! paymentReference: String assignedSeats: [SeatChangeInput!] }
type ConfirmDateChangePayload { outcome: Outcome! booking: Booking }

type CancellationQuote { quoteId: ID! isRefundable: Boolean! refundAmount: Decimal! penaltyAmount: Decimal! currency: String! expiresAt: DateTime! }
type Refund { refundId: String amount: Decimal penaltyAmount: Decimal currency: String percentage: Float status: RefundStatus }   # la aerolínea calcula; con pago simulado no hay movimiento de dinero (H-19)
type InventoryRestoration { status: InventoryRestorationStatus seatsReleased: Int }
type CancelBookingPayload { outcome: Outcome! status: BookingStatus! cancelledAt: DateTime refund: Refund ticketsVoided: [String!] inventoryRestoration: InventoryRestoration message: String }
type IssueTicketsPayload { booking: Booking! issued: Int! }

input SeatChangeInput { passengerId: ID! segmentId: ID! seatNumber: String! }
type SeatChange { passengerId: ID! segmentId: ID! previousSeatNumber: String seatNumber: String! status: SeatStatus! }
type ChangeSeatsPayload { seats: [SeatChange!]! }   # v2: sin costo; `amountCharged` se omite

# ───────── Check-in ─────────
type CheckedInSegment { segmentId: ID! seat: String status: PassengerCheckInStatus! }
type CheckedInPassenger { passengerId: ID! status: PassengerCheckInStatus! segments: [CheckedInSegment!] }
type CheckInResult { bookingId: ID! status: CheckInStatus! checkedInPassengers: [CheckedInPassenger!]! }
type BoardingPass { passengerId: ID! segmentId: ID! seat: String! boardingGroup: String boardingPosition: String gate: String barcode: String! barcodeType: BarcodeType! }   # gate: hoy no se llena (H-6)

# ───────── Administración (@admin) ─────────
type AdminCabin { cabinClass: CabinClass! capacity: Int! }
type AdminFlight {                                                                        # forma a confirmar con el OpenAPI interno (B-2)
  flightInstanceId: ID! flightNumber: String! departureIata: String! arrivalIata: String!
  departureAt: DateTime! arrivalAt: DateTime! cabins: [AdminCabin!]! aircraft: String closed: Boolean!
}
type AdminFlightConnection { items: [AdminFlight!]! pageInfo: PageInfo! }
type AdminFare {
  fareId: ID! flightInstanceId: ID! cabinClass: CabinClass! fareBrand: String!
  price: Money! fareRules: FareRules! baggageAllowance: BaggageAllowance! extraCheckedBaggagePrice: Money!
}
input MoneyInput { currency: String! total: Decimal! baseFare: Decimal taxes: Decimal }
input UpsertFareInput {
  fareId: ID flightInstanceId: ID! cabinClass: CabinClass! fareBrand: String! price: MoneyInput!
  isRefundable: Boolean! isChangeable: Boolean! personalItemIncluded: Boolean carryOnIncluded: Int checkedBaggageIncluded: Int
  extraCheckedBaggagePrice: MoneyInput!
}
type SeatsByStatus { AVAILABLE: Int HELD: Int BOOKED: Int TICKETED: Int CHECKED_IN: Int BOARDED: Int }   # nombres de campo en mayúsculas, igual que el contrato v2
type CabinOccupancy { cabinClass: CabinClass! totalSeats: Int! seatsByStatus: SeatsByStatus! }
type FlightAlert { code: String! severity: String! message: String }
type FlightOperation {
  flightNumber: String! date: Date! origin: String! destination: String! departureAt: DateTime!
  status: FlightStatusCode! aircraft: String totalSeats: Int! loadFactor: Float! cabins: [CabinOccupancy!]!
  activeHolds: Int! nextHoldExpiryAt: DateTime checkInOpen: Boolean! alerts: [FlightAlert!]!
}
type FlightOperationConnection { totalFlights: Int! items: [FlightOperation!]! pageInfo: PageInfo! }
type DependencyHealth { name: String! status: DependencyStatus! latencyMs: Int }
type PlatformHealth { status: HealthStatus! nodeId: String! version: String! uptimeSeconds: Int latencyMs: Int dependencies: [DependencyHealth!]! timestamp: DateTime! }
input FlightStatusUpdateInput { date: Date! status: FlightStatusCode! estimatedDepartureAt: DateTime estimatedArrivalAt: DateTime departureGate: String reason: String }
type FlightStatusUpdate { previousStatus: FlightStatusCode flight: FlightStatus! affectedBookings: Int! eventId: String }
type PromotionAgreement {
  allowsPromotions: Boolean! maxDiscountPercent: Float! destinations: [String!] routes: [String!]
  cabins: [CabinClass!] validUntil: Date conditions: String updatedAt: DateTime
}
input PromotionAgreementInput {
  allowsPromotions: Boolean! maxDiscountPercent: Float! destinations: [String!] routes: [String!]
  cabins: [CabinClass!] validUntil: Date conditions: String
}

# ───────── Consultas ─────────
type Query {
  # públicas
  searchFlights(input: SearchInput!): SearchResult!                                  # GW: POST /search
  seatMap(offerId: ID!, segmentId: ID!): SeatMap!                                    # GW: GET /offers/{id}/seatmap (con HELD)
  flightStatus(flightNumber: String!, date: Date!): FlightStatus!                    # GW: GET /flights/{n}/status

  # cliente
  viewer: Viewer @authenticated                                                       # del JWT (sin llamada al Gateway)
  hold(holdId: ID!): Hold! @authenticated                                            # GW: GET /offers/hold/{id}
  myBookings(filter: BookingFilterInput, first: Int = 10, after: String): BookingConnection! @authenticated  # GW: GET /bookings (first≤50)
  booking(bookingId: ID!): Booking! @authenticated                                   # GW: GET /bookings/{id} (+ /tickets)
  boardingPasses(bookingId: ID!): [BoardingPass!]! @authenticated                    # GW: GET /bookings/{id}/boarding-passes
  baggageOptions(bookingId: ID!): [BaggageOption!]! @authenticated                   # GW: GET …/baggage-options
  searchDateChange(bookingId: ID!, changes: [DateChangeInput!]!): [DateChangeOffer!]! @authenticated   # GW: POST …/date-change/search (solo lectura)
  cancellationQuote(bookingId: ID!): CancellationQuote! @authenticated               # GW: GET …/cancellation-quote

  # administrador
  adminFlights(date: Date, first: Int = 50, after: String): AdminFlightConnection! @admin          # GW: ADMIN-API GET /admin/flights (B-2)
  adminFares(flightInstanceId: ID): [AdminFare!]! @admin                                           # GW: ADMIN-API GET /admin/fares (B-2)
  flightOperations(date: Date!, origin: String, destination: String, status: FlightStatusCode, first: Int = 50, after: String): FlightOperationConnection! @admin  # GW: GET v2 /operaciones/vuelos
  platformHealth: PlatformHealth!                                                                  # GW: GET v2 /health (pública)
  promotionAgreement: PromotionAgreement @admin                                                    # GW: GET v2 /promociones/contrato (404 → null)
}

# ───────── Mutaciones (idempotencyKey: UUID generado por el cliente por intención) ─────────
type Mutation {
  holdOffer(input: HoldOfferInput!, idempotencyKey: ID!): Hold! @authenticated                 # GW: POST /offers/hold
  releaseHold(holdId: ID!): Boolean! @authenticated                                            # GW: DELETE /offers/hold/{id}
  createBooking(input: CreateBookingInput!, idempotencyKey: ID!): CreateBookingPayload! @authenticated   # GW: POST /bookings (canal WEB, B-1)
  addBaggage(input: AddBaggageInput!, idempotencyKey: ID!): AddBaggagePayload! @authenticated  # GW: POST …/baggage
  confirmDateChange(input: ConfirmDateChangeInput!, idempotencyKey: ID!): ConfirmDateChangePayload! @authenticated  # GW: POST …/date-change
  cancelBooking(bookingId: ID!, quoteId: ID!, reasonCode: CancelReasonCode = CUSTOMER_REQUEST, reason: String, idempotencyKey: ID!): CancelBookingPayload! @authenticated  # GW: POST …/cancel
  changeSeats(bookingId: ID!, seats: [SeatChangeInput!]!, idempotencyKey: ID!): ChangeSeatsPayload! @authenticated        # GW: PUT v2 …/seats
  issueTickets(bookingId: ID!): IssueTicketsPayload! @authenticated                           # GW: POST …/tickets (reintento de emisión tras un 202)
  checkIn(bookingId: ID!): CheckInResult! @authenticated                                       # GW: POST …/check-in

  updateFlightStatus(flightNumber: String!, input: FlightStatusUpdateInput!, idempotencyKey: ID): FlightStatusUpdate! @admin  # GW: PATCH v2 /flights/{n}/status
  upsertFare(input: UpsertFareInput!): AdminFare! @admin                                       # GW: ADMIN-API PUT /admin/fares (B-2)
  setPromotionAgreement(input: PromotionAgreementInput!, idempotencyKey: ID!): PromotionAgreement! @admin  # GW: PUT v2 /promociones/contrato
}
```

Decisiones de forma:
- Todo va por v2; el front no conoce rutas ni versiones. `holdOffer` envía `assignedSeats` solo si hay `seats`.
- `createBooking` y demás devuelven `Outcome` para distinguir 200/201 de 202 sin exponer códigos HTTP.
- Sin suscripciones (no hay canal de eventos hacia el navegador; el seguimiento es por consulta).
- `documentNumber` solo entra (mutación) y sale enmascarado: el servicio GraphQL **no devuelve** números de documento completos.
- Fuera de V1 y por tanto **fuera del esquema**: webhooks, telemetría, perfil, creación y cierre de vuelos (Q3: después, vía la API interna B-2).
- `paymentReference` **no se devuelve** (dato sensible por PLAN §2.4); `availableActions` evita que el front calcule reglas de estado.

### 6.2 Correspondencia con el Gateway

Está inline en el SDL (`# GW:`) y en la matriz §5.2. El servicio traduce nombres de v2 y de la API interna (`itinerarySelections` → `selections`, `porcentaje_descuento_maximo` → `maxDiscountPercent`, `dependencias[].nombre` → `dependencies[].name`), convierte `MoneyAmount` a `Money`, y mapea ids de pasajero a los que el cliente envió.

### 6.3 Errores: de ProblemDetails a errores de GraphQL

Solo existe el formato de **`ProblemDetails` de v2** (`application/problem+json`): `type, title, status, code, detail?, instance?, correlation_id?, timestamp?, invalidParams?` (`code` del enum de v2: `VALIDATION_FAILED, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, RATE_LIMIT_EXCEEDED, IDEMPOTENCY_KEY_REUSED, INTERNAL_ERROR, PROVIDER_UNAVAILABLE, OFFER_NO_LONGER_AVAILABLE, HOLD_EXPIRED, HOLD_ALREADY_CONSUMED, SEAT_TAKEN, SEAT_CABIN_MISMATCH, INFANT_SEAT_NOT_ALLOWED, INFANT_WITHOUT_ADULT, PASSENGER_COUNT_MISMATCH, DOCUMENT_EXPIRED, PASSPORT_REQUIRED_INTERNATIONAL, PAYMENT_REFERENCE_INVALID, PAYMENT_NOT_AUTHORIZED, AMOUNT_MISMATCH, PNR_CREATION_FAILED, BOOKING_NOT_CONFIRMED, TICKET_ISSUANCE_FAILED, TICKET_ALREADY_ISSUED, BAGGAGE_LIMIT_EXCEEDED, FARE_NOT_CHANGEABLE, CHANGE_OFFER_EXPIRED, QUOTE_EXPIRED, ALREADY_CANCELLED, BOOKING_NOT_CANCELLABLE, CUTOFF_PASSED, CHECK_IN_NOT_AVAILABLE, CHECK_IN_FAILED, BOARDING_PASS_NOT_AVAILABLE, FLIGHT_ALREADY_DEPARTED, FLIGHT_CANCELLED, FLIGHT_STATUS_NOT_AVAILABLE, INVALID_STATUS_TRANSITION, PROMOTION_DISCOUNT_OUT_OF_RANGE`). La API interna de administración (B-2) usa el mismo formato. El `correlation_id` del cuerpo y la cabecera `X-Correlation-Id` deben coincidir con el enviado. El servicio **nunca** reenvía el cuerpo tal cual; construye un `GraphQLError` con extensiones controladas:

```json
{ "message": "Ese asiento acaba de ser ocupado.",
  "path": ["createBooking"],
  "extensions": { "code": "SEAT_TAKEN", "category": "CONFLICT", "httpStatus": 409,
                  "correlationId": "…", "retryAfterSeconds": null,
                  "invalidParams": [{ "name": "passengers[0].assignedSeats[0]", "reason": "…" }] } }
```

- `extensions.code` = `ProblemDetails.code` (`UNAUTHORIZED` se traduce a `UNAUTHENTICATED`; `PROVIDER_UNAVAILABLE` se conserva; más `GATEWAY_UNAVAILABLE` y `GRAPHQL_*` para errores propios del servicio).
- `category` se decide **primero por el estado HTTP** y luego por el código (en v2 401 → `UNAUTHORIZED` y 403 → `FORBIDDEN`, pero un guardia heredado de v1 podría responder `VALIDATION_FAILED` con 401/403, y 503 puede traer `RATE_LIMIT_EXCEEDED` o `PROVIDER_UNAVAILABLE`).

| HTTP | `category` | `code` típicos |
|---|---|---|
| 400 | `VALIDATION` | `VALIDATION_FAILED` (+ `invalidParams`), reglas v2 de pasajeros |
| 401 | `UNAUTHENTICATED` | `UNAUTHORIZED` → `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` | `FORBIDDEN` |
| 404 | `NOT_FOUND` | `NOT_FOUND`, `FLIGHT_STATUS_NOT_AVAILABLE` (ajeno e inexistente son indistinguibles). `BOARDING_PASS_NOT_AVAILABLE` llega como 409 en v2 |
| 409 | `CONFLICT` | `SEAT_TAKEN`, `OFFER_NO_LONGER_AVAILABLE`, `HOLD_ALREADY_CONSUMED`, `BOOKING_NOT_CONFIRMED`, `BOOKING_NOT_CANCELLABLE`, `ALREADY_CANCELLED`, `TICKET_ALREADY_ISSUED`, `FARE_NOT_CHANGEABLE`, `FLIGHT_ALREADY_DEPARTED`, `FLIGHT_CANCELLED`, `CUTOFF_PASSED`, `CHECK_IN_NOT_AVAILABLE`, `BOARDING_PASS_NOT_AVAILABLE`, `QUOTE_EXPIRED`, `INVALID_STATUS_TRANSITION`, `IDEMPOTENCY_KEY_REUSED` (con `Retry-After` → `retryAfterSeconds` si es «en curso») |
| 410 | `GONE` | `HOLD_EXPIRED`, `CHANGE_OFFER_EXPIRED` |
| 422 | `UNPROCESSABLE` | `INFANT_SEAT_NOT_ALLOWED`, `SEAT_CABIN_MISMATCH`, `INFANT_WITHOUT_ADULT`, `PASSENGER_COUNT_MISMATCH`, `DOCUMENT_EXPIRED`, `PASSPORT_REQUIRED_INTERNATIONAL`, `PAYMENT_REFERENCE_INVALID`, `PAYMENT_NOT_AUTHORIZED`, `AMOUNT_MISMATCH`, `CHECK_IN_FAILED`, `BAGGAGE_LIMIT_EXCEEDED`, `PROMOTION_DISCOUNT_OUT_OF_RANGE` |
| 429 | `RATE_LIMITED` | `RATE_LIMIT_EXCEEDED` (`Retry-After` → `retryAfterSeconds`) |
| 502/503/504 | `UNAVAILABLE` | `PROVIDER_UNAVAILABLE`, `RATE_LIMIT_EXCEEDED` (`Retry-After` → `retryAfterSeconds`) |
| 5xx otros, cuerpo no válido, tiempo agotado | `INTERNAL`/`UNAVAILABLE` | `INTERNAL_ERROR` / `GATEWAY_UNAVAILABLE` |

Reglas: (1) `message` sale de un **catálogo propio** por `code` (español, sin valores del usuario); el `detail` del Gateway no se reenvía salvo `invalidParams[].name` y `reason` si pasan una lista de caracteres seguros; (2) un código desconocido se transmite como `UNKNOWN_GATEWAY_ERROR` con la `category` por HTTP; (3) nunca stack trace ni mensajes internos (PLAN §2.5); (4) con errores en un campo no nulo, GraphQL anula el padre: las consultas devuelven `data: null` + `errors`, y por eso los campos que pueden faltar legítimamente son anulables (`promotionAgreement`: 404 → `null`); (5) el cliente decide la acción por `category`/`code` (reintentar, refrescar mapa, volver a cotizar, iniciar sesión), no por el texto.

### 6.4 Paginación

Conexiones con cursor opaco, **solo hacia delante** (los backends son cursores forward-only): `first` (por defecto 10; máximo 50 en reservas, 200 en vuelos de admin → `limit`) y `after` (→ `cursor`). `pageInfo.hasNextPage` = «el Gateway devolvió `nextCursor`» y `endCursor` = ese cursor, que el servicio entrega sin modificar. No hay `totalCount` (H-9; `totalFlights` del panel v2 sí se expone porque el contrato lo trae). Las ofertas de búsqueda **no** se paginan (tope de 10 en el servidor). Se rechaza `first > máximo` con `VALIDATION`.

### 6.5 `correlationId` y cabeceras que viajan

| Dirección | Cabecera | Regla |
|---|---|---|
| Navegador → GraphQL | `Authorization: Bearer <JWT>` (si hay sesión) | Se reenvía sin almacenar |
| | `X-Correlation-Id` | Lo genera la app (UUID) **por intención de negocio**: el mismo valor en `holdOffer` y `createBooking` de una misma compra; uno nuevo en cada búsqueda y cada acción de postventa. Si falta, el servicio crea uno. Si supera 100 caracteres (el Gateway devuelve 400) o no es seguro (`[A-Za-z0-9._-]{1,100}`), el servicio lo reemplaza |
| | `X-Device-Fingerprint` | Identificador aleatorio del dispositivo (UUID guardado en `localStorage` o almacenamiento seguro móvil), **sin datos personales ni huellas del navegador**. Es obligatorio en `/search` y es la clave del límite de peticiones públicas (§7, riesgo conocido); el servicio lo valida (≤128, caracteres seguros) y lo reenvía |
| | `Idempotency-Key` | Lo aporta el argumento `idempotencyKey` de la mutación; el servicio lo reenvía como cabecera |
| GraphQL → Gateway | `Authorization`, `X-Correlation-Id`, `X-Request-Id` (nuevo por salto), `X-Device-Fingerprint`, `Idempotency-Key` | El correlationId **no se modifica**; el Gateway lo propaga a los servicios (gRPC `x-correlation-id`) |
| GraphQL → navegador | `X-Correlation-Id` (+ `X-Request-Id`) en toda respuesta y `extensions.correlationId` en todo error | `Access-Control-Expose-Headers: X-Correlation-Id, X-Request-Id, Retry-After` |

En los logs del servicio GraphQL y en los errores visibles al usuario («Detalles técnicos»), el `correlationId` permite reconstruir la compra con la misma consulta que usa el resto de la plataforma.

---

## 7. Reglas transversales del servicio GraphQL

| Tema | Regla |
|---|---|
| **Autenticación** | El servicio **no guarda sesión ni emite tokens**. Reenvía el `Authorization` de cada petición al Gateway, que valida firma (JWKS), `iss`, `aud`, `exp`. Para decidir `@admin` y `viewer` el servicio también valida el JWT contra el mismo JWKS de Supabase (RS256/ES256; sin `none`/`HS*`) y lee `app_role`; no confía en nada que llegue sin firma. Operaciones `@authenticated` sin token → `UNAUTHENTICATED` **sin llamar al Gateway** |
| **Autorización por rol** | `@admin` exige `app_role = admin` en GraphQL (error `FORBIDDEN` sin llamar al Gateway) **y** el Gateway vuelve a exigir rol + scope (`flights:admin`); los servicios, a su vez, filtran por owner y verifican rol. El servicio nunca filtra por propietario por su cuenta: delega en el Gateway (recurso ajeno ⇒ 404). Roles distintos de `customer`/`admin` (`partner`) no son un caso de la web: se tratan como `customer` sin privilegios adicionales |
| **Profundidad y complejidad** | Profundidad máxima 8; complejidad máxima con costo por campo/lista (los listados cuestan `first`); máximo de alias (≈15) y de operaciones por documento (1); **sin batching** de operaciones; sin directivas no declaradas |
| **Operaciones permitidas** | En producción se recomienda **lista de operaciones conocidas** (persisted operations/documentos de confianza generados del paquete compartido de operaciones): el servidor solo ejecuta lo que la app publicó. Complementa límites y reduce el abuso (decisión Q6) |
| **Introspección** | Desactivada con `NODE_ENV=production` (también las sugerencias «¿quisiste decir…?»); activa en local y CI. Sin playground en producción |
| **Tamaño y tiempo** | Cuerpo máximo 100 kB (igual que el Gateway); `variables` ≤ 64 kB; tiempo máximo por operación (≈10 s) y por llamada al Gateway (≈8 s; el Gateway ya tiene los suyos); sin `multipart`/subida de archivos |
| **CORS** | Lista blanca `CORS_ORIGINS` (origen exacto de la web; `http://localhost:5173` solo fuera de producción); métodos `POST`, `OPTIONS`; cabeceras permitidas `Authorization, Content-Type, X-Correlation-Id, X-Device-Fingerprint`; expone `X-Correlation-Id, X-Request-Id, Retry-After`; **sin credenciales de cookie** (el token va en cabecera). El móvil no usa CORS |
| **Seguridad HTTP** | `helmet`; HSTS; rechaza `X-Forwarded-Proto: http` como el Gateway; `trust proxy` = 1 |
| **Registros** | Solo: `operationName`, `correlationId`, `requestId`, `role`, `status`/categoría, latencia, `code` de error. **Nunca** `variables`, texto de la consulta de mutaciones con PII, `Authorization`, ni campos de PLAN §2.4 (`documentNumber`, `email`, `phone`, `firstName`, `lastName`, `authorization`, `secret`, `paymentReference`). Redacción por lista blanca de campos, no por lista negra |
| **Límite de peticiones** | El Gateway limita por `X-Device-Fingerprint` (pública) o por `sub` (autenticada) y, para el Gateway, **todas las peticiones salen de la IP del servicio GraphQL**. El servicio GraphQL aplica **su propio límite combinando `X-Device-Fingerprint` (la genera el cliente y puede cambiarse) con la IP real del cliente**, tomada de la cadena `X-Forwarded-For` que añade el balanceador de Cloud Run (solo el salto de confianza; nunca el valor que el cliente pueda inyectar), y reenvía la huella al Gateway. **Riesgo conocido (registrado):** un cliente malintencionado cambia la huella para evadir el límite por huella, y quien comparte IP (NAT, red de campus) comparte cupo; el límite en memoria por instancia de Cloud Run tampoco es global. Es contención de abuso, no una barrera de seguridad; la barrera de recursos sigue siendo el Gateway (límite por `sub` en operaciones autenticadas) y B-3 (topes por usuario) |
| **Salida** | Respuestas desde tipos explícitos (nunca el cuerpo del Gateway completo); `documentNumberMasked`; sin campos internos |
| **Entrada** | Validación por esquema en la frontera (formato IATA, UUID, longitudes, enumeraciones) antes de llamar al Gateway; el Gateway y los servicios vuelven a validar |
| **Salud** | `GET /health` HTTP (no gRPC) para Cloud Run y la comprobación del contenedor |
| **Dependencias** | Versiones fijadas; `npm audit --audit-level=high` en CI (AGENTS) |

---

## 8. Estructura del monorepo

`package.json` ya incluye `workspaces: packages/*, microservices/*, platform/*`. `platform/web` existe como marcador (`export {}`).

```
flight-platform/
├─ platform/
│  ├─ api-gateway/              (existente)
│  ├─ graphql/                  NUEVO F12c-1: servicio GraphQL (NestJS; domain/application/infrastructure)
│  └─ web/                      F12c-2/3: app web React (Vite + TS): área cliente + /admin (chunk perezoso)
├─ packages/
│  ├─ shared/                   (existente; incluye airport-time y money)
│  ├─ contracts/                (existente; gRPC)
│  ├─ graphql-schema/           NUEVO: schema.graphql (el SDL de §6.1), operaciones .graphql, tipos y documentos generados (codegen), lista de operaciones conocidas
│  ├─ session/                  NUEVO: cliente de sesión sobre Supabase (PKCE) con interfaz de almacenamiento (web: localStorage; móvil: almacenamiento seguro); lectura de claims; refresco; sin UI
│  ├─ format/                   NUEVO: fechas/horas locales del aeropuerto, dinero (`es-EC`), duraciones, enmascarado de documento, `+1` día; reutiliza `AIRPORT_ZONES`
│  ├─ checkin-rules/ (o dentro de `format`)  reglas de ventana y mensajes (sin DOM)
│  ├─ design-tokens/            NUEVO: tokens.ts + generador de tokens.css (§2)
│  └─ brand/                    NUEVO: brand.config.ts, logo(s) SVG, fotos, fuentes (§2)
└─ apps/mobile/                 DESPUÉS: React Native; importa los paquetes anteriores (habrá que añadir "apps/*" a workspaces y configurar Metro)
```

Reglas de dependencia: `platform/web` y `apps/mobile` → paquetes; los paquetes **no** importan `platform/*`; `graphql-schema` es la única fuente de las operaciones (web y móvil las importan, no las reescriben); `format`, `session`, `graphql-schema` no importan DOM, NestJS ni React Native (solo APIs estándar y `Intl`).

Pendiente de comprobar al iniciar F12c-1: que `airport-time.ts` pueda importarse desde el navegador (hoy forma parte de `@flight-platform/shared`, que puede arrastrar código de Node/NestJS): si no, exponerlo como subruta sin dependencias o moverlo a un paquete mínimo, **manteniendo una sola tabla**. También revisar `scripts/verify-workspace-dist.cjs` y `scripts/ci/check-deploy-env.cjs`, que se ejecutan en `npm run lint` y pueden asumir la forma de los workspaces actuales.

Herramientas propuestas (a confirmar en F12c-1/2 contra versiones vigentes y `npm audit`): GraphQL Code Generator (tipos y documentos), un servidor GraphQL con esquema primero (SDL como contrato) bajo NestJS, un cliente GraphQL compatible con React Native (p. ej. Apollo Client o urql), React Router, Vitest + Testing Library + Playwright en la web, Jest en el servicio (como el resto), `supabase-js` en `packages/session`.

---

## 9. Despliegue previsto

| Pieza | Dónde | Notas |
|---|---|---|
| Servicio GraphQL | **Cloud Run** (como los servicios); contenedor con `PORT=8080`, `/health` HTTP | Imagen propia con el Dockerfile de `infra/` (se evalúa su reutilización en F12c-1; **no** se modifica `infra/` aquí). Mínimo 0 instancias (costo) → arranque en frío (§9.1). Secretos por Secret Manager |
| Gateway | **Render** (existente) | El servicio GraphQL lo llama por su URL pública; `CORS_ORIGINS` del Gateway **no** necesita incluir la web (la web no lo llama) |
| App web | **Sitio estático** (Render Static Sites, u otra opción gratuita: Cloudflare Pages/Netlify) | Construcción: `npm ci` + `npm run build -w …/web` (Vite) → `dist`. Regla de reescritura `/* → /index.html`. Cabeceras: CSP (`default-src 'self'`; `connect-src` = URL de GraphQL + URL de Supabase; `img-src 'self' data:`; sin `unsafe-inline` de scripts), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'` |
| Autenticación | Supabase (proyecto existente) | Site URL y **URLs de redirección exactas** de la web (producción y local) en Authentication → URL Configuration; PKCE |

**Variables públicas de la app web (se incrustan en el bundle: no hay secretos):**

| Variable | Contenido |
|---|---|
| `VITE_GRAPHQL_URL` | URL pública del servicio GraphQL |
| `VITE_SUPABASE_URL` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Llave `anon` (pública por diseño; nunca la de servicio) |
| `VITE_ENV_NAME` | `produccion` / `pruebas` / `local` (rótulo «Entorno de pruebas») |
| `VITE_TEST_PAYMENT_SCENARIOS` | `true` solo en pruebas: muestra los escenarios de pago rechazado/pendiente |
| `VITE_CHECKIN_OPEN_HOURS`, `VITE_CHECKIN_CLOSE_MINUTES` | Ayuda de la ventana de check-in (48 / 60); la autoridad es Operations (H-7) |

**Variables del servicio GraphQL** (secretos en Secret Manager): `GATEWAY_BASE_URL`, `JWT_ISSUERS` (misma forma que el Gateway: `iss`, `aud`, `jwksUri`), `CORS_ORIGINS`, `NODE_ENV`, límites (`MAX_QUERY_DEPTH`, `MAX_COMPLEXITY`, `MAX_BODY_BYTES`, `OPERATION_TIMEOUT_MS`), `INTROSPECTION=false` por defecto en producción. No usa base de datos.

**Orígenes de CORS (servicio GraphQL):** la URL de producción de la web (exacta, `https`); la URL de previsualización si se usa; `http://localhost:5173` solo en entornos que no sean producción. Cualquier otro origen → sin cabeceras CORS.

**Cuenta administradora:** `app_role: admin` solo en `app_metadata` (procedimiento de `docs/dev/f11a-supabase-auth.md`); el panel no lo asigna.

### 9.1 Arranques en frío

La primera petición del día recorre navegador → GraphQL (Cloud Run) → Gateway (Render, con espera de arranque) → ESB → servicios (Cloud Run); cada salto puede tardar varios segundos en frío (hay antecedentes de 6–7 s en `createReservation` con dependencias recién arrancadas, `BACKLOG.md`).

**Estado de carga amable (web y móvil):**
- Umbrales por petición: 0–1,5 s esqueleto normal; **>1,5 s** mensaje «Estamos despertando el servicio, puede tardar unos segundos» con indicador de progreso; **>8 s** añade «Sigue intentando» y botón «Reintentar»; **>25 s** error de indisponibilidad con `correlationId`. Los umbrales viven en configuración.
- La **primera consulta** al abrir la app es una consulta ligera (`platformHealth` o `viewer`) en segundo plano para despertar la cadena mientras el usuario escribe su búsqueda; la pantalla de Inicio es utilizable sin ella (el formulario no depende de datos remotos).
- Reintentos automáticos solo para lecturas (`searchFlights`, `seatMap`, `myBookings`…) con retroceso exponencial (máx. 3) ante `UNAVAILABLE`/`PROVIDER_UNAVAILABLE`/tiempo agotado; **las mutaciones nunca se reintentan solas**: se ofrece «Reintentar» con la misma `Idempotency-Key` (§3.0).
- El botón de pago y de cancelación muestran el progreso y se bloquean; si la espera supera el umbral, el texto aclara que **no debe pagar de nuevo** y que se verificará el estado de la reserva antes de ofrecer reintentar.
- El mismo componente `LoadingState` (en `packages` de UI web; equivalente en móvil) sirve a todas las pantallas.

**Precalentamiento.** El servicio GraphQL se añade al precalentamiento existente (`docs/dev/f11c-scheduler-render.md`, `docs/dev/f12b1-despliegue-esb.md` §5): `GET /health` del servicio GraphQL, seguido de una consulta `platformHealth` (despierta Gateway, ESB y servicios) y una `searchFlights` de prueba con reintentos ante 503 (despierta Pricing e Inventory), antes de una sesión de prueba o demostración. Entra en el script de precalentamiento y en el recorrido de humo (B-6, §14).

---

## 10. Estrategia de pruebas

Se respeta AGENTS.md: CI = lint, build, `npm audit --audit-level=high` y pruebas unitarias; integración y extremo a extremo se ejecutan en local y en la auditoría; verificación de compilación e imagen Docker **en clon limpio**; `npm run build` (tsc) de cada workspace tocado.

### 10.1 F12c-1 — servicio GraphQL

| Tipo | Qué se prueba |
|---|---|
| Unitarias (CI) | Cada resolver con el Gateway simulado: mapeo de campos (§6.2), `MoneyAmount`→`Money`, `Outcome` por 200/201/202, paginación (`nextCursor`→`pageInfo`), enmascarado de documento |
| Errores (CI) | Tabla completa de §6.3: cada `code` del enum de `ProblemDetails` v2 con su HTTP produce `category`, `extensions.code` y mensaje esperados; 401 (`UNAUTHORIZED`) → `UNAUTHENTICATED`, 403 → `FORBIDDEN`, y 401/403 con `VALIDATION_FAILED` → por HTTP; 503 con `Retry-After`; código desconocido; cuerpo no JSON |
| Dueño y pago (CI) | El servicio **no filtra por propietario** y delega: con el Gateway simulado, un 404 de recurso ajeno llega como `NOT_FOUND` sin detalle; el `Idempotency-Key` se reenvía; ninguna operación del cliente envía `paymentChannel`, `provider` ni `X-User-Id` (los fija el Gateway) |
| Autenticación/rol (CI) | Sin token → `UNAUTHENTICATED` sin llamar al Gateway; `customer` en operación `@admin` → `FORBIDDEN` **y el Gateway simulado no recibe llamada**; token con firma inválida/`alg: none`/`HS256`/`iss` o `aud` incorrectos |
| Trazabilidad (CI) | El `X-Correlation-Id` entrante llega **idéntico** al Gateway y vuelve en la respuesta y en `extensions`; ausente → se genera; >100 caracteres o inseguro → se reemplaza; `X-Device-Fingerprint` e `Idempotency-Key` se reenvían |
| Seguridad (CI) | Consulta que excede profundidad/complejidad/alias → rechazada; documento de más de 100 kB → rechazado; introspección **desactivada en producción** y activa en local; operación fuera de la lista (si Q6) → rechazada; CORS: origen permitido/ajeno/sin origen; sin stack trace en errores forzados; **logs**: se capturan y se afirma que no contienen token, `variables`, `documentNumber`, correo, teléfono, nombres ni `paymentReference` |
| Contrato del esquema (CI) | El SDL compila; el codegen no produce cambios pendientes; toda operación de `graphql-schema` valida contra el SDL; ningún tipo de salida expone campos no listados |
| Integración local (humano/auditor) | Contra Gateway y servicios locales (`docs/dev/f12b2-diseno-bus.md`/integración local) con tokens de desarrollo (`npm run dev:token`): compra completa, recurso ajeno ⇒ 404, `admin` vs `customer`. **S-1 a S-6** de §5.4 con tokens reales de Supabase (los ejecuta el humano; no se leen `.env`) |
| Contenedor | Imagen construida en clon limpio, ejecutada con `PORT=8080`, `/health` responde |

### 10.2 F12c-2 — app web del cliente

| Tipo | Qué se prueba |
|---|---|
| Unitarias (CI) | `format`: horas locales con cambio de horario, Lima/Galápagos/Madrid, «+1 día», aeropuerto sin zona; dinero sin flotantes; reglas de check-in (borde 48 h y 60 min en hora local); validación de pasajeros (internacional→pasaporte, documento vencido, infante sin adulto); mapeo `category/code` → mensaje y acción; `session` con almacenamiento simulado |
| Componentes (CI) | Vitest + Testing Library con GraphQL simulado: cada pantalla V1 en sus cuatro estados (cargando/vacío/error/éxito); mapa de asientos (estados, teclado, `aria-label`); temporizador del hold (vencimiento → 410); doble clic de pago no duplica la mutación (misma `Idempotency-Key`); `returnTo` solo acepta rutas internas |
| Accesibilidad (CI) | axe sin infracciones graves en cada pantalla; contraste de tokens (primario/acento ≥ 4,5:1); tamaño mínimo 12 px |
| Marca (CI) | Falla si en `platform/web/src` aparece un color literal, una ruta de imagen o la cadena de marca fuera de `packages/brand` y `design-tokens` (garantiza §2.3) |
| Seguridad (CI) | Sin `dangerouslySetInnerHTML`; el bundle no contiene claves distintas de la `anon`; el documento completo no se escribe en `localStorage` |
| Extremo a extremo (local/auditoría) | Playwright contra la plataforma local: búsqueda → hold → pasajeros → pago simulado → confirmación; mis reservas; postventa (equipaje, cancelación con cotización); check-in dentro y fuera de ventana; sesión expirada; hold vencido |
| Arranque en frío (CI) | Con un Gateway simulado lento: aparecen los mensajes a 1,5 s, 8 s y 25 s; las lecturas se reintentan y las mutaciones no; el botón de pago no se duplica |
| Clon limpio | `npm ci` + build de Vite; el bundle sirve y cumple CSP |

### 10.3 F12c-3 — panel de administrador

| Tipo | Qué se prueba |
|---|---|
| Componentes (CI) | Guardia de ruta: `customer`/anónimo en `/admin/*` → «Sin permiso»/acceso; `admin` ve el menú; el chunk de administración no se carga para un cliente; estados de cada pantalla; formulario de estado: transiciones inválidas y confirmación explícita de cancelación; tarifas y promociones con validación (0–100) |
| Seguridad (CI + local) | Un `customer` real que invoque directamente una operación `@admin` recibe `FORBIDDEN` (servicio) y 403 (Gateway, probado además llamando al Gateway); no se muestran reservas ajenas |
| Extremo a extremo (local/auditoría) | Admin cambia el estado/puerta de un vuelo → el estado público lo refleja; cancelar vuelo cierra la venta y afecta reservas (comprobado en datos de prueba); tarifa nueva aparece en la búsqueda; acuerdo de promociones guardado y releído; salud con un servicio detenido → `DEGRADED` |
| Humano | Con un token **real** de Supabase con rol admin: S-2, S-6 y el recorrido completo contra producción (comandos contra Supabase solo los ejecuta el humano) |

---

## 11. «Buscar mi reserva» sin iniciar sesión — **propuesta** (al final de la fase, tras hablar con Booking)

**Objetivo.** Que una persona que compró por cualquier canal (incluido Booking) consulte su reserva sin cuenta.

**Forma propuesta.** Pantalla pública «Buscar mi reserva» con: código de reserva (PNR) **+ apellido + número de documento** (o, para reservas de Booking, el código de reserva de Booking). Resultado: vista de **solo lectura y reducida** (ruta, fechas, estado, boletos enmascarados); acciones sensibles (cancelar, cambiar, check-in) exigen un segundo factor (p. ej. código por correo) o iniciar sesión.

**Por qué no se puede hacer hoy.** Todos los accesos a recursos son por dueño (`ownerId` = `sub` o `<clientId>~<X-User-Id>`); el diseño de seguridad devuelve 404 a lo ajeno. Una búsqueda por PNR + datos del pasajero es **una excepción a esa regla** y necesita un endpoint nuevo en el backend (público, con límite estricto) y decisión sobre el contrato.

**Riesgos.**
| Riesgo | Mitigación a discutir |
|---|---|
| Enumeración de reservas (PNR de pocos caracteres) | Límite de intentos por IP y por PNR, bloqueo progresivo, CAPTCHA, respuesta idéntica y de tiempo constante ante «no existe» y «datos no coinciden» |
| Exposición de datos personales (nombre, documento, itinerario) | Respuesta mínima, documento enmascarado, sin correo ni teléfono; no registrar los datos de la búsqueda; HTTPS; sin caché |
| Suplantación (quien conoce el PNR y el apellido) | Documento como segundo dato; acciones de cambio solo con verificación adicional |
| Fuga entre canales | Distinguir reservas propias de las de socio; Booking es el dueño de su cliente |
| Abuso como oráculo (validar documentos) | Mismo mensaje en todos los fallos; límite global |

**Preguntas para Booking.**
1. ¿Qué identificador tiene el cliente final de una reserva hecha en Booking: nuestro PNR, el código de reserva de Booking o ambos? ¿Se muestra al cliente el PNR de la aerolínea?
2. ¿Booking permite que la aerolínea consulte/verifique el código de reserva de Booking (endpoint o webhook) para validar «código de Booking + apellido»?
3. ¿Debe la aerolínea mostrar reservas de Booking al cliente directamente, o Booking prefiere que la gestión de esas reservas ocurra solo en Booking (la aerolínea no expone nada)?
4. ¿Qué acciones se permiten al cliente sobre una reserva de Booking desde el sitio de la aerolínea (solo ver, check-in, cancelar)? ¿La cancelación/reembolso debe ir siempre por Booking?
5. ¿Qué datos personales puede mostrar la aerolínea y cuáles no (documento, contacto)? ¿Hay requisito legal/contractual sobre protección de datos entre Booking y la aerolínea?
6. ¿Booking aplica ya límites o verificación (correo/OTP) que podamos reutilizar?
7. Para reservas de Booking, ¿qué debe ocurrir con los eventos (`booking.cancelled`, `booking.checked_in`) si el cliente actúa desde el sitio de la aerolínea?

**Relación con «Mis reservas».** Quien compró por un socio no ve esa reserva en su lista (otro dueño, H-18); el aviso de «Mis reservas» («gestiona tu reserva con quien te la vendió») enlaza a esta pantalla cuando exista.

**Alcance en F12c.** Solo esta descripción. No hay pantalla, esquema GraphQL ni endpoint hasta cerrar las preguntas.

---

## 12. Decisiones del humano y preguntas que siguen abiertas

| # | Tema | Estado |
|---|---|---|
| Q1 | ADR | **Hecho:** `ADR-F12c-01-pago-booking-cubre-tarifa` → `ADR-F12b2fix-02-pago-booking-cubre-tarifa` (referencias vivas actualizadas en `BACKLOG.md`; `docs/booking-integration.md` no lo citaba). Este ADR: `ADR-F12c-01-front-graphql-react`. Informes de auditoría y bitácoras cerradas no se tocan; `docs/dev/f12a-despliegue.md:54` y los comentarios de código (`booking-payments.ts`, su prueba) aún dicen `ADR-F12c-01` en el sentido antiguo (histórico/código; se corrigen en una entrega con código) |
| Q2 | v2 para el cliente | **Reemplazada por el cambio de fondo:** el cliente usa **solo v2** (v1 deprecado) |
| Q3 | Admin V1 | Solo lista de vuelos y cambio de estado; crear y cerrar, después |
| Q4 | Marca provisional | Aceptada |
| Q5 | Cliente GraphQL y servidor | Se decide en F12c-1. Criterios: el cliente funciona igual en React Native; licencias permisivas; `npm audit` sin altas ni críticas; el SDL es el contrato |
| Q6 | Operaciones conocidas | Solo operaciones conocidas en producción (libres en local y CI) |
| Q7 | Multidestino | Ida, ida y vuelta y multidestino en V1 |
| Q8 | Alojamiento de la web | Render Static |
| Q9 | Puerta y bus | H-6 (puerta) y H-8 (salud del bus) fuera de F12c; **BACKLOG con prioridad alta** (hecho en `BACKLOG.md`) |
| Q10 | Pago | Simulado, único método, rotulado de prueba; en v2 depende del canal propio B-1 |
| **Abiertas** | | |
| Q11 | B-1: ¿se aprueba el canal `WEB` con `WEB_PAYMENT_MODE=simulated` y sus topes por usuario? | Recomendado; entrega previa (§14) |
| Q12 | B-2: ¿prefijo `/api/admin/v1` y OpenAPI interno `contracts/openapi/internal/admin-openapi.yaml`? | Recomendado; entrega previa (§14) |
| Q13 | ¿`docs/dev/f12a-despliegue.md` y los comentarios de código con el nombre antiguo del ADR se corrigen en la entrega de backend? | Sí |

---

## 13. Trazabilidad con el encargo

| Entregable pedido | Dónde |
|---|---|
| 1 Pantallas V1 | §3 |
| 2 Recorridos | §4 |
| 3 Datos ↔ Gateway (v2), dueño, pago, admin, huecos | §5 |
| 4 SDL, errores (v2), paginación, correlationId | §6 |
| 5 Reglas transversales | §7 |
| 6 Estructura del monorepo | §8 |
| 7 Despliegue, variables públicas, CORS, arranque en frío | §9 |
| 8 Estrategia de pruebas | §10 |
| 9 ADR | `docs/dev/adr/ADR-F12c-01-front-graphql-react.md` |
| Plantilla, marca provisional | §1, §2 |
| «Buscar mi reserva» | §11 |
| Cambios de backend previos a F12c-1 | §14 |

---

## 14. Cambios de BACKEND que el front necesita antes de F12c-1 (entrega previa a planificar)

Se deciden y se construyen **aparte** (con su ADR, pruebas y auditoría). Ninguno modifica los contratos OpenAPI v1 ni v2 vigentes.

### Bloqueantes

| # | Cambio | Dónde | Detalle y riesgo |
|---|---|---|---|
| **B-1** | **Canal de pago propio de la web** (`WEB`, pago simulado rotulado de prueba) | Gateway (`v2/booking.controller.ts`, `v2/postsale.controller.ts`): canal por rol (`partner` → `BOOKING`, `customer`/`admin` → `WEB`); `deferIssuanceFailure` para todos. Reservation (`main.ts`, `routing-payment-verifier.ts`): verificador `WEB` con `WEB_PAYMENT_MODE=simulated`. Eventos de emisión para todos los canales v2 | §5.1.2. Riesgo: boletos gratuitos por diseño, abuso de inventario/stock; mitigaciones y prueba S-5 en §5.1.2. Regresión del camino de Booking cubierta por las pruebas de pagos existentes |
| **B-2** | **API interna de administración** separada del contrato v2 | Gateway: prefijo propio, OpenAPI interno, solo `admin` + `flights:admin`, re-monta `AdminController` | §5.5. Riesgo bajo; hay que retirar la superficie v1 admin sin duplicar autorizaciones |

### Recomendados antes de F12c-1 (no bloquean el diseño)

| # | Cambio | Detalle |
|---|---|---|
| B-3 | **Topes por usuario del canal `WEB`** (holds vigentes y reservas `PENDING` por `sub`) | Mitiga el abuso de B-1; en el Gateway o Reservation |
| B-4 | Puerta de embarque en `GET /vuelos/flights/{n}/status` y en los pases (H-6) | BACKLOG, prioridad alta; Operations ya guarda `departure_gate`; el contrato v2 ya declara `gate` |
| B-5 | Salud del bus de eventos en `GET /vuelos/health` o en un endpoint de administración (H-8) | BACKLOG, prioridad alta; el ESB ya informa el bus en `/health/deps` |
| B-6 | Precalentamiento: agregar el servicio GraphQL (y su `GET /health`) al script de precalentamiento (`docs/dev/f11c-scheduler-render.md`, `f12b1-despliegue-esb.md` §5) | Operación, no código de negocio |
| B-7 | Comprobar con tokens reales S-1…S-6 (§5.4) | Humano/auditor; si S-1 falla, corregir antes de F12c-1 |

Orden sugerido: B-2 y B-1 (con B-3) → B-7 (S-1, S-2, S-5, S-6) → F12c-1. B-4 y B-5 pueden entrar en paralelo o después sin bloquear.
