# F11a: configuración de Supabase Auth

1. En Authentication → Providers habilita Email y contraseña. Configura confirmación de correo según el entorno de prueba.
2. En Authentication → URL Configuration define la Site URL y agrega las URLs exactas de redirección del cliente. El cliente debe usar Authorization Code + PKCE (`flowType: 'pkce'`); PKCE se configura en el cliente, no en el Gateway.
3. En SQL Editor ejecuta [f11a-supabase-auth-hook.sql](f11a-supabase-auth-hook.sql). En Authentication → Hooks habilita Custom Access Token y selecciona `public.flight_platform_access_token_hook`.
4. En Authentication → Users crea dos usuarios de prueba con correo y contraseña. El usuario normal recibe `customer` automáticamente. Para el administrador, asigna `app_role: admin` en **app_metadata** mediante una operación administrativa confiable; nunca en user metadata. Renueva la sesión después de cambiar el rol.
5. Usa una clave JWT asimétrica activa (RS256 o ES256). Configura en Render `JWT_ISSUERS` como un arreglo JSON con `iss` igual a `https://<project-ref>.supabase.co/auth/v1`, `aud` igual al audience real del token (normalmente `authenticated`) y `jwksUri` igual a `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`. Conserva otros emisores autorizados. El endpoint JWKS no publica una clave para tokens HS256 heredados.
6. Ejecuta la verificación opt-in cuando estén disponibles las rutas de reservas y administración, con `BASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_TEST_EMAIL` y `SUPABASE_TEST_PASSWORD` en el entorno: `node platform/api-gateway/scripts/supabase-auth-smoke.cjs`. No comparte ni imprime la contraseña o el token.

El hook conserva los claims de Supabase y solo concede `admin` desde `app_metadata`; otros valores reciben `customer`. Los tokens ya emitidos conservan sus claims hasta renovarse. El emisor B2B de desarrollo utiliza llaves locales y debe excluirse de producción.

Para B2B local, agrega a `JWT_ISSUERS` una entrada con `iss: flight-platform-partner-dev`, `aud: flight-platform` y `publicKeyFile` apuntando a la llave pública local. Genera el token con `npm run dev:token -- --iss flight-platform-partner-dev --sub <client-id> --app-role partner --scope "flights:read flights:hold flights:book flights:cancel flights:webhooks"`. Este token simula el resultado de client credentials: no existe un servidor OAuth de B2B en esta entrega. El Gateway rechaza `publicKeyFile` en producción.

Referencias: [Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks), [verificación de JWT](https://supabase.com/docs/guides/auth/jwts), [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
