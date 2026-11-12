# F12c — Pruebas con usuarios reales S-1 a S-6

Script: `platform/api-gateway/scripts/f12c-pruebas-reales.cjs` (Node 20, sin dependencias). Lo ejecuta **el humano contra la nube**, con tokens reales, antes de empezar F12c-1.
Comprueba, solo con **v2** (`/api/v2/vuelos/*`) y la **API interna** (`/api/admin/v1/*`), todo lo que el servicio GraphQL va a usar (diseño: `docs/dev/f12c0-diseno-front.md` §5.4 y §14). v1 está deprecado y no se llama.
No modifica código de la plataforma, contratos ni workflows.

## 1. Variables de entorno

| Variable | Obligatoria | Qué es |
|---|---|---|
| `BASE_URL` | sí (nube) | URL del Gateway, sin `/api`, p. ej. `https://<gateway>.onrender.com` |
| `CUSTOMER_A_TOKEN` | sí | JWT de Supabase de un usuario `customer` con el **correo confirmado** (el cliente «A»: hace el recorrido) |
| `CUSTOMER_B_TOKEN` | sí | JWT de **otro** usuario `customer`, también con el correo confirmado (el «B»: intruso y prueba de topes) |
| `ADMIN_TOKEN` | sí | JWT de Supabase de un usuario con `app_role = admin` |
| `PARTNER_CLIENT_ID`, `PARTNER_CLIENT_SECRET` | no | Cliente `client_credentials` de **prueba** del dev-auth (no el de Booking). Sin ellos se saltan las comprobaciones del socio y el resumen lo dice (N/A) |
| `ADMIN_PATCH_FLIGHT` | no | `<vuelo>:<AAAA-MM-DD>` de un vuelo **de prueba** en `SCHEDULED`: PATCH real y reversible (hora estimada +30 min, que se devuelve). Sin él, el PATCH solo se comprueba en modo lectura |
| `CAP_PROBE_MAX` | no | Reservas máximas que intenta B para encontrar el tope del canal WEB (8) |
| `RATE_LIMIT_MAX` | no | Peticiones máximas por prueba de límite (130) |
| `SKIP_CAPS=1`, `SKIP_RATE_LIMIT=1`, `SKIP_PENDING=1` | no | Omiten la prueba de topes, la de límite de peticiones o la del pago pendiente (que deja una reserva `PENDING_PAYMENT` no cancelable) |

```powershell
node platform/api-gateway/scripts/f12c-pruebas-reales.cjs
```

Salida: una línea `OK`, `FALLA` o `N/A` por comprobación (con la etiqueta S-1…S-6), el resumen por prueba y la limpieza. Código de salida 0 solo si no hay `FALLA` y la limpieza fue completa. **Nunca imprime** tokens, secretos, correos, documentos ni la referencia de pago.

## 2. Cómo obtener cada token sin escribirlo en el historial

Los tokens de Supabase duran 1 hora: obténgalos justo antes de ejecutar. No los pegue en la línea de comandos (quedaría en el historial de PowerShell): léalos en variables de la sesión.

```powershell
# Solo la URL del proyecto y la clave anónima (pública). La contraseña se pide sin eco y no se guarda.
$env:SUPABASE_URL = 'https://<proyecto>.supabase.co'; $env:SUPABASE_ANON_KEY = '<anon key pública>'
function Get-SupabaseToken([string]$Email) {
  $password = Read-Host "Contraseña de $Email" -AsSecureString
  $plain = [System.Net.NetworkCredential]::new('', $password).Password
  $body = @{ email = $Email; password = $plain } | ConvertTo-Json
  $r = Invoke-RestMethod -Method Post -Uri "$($env:SUPABASE_URL)/auth/v1/token?grant_type=password" -Headers @{ apikey = $env:SUPABASE_ANON_KEY } -ContentType 'application/json' -Body $body
  $plain = $null; return $r.access_token
}
$env:CUSTOMER_A_TOKEN = Get-SupabaseToken 'cliente.a@...'
$env:CUSTOMER_B_TOKEN = Get-SupabaseToken 'cliente.b@...'
$env:ADMIN_TOKEN      = Get-SupabaseToken 'admin@...'
Set-PSReadLineOption -HistorySaveStyle SaveNothing   # opcional: no guarda esta sesión en el historial
```

