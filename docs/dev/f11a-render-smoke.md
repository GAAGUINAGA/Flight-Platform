# F11a: smoke de compra para Render

Con Node 20 y desde el repositorio, configura `BASE_URL` con el origen del Gateway y `SUPABASE_CUSTOMER_TOKEN` con un access token de customer que tenga `flights:read`, `flights:hold` y `flights:book`. No escribas el token en la línea de comandos ni en archivos versionados.

Ejecuta `node platform/api-gateway/scripts/render-j1-smoke.cjs`. El script crea una reserva y emite un ticket con una referencia de pago simulada; requiere servicios y datos de prueba disponibles en Render. Comprueba 401 sin token y recorre búsqueda, mapa, hold, reserva confirmada, detalle y tickets. Cada paso muestra `OK   <paso>`; ante un fallo informa el estado y el código sin mostrar el token ni el cuerpo.

Por defecto busca UIO–GYE para dos días después de la ejecución. Para otros datos de prueba son opcionales `SMOKE_ORIGIN`, `SMOKE_DESTINATION` y `SMOKE_DEPARTURE_DATE` (AAAA-MM-DD). Estas variables y `SUPABASE_CUSTOMER_TOKEN` son para la máquina que ejecuta el smoke; no son variables nuevas del servicio Render.

La implementación de F11a no añade variables de configuración del Gateway para Render. Deben estar configuradas las existentes: `JWT_ISSUERS` con issuer, audiencia y JWKS de Supabase; `INTERNAL_API_KEY`; `PRICING_GRPC_URL`, `ANCILLARIES_GRPC_URL`, `RESERVATION_GRPC_URL` y `TICKETING_GRPC_URL`; `GRPC_TLS`; `DATABASE_URL` para idempotencia y, según el entorno, `VALIDATE_RESPONSES`, `CORS_ORIGINS`, los límites y demás variables ya documentadas en los ejemplos del Gateway. Las claves y tokens se configuran como secretos en Render.
