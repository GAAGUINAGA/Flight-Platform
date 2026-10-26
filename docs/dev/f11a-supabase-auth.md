# F11a: configuración de Supabase Auth

1. En Authentication → Providers habilita Email y contraseña. Configura confirmación de correo según el entorno de prueba.
2. En Authentication → URL Configuration define la Site URL y agrega las URLs exactas de redirección del cliente. El cliente debe usar Authorization Code + PKCE (`flowType: 'pkce'`); PKCE se configura en el cliente, no en el Gateway.
3. En SQL Editor ejecuta [f11a-supabase-auth-hook.sql](f11a-supabase-auth-hook.sql). En Authentication → Hooks habilita Custom Access Token y selecciona `public.flight_platform_access_token_hook`.
4. En Authentication → Users crea dos usuarios de prueba con correo y contraseña. El usuario normal recibe `customer` automáticamente. Para el administrador, asigna `app_role: admin` en **app_metadata** mediante una operación administrativa confiable; nunca en user metadata. Renueva la sesión después de cambiar el rol.
5. Usa una clave JWT asimétrica activa (RS256 o ES256). Configura en Render `JWT_ISSUERS` como un arreglo JSON con `iss` igual a `https://<project-ref>.supabase.co/auth/v1`, `aud` igual al audience real del token (normalmente `authenticated`) y `jwksUri` igual a `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`. Conserva otros emisores autorizados. El endpoint JWKS no publica una clave para tokens HS256 heredados.
6. Ejecuta la verificación opt-in cuando estén disponibles las rutas de reservas y administración, con `BASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_TEST_EMAIL` y `SUPABASE_TEST_PASSWORD` en el entorno: `node platform/api-gateway/scripts/supabase-auth-smoke.cjs`. No comparte ni imprime la contraseña o el token.

### Cuenta partner (integración de Booking)

Booking se integra con una cuenta **partner** de Supabase: es el único rol que gestiona webhooks y, a la vez, crea holds y reservas propios. Los eventos de webhooks se entregan solo a suscripciones del mismo dueño (`sub`) que creó el recurso, por lo que el hold, la reserva y la suscripción deben hacerse con la misma cuenta. Un `customer` no puede suscribirse y un `admin` solo recibe los eventos de sus propios recursos.

1. Ejecuta de nuevo [f11a-supabase-auth-hook.sql](f11a-supabase-auth-hook.sql) en el SQL Editor (el hook reconoce `partner`).
2. En Authentication → Users crea el usuario con correo y contraseña.
3. Asigna `app_role: partner` en **app_metadata** (editar el usuario en el panel o `auth.admin.updateUserById(id, { app_metadata: { app_role: 'partner' } })` con la clave de servicio, nunca desde el cliente). Nunca en user metadata.
4. Renueva la sesión: el token trae `app_role = partner` y los scopes `flights:read flights:hold flights:book flights:cancel flights:webhooks` (sin `flights:admin`; `/admin` responde 403).

El hook conserva los claims de Supabase y solo concede `admin` o `partner` desde `app_metadata`; otros valores reciben `customer`. Los tokens ya emitidos conservan sus claims hasta renovarse. El emisor B2B de desarrollo utiliza llaves locales y debe excluirse de producción.

Para B2B local, agrega a `JWT_ISSUERS` una entrada con `iss: flight-platform-partner-dev`, `aud: flight-platform` y `publicKeyFile` apuntando a la llave pública local. Genera el token con `npm run dev:token -- --iss flight-platform-partner-dev --sub <client-id> --app-role partner --scope "flights:read flights:hold flights:book flights:cancel flights:webhooks"`. Este token simula el resultado de client credentials: no existe un servidor OAuth de B2B en esta entrega. El Gateway rechaza `publicKeyFile` en producción.

Referencias: [Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks), [verificación de JWT](https://supabase.com/docs/guides/auth/jwts), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
