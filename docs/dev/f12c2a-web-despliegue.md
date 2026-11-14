# F12c-2a — Despliegue de la web (sitio estático en Render)

App: `platform/web` (React + Vite + TypeScript). Habla **solo** con el servicio GraphQL (`platform/graphql`, Cloud Run) y con Supabase Auth; nunca con el Gateway. Decisiones: `docs/dev/adr/ADR-F12c2a-01-web-base.md` y `ADR-F12c2a-02-auth-local-de-pruebas.md`. Configuración versionada: `render.yaml` (raíz).

**Nada de esto se ejecuta solo.** Los pasos de esta guía los hace el humano, después de la auditoría de código y con la rama fusionada en `main`.

## 1. Variables públicas (se incrustan en el bundle: no hay secretos)

| Variable | Obligatoria | Contenido |
|---|---|---|
| `VITE_GRAPHQL_URL` | sí | URL completa del servicio GraphQL, terminada en `/graphql` |
| `VITE_SUPABASE_URL` | sí | URL del proyecto de Supabase (sin `/auth/v1`) |
| `VITE_SUPABASE_ANON_KEY` | sí | Llave `anon` de Supabase (pública por diseño). **Nunca** la `service_role` |
| `VITE_ENV_NAME` | no | `produccion`, `pruebas` (por omisión) o `local`. Distinto de `produccion` muestra la banda «Entorno de pruebas» |
| `VITE_LOADING_SLOW_MS`, `VITE_LOADING_VERY_SLOW_MS`, `VITE_REQUEST_TIMEOUT_MS` | no | Umbrales del estado de carga (1500 / 8000) y tiempo máximo por operación (25000) |

La construcción **falla** si falta alguna de las tres obligatorias (así no se publica un sitio que no puede conectarse). Plantilla: `platform/web/.env.example`.

## 2. Antes de crear el sitio: comprobar `render.yaml`

`render.yaml` fija el comando de construcción (`npm ci && npm run build -w @flight-platform/web`), la carpeta publicada (`platform/web/dist`), la reescritura de todas las rutas a `/index.html` y las cabeceras de seguridad. Dos valores son URLs reales y deben revisarse:

1. `VITE_GRAPHQL_URL` y el primer origen de `connect-src`: **verificar la URL del servicio GraphQL**. El valor versionado se dedujo del patrón de Cloud Run del proyecto (el mismo sufijo que `esb-service`), no de una consulta al servicio:
   ```powershell
   gcloud run services describe graphql-service --region us-east1 --format "value(status.url)"
   ```
   Si difiere, cambiarla en `render.yaml` en **los dos** lugares (variable y `connect-src`) y ejecutar `npm test -w @flight-platform/web` (la prueba `DEP-03/04` falla si no coinciden).
2. `VITE_SUPABASE_URL` y el segundo origen de `connect-src`: es el proyecto de `docs/dev/f11a-supabase-auth.md`.

`connect-src` admite solo esos dos orígenes. El `index.html` construido lleva además la misma política en una etiqueta `<meta>` generada con las URLs reales de las variables.

## 3. Crear el sitio en Render

Opción A (recomendada), **Blueprint**: Render → *New* → *Blueprint* → este repositorio, rama `main`. Crea solo el servicio `flight-web` (el Gateway no figura en el archivo y no se toca). Render pide el valor de `VITE_SUPABASE_ANON_KEY` (está marcada `sync: false`): pegar la llave `anon` de Supabase → *Project Settings* → *API*.

Opción B, a mano: *New* → *Static Site* → repositorio y rama `main`, y copiar de `render.yaml`: *Build Command*, *Publish Directory*, las variables de entorno (`NODE_VERSION`, `VITE_*`), en *Redirects/Rewrites* la regla `/*` → `/index.html` (**Rewrite**), y en *Headers* cada cabecera con su ruta.