- Los usuarios A y B deben ser **distintos** y tener el correo **confirmado**: el claim `email_verified` lo agrega el hook de Supabase; sin él el canal WEB responde `403 email-not-verified` y el script lo muestra.
- `ADMIN_TOKEN` debe traer `app_role = admin` y los scopes del hook (`flights:admin`…).
- El socio de prueba (opcional): créelo con el CLI del dev-auth contra la nube (lo ejecuta el humano, `npx --yes @dotenvx/dotenvx run -f .env.supabase -- npm run dev-auth:client -- create --client-id f12c-prueba --scopes flights:read,flights:hold,flights:book,flights:cancel --out <archivo>` desde `platform/api-gateway`), pase el id y el secreto con variables de sesión del mismo modo y al terminar desactívelo (`disable --client-id f12c-prueba`).
- Al terminar: `Remove-Item Env:CUSTOMER_A_TOKEN, Env:CUSTOMER_B_TOKEN, Env:ADMIN_TOKEN, Env:PARTNER_CLIENT_SECRET, Env:SUPABASE_ANON_KEY`.

## 3. Qué hace con los datos

- **Elige el vuelo solo.** Lee el panel de operaciones (admin) de los próximos 13 días y toma un vuelo `SCHEDULED` que sale en **más de 48 h** con al menos 6 asientos libres; confirma que la búsqueda pública devuelve su oferta. Nunca usa un vuelo de **menos de 48 h** salvo uno completamente vacío (sin asientos retenidos, reservados ni holds: no puede tener reservas de Booking), y solo para el check-in.
- **Crea datos de prueba** con el cliente A: 1 hold con `assignedSeats`, 1 reserva con pago simulado (`pay_ok_*`) con equipaje y cambio de asiento, 1 reserva con `pay_pending_*` (queda `PENDING_PAYMENT`), 1 intento con `pay_denied_*` (no crea reserva) y, **solo si hay un vuelo vacío dentro de las 48 h**, otra reserva para el check-in. Con el cliente B intenta reservas hasta chocar con el tope del canal WEB (por defecto 5 activas). Pasajero ficticio («Prueba Web», documento `F12C0001`, correo `prueba@example.invalid`); no usa datos personales reales. Las reservas del canal WEB quedan marcadas como de prueba (`salesChannel.partnerId = WEB_TEST`) y las ve el administrador en `GET /api/admin/v1/web-bookings`.
- **Cupo diario.** El tope «pasajeros por día» (por defecto 10 por usuario, cuenta las reservas no `FAILED` aunque se cancelen) se consume: A usa 3 por ejecución y B hasta el tope activo (5). Haga como mucho 2 ejecuciones al día con las mismas cuentas, o use `SKIP_CAPS=1`. Un `429 web-passengers-per-day-limit` en el recorrido de A significa cupo agotado, no un error de la plataforma.
- **Límites de peticiones (S-4).** Envía hasta ~61 búsquedas públicas con una huella nueva y hasta ~120 peticiones autenticadas de B hasta recibir `429`; durante ~1 minuto esa huella y B quedan limitados. No ejecute nada más con esas cuentas a la vez.
- **Cubre:** búsqueda con `X-Device-Fingerprint` y eco de `X-Correlation-Id`, mapa con `HELD`, hold con `assignedSeats`, reserva con pago simulado, boletos, mis reservas (lista, filtro por PNR), detalle, equipaje, cambio de asiento, cotización y cancelación, check-in y pases (si hay vuelo en ventana), aislamiento (B y el socio no ven, cambian, cancelan, hacen check-in ni consumen el hold ni la reserva de A: todo debe ser 404/403 y el recurso de A debe quedar intacto), el cliente no puede forzar canal ni publicar como socio, pago y topes del canal WEB, panel de operaciones, PATCH de estado, acuerdo de promociones, API interna y límites de peticiones.
- **No cubre:** cambio de fecha (no está en el alcance de este script; `date-change` queda para F12c-1), el canal WEB con `WEB_PAYMENT_MODE` apagado y el correo sin confirmar (no se pueden provocar desde fuera; los cubren las pruebas e2e `WEB-E2E-02` y `WEB-E2E-06`) y las escrituras de tarifas (`PUT /admin/fares` solo se comprueba como `403` para un cliente).
- **Modo lectura del administrador.** El PATCH de estado se prueba sobre un vuelo inexistente (`ZZ9999`): con admin debe llegar a `404` (autorizado, sin efectos) y con customer `403`. Con `ADMIN_PATCH_FLIGHT` hace un PATCH real y **reversible** (mismo estado `SCHEDULED`, hora estimada +30 min) y la devuelve a la hora programada; nunca pasa a `DELAYED`/`CANCELLED`, porque esas transiciones no se deshacen (`DELAYED → SCHEDULED` es `409 INVALID_STATUS_TRANSITION`). Si el vuelo no admite el cambio reversible (409), no cambia nada y sale N/A. El `PUT` del acuerdo de promociones reescribe el mismo contenido que acaba de leer; si no hay acuerdo (404) no lo crea.

