# ADR-F12c2a-02 — Servicio de acceso local de pruebas para la web (`local:up -Web`)
- Estado: Aceptado · Fecha: 2026-11-13 · Fase/Tarea: F12c-2a (plataforma local y e2e)

## Contexto
El encargo pide que `local:up` levante la web «apuntando al GraphQL local, sin variables manuales» y un e2e que se registre e inicie sesión «con un usuario de prueba local». La sesión de la web es Supabase Auth, y en local no hay Supabase: usar el proyecto real exigiría su llave en un `.env` (no se leen), correos reales y dejaría usuarios de prueba en producción. Los tokens de desarrollo (`npm run dev:token`) no sirven: la web no puede firmar tokens.

## Decisión
1. `scripts/local-platform/local-auth.cjs`: un servicio HTTP mínimo, sin dependencias, que imita **solo** las rutas de Supabase Auth (GoTrue) que usa `@flight-platform/session`: `signup`, `token` (password, refresh_token, pkce), `recover`, `user` (GET/PUT) y `logout`. Usuarios **en memoria** (se pierden al detenerlo), contraseñas con scrypt, correo confirmado al registrarse y un «buzón» local (`GET /local/mailbox`) que devuelve el enlace de recuperación en lugar de enviar un correo.
2. Firma tokens RS256 con un par generado en `.local/` (ignorado por git; la privada no se imprime). `local:up -Web` pasa la llave **pública** al Gateway (`JWT_ISSUERS_EXTRA`, que ya exige `INTEGRATION_LOCAL=true` y está prohibido en producción) y al servicio GraphQL (`JWT_ISSUERS` con `publicKeyFile`, que su configuración rechaza en producción). Los tokens llevan `app_role: customer` y los scopes de cliente.
3. Límites: no arranca con `NODE_ENV=production`, escucha solo en 127.0.0.1, CORS solo para la web local, cuerpo máximo 10 kB, tope de usuarios, y no registra correos, contraseñas ni tokens. Solo genera enlaces de recuperación hacia la web local.
4. `local:up -Web` (opciones `-WebPort` 5173 y `-WebAuthPort` 54329) construye la web con sus variables públicas locales, arranca el servicio de acceso y sirve el sitio con `vite preview` (mismas cabeceras de seguridad que Render); `local:down` detiene ambos. Sin `-Web`, `local:up` se comporta como antes.

## Consecuencias
- El e2e (Playwright) cubre registro, inicio y cierre de sesión, recuperación con PKCE y comprueba que el token es aceptado por GraphQL y por el Gateway, sin tocar Supabase.
- Lo que **no** cubre: el comportamiento real de Supabase (confirmación por correo, límites de envío, plantillas, hook de `app_role`). Eso sigue siendo verificación del humano con el proyecto real (guía de despliegue §6) y las pruebas S-1 a S-6.
- La imitación debe seguir a `@flight-platform/session`: `scripts/local-platform/local-auth.spec.ts` ejecuta el cliente de sesión real contra ella (CI).
- No hay rol `admin` local por este servicio; el panel (F12c-3) decidirá cómo probarlo.