El despliegue automático está desactivado (`autoDeploy: false`): cada publicación se lanza a mano (*Manual Deploy*), tras la auditoría (AGENTS: despliegue solo desde `main`).

Anotar la URL pública del sitio, por ejemplo `https://flight-web.onrender.com`. En adelante, `<URL-WEB>` (sin barra final).

## 4. Abrir CORS del servicio GraphQL a la web

Hasta ahora `CORS_ORIGINS` del servicio GraphQL tiene un origen inexistente (CORS cerrado). Cambiarlo por el origen exacto de la web (https, sin barra final, sin comodines):

```powershell
gcloud run services update graphql-service --region us-east1 --update-env-vars "CORS_ORIGINS=<URL-WEB>"
```

Comprobar: una petición con `Origin: <URL-WEB>` recibe `Access-Control-Allow-Origin: <URL-WEB>`; con otro origen, no recibe la cabecera. El Gateway **no** necesita la URL de la web en su CORS (la web no lo llama).

## 5. Supabase: URLs de redirección

Supabase → *Authentication* → *URL Configuration*:
- **Site URL**: `<URL-WEB>`.
- **Redirect URLs**: agregar `<URL-WEB>/acceso/retorno` (retorno del enlace de confirmación de correo y de recuperación de contraseña; la app canjea el código con PKCE). Para probar en local con el Supabase real, agregar también `http://localhost:5173/acceso/retorno`.

Las plantillas de correo deben usar `{{ .ConfirmationURL }}` (por omisión). El enlace debe abrirse en el mismo navegador donde se pidió (el verificador PKCE vive en ese navegador).

## 6. Verificación después de publicar

1. `<URL-WEB>/` carga; `<URL-WEB>/estado` y una ruta cualquiera (`/abc`) responden 200 con la app (reescritura) y la segunda muestra «No encontramos esa página».
2. Cabeceras: `curl -sI <URL-WEB>/ ` muestra `content-security-policy`, `strict-transport-security`, `x-content-type-options: nosniff`, `referrer-policy` y `x-frame-options: DENY`.
3. En el navegador, sin errores de CSP en la consola; una búsqueda devuelve ofertas y «Estado de un vuelo» responde. La primera petición del día puede tardar (arranque en frío): la app lo avisa a los 1,5 s y a los 8 s.
4. Registro, confirmación por correo, inicio de sesión y recuperación de contraseña con una cuenta de prueba.
5. La banda «Entorno de pruebas» aparece mientras `VITE_ENV_NAME` no sea `produccion`.

## 7. Local

```powershell
npm run local:up -- -SkipDocker -Web    # plataforma + servicio de acceso local de pruebas + la web en http://localhost:5173
npm run test:e2e -w @flight-platform/web # Playwright contra esa plataforma (usa Edge/Chrome instalados)
npm run local:down                       # detiene todo, incluida la web
```

Con `-Web`, `local:up` construye la web apuntando al GraphQL local (`http://127.0.0.1:4000/graphql`) y a un **servicio de acceso local de pruebas** (`scripts/local-platform/local-auth.cjs`, puerto 54329) que imita lo mínimo de Supabase Auth con usuarios en memoria; no hace falta ninguna variable ni cuenta real. Ese servicio solo arranca fuera de producción, escucha en 127.0.0.1 y firma con una llave generada en `.local/` (ignorada por git). Detalle: ADR-F12c2a-02.

Para desarrollar con recarga: copiar `platform/web/.env.example` a `platform/web/.env.local`, completar los valores y `npm run dev -w @flight-platform/web`.

## 8. Reemplazar la marca

La marca es provisional. Guía: `docs/dev/f12c0-diseno-front.md` §2.3. Archivos: `packages/design-tokens/src/tokens.ts`, `packages/brand/src/brand.config.ts` y `packages/brand/assets/**` (créditos de las fotografías en `assets/photos/CREDITS.md`). Ninguna pantalla.