## 4. Cómo se limpia

En un bloque `finally` (también si una comprobación falla a mitad): cancela con cotización todas las reservas que creó (de A, de B y del socio) y libera todos los holds; si el límite de peticiones lo impide, espera el `Retry-After` y reintenta. Imprime `Limpieza: N reservas canceladas, M holds liberados` y lista lo que no pudo limpiar (id de la reserva o del hold).

Excepción conocida: la reserva de **pago pendiente** (`pay_pending_*`, S-5) queda `PENDING_PAYMENT` y la API solo cancela reservas `CONFIRMED` (`409 BOOKING_NOT_CANCELLABLE`); el script lo avisa («Aviso: no se pueden cancelar…») y no lo cuenta como falla de limpieza. Es de prueba (`WEB_TEST`), cuenta 1 pasajero del cupo diario de A, y la resuelve el reintento de pagos de Reservation; con `SKIP_PENDING=1` no se crea. Si el script se interrumpe del todo (corte de red, `Ctrl+C`), los holds vencen solos (TTL 15 min) y las reservas se ven con `GET /api/admin/v1/web-bookings` y se cancelan con el token del dueño.

## 5. Qué significa cada resultado para F12c-1

| Resultado | Qué prueba | Si hay `FALLA` |
|---|---|---|
| **S-1** recorrido, aislamiento, canal por rol | El cliente real completa la compra y la postventa en v2; B y el socio no tocan lo de A; el cliente no fuerza canal | **Bloquea F12c-1**: corregir el Gateway antes de empezar |
| **S-2** admin | `admin` entra al panel de operaciones, PATCH y promociones (no 403); `customer` recibe 403 | Revisar scopes y el hook de Supabase (`flights:admin`) |
| **S-3** `PUT /seats` | El cambio de asiento funciona para una reserva v2 de la misma cuenta | Ocultar la pestaña «Asiento» en el front |
| **S-4** límites | El límite público es por huella y el autenticado por `sub`; otra huella u otro usuario no se ven afectados | Revisar la clave del límite con el humano |
| **S-5** pago y topes | `pay_ok_*` vende, `pay_denied_*` → `PAYMENT_NOT_AUTHORIZED`, `pay_pending_*` → 202, un socio con `pay_ok_*` no vende, el tope del canal WEB responde 429 con tipo propio | Ver B-1/B-3 en el diseño (§5.1.2, §14) |
| **S-6** API interna | `customer`, socio y sin token no entran (403/401); `admin` sí | Corregir B-2 |

`N/A` no es falla: significa que esa comprobación no se pudo aplicar (sin socio, sin vuelo dentro de la ventana de check-in, sin acuerdo de promociones, límite no alcanzado en `CAP_PROBE_MAX`). Cada `N/A` lleva su motivo. Con **0 `FALLA`** y limpieza completa, F12c-1 puede empezar; guarde la salida (no contiene secretos) en la bitácora de la sesión.

## 6. Ensayo contra la plataforma local

`node platform/api-gateway/scripts/f12c-pruebas-reales.cjs --local` usa `http://127.0.0.1:3000` y **fabrica sus propios tokens** con el CLI `infra/scripts/dev-token.ts` (la llave privada nunca se imprime) y un socio `journey-f12c-*` con `dev-auth-client` (solo base local; se borra al terminar). Aborta si la base no es la local.

Los tokens de desarrollo no son de Supabase: el Gateway debe arrancar con el emisor de desarrollo y el canal WEB habilitado, y los tokens de desarrollo no traen `email_verified`. Arranque `local:up` con estas variables en la terminal (los procesos hijos las heredan; no se tocan `.env` ni el perfil):

```powershell
$env:WEB_PAYMENT_MODE = 'simulated'; $env:WEB_REQUIRE_VERIFIED_EMAIL = 'false'
$env:JWT_ISSUERS = '[{"iss":"flight-platform-dev","aud":"flight-platform","publicKeyFile":"<ruta absoluta>/infra/dev-keys/dev-public.pem"}]'
npm run local:up -- -SkipDocker      # Postgres y RabbitMQ ya levantados por el humano
node platform/api-gateway/scripts/f12c-pruebas-reales.cjs --local
npm run local:down
```

Diferencias del ensayo con la nube: no hay token de Supabase ni `email_verified` real, el socio no tiene la API de pagos de Booking (su `pay_ok_*` se rechaza con 503 en vez de 422: ambas respuestas significan «no vende») y no hay acuerdo de promociones guardado (esa comprobación sale N/A).
