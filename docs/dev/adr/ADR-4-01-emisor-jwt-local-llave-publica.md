# ADR-4-01 — Emisor JWT local con archivo de llave pública
- Estado: Aceptado · Fecha: 2026-10-10 · Fase/Tarea: F4 / GW-SEC-01
- Reemplaza en parte: ADR-0-02 (solo lo relativo a las llaves de desarrollo)

## Contexto
El Gateway valida JWT por emisor con `jose` (`JWT_ISSUERS`). En local no hay Supabase Auth; levantar un servidor JWKS solo para desarrollo añade un proceso y superficie sin valor.

## Decisión
1. `dev-token.ts` gana el modo `--init-keys`: genera el par RSA-2048 en `infra/dev-keys/` (ignorado por git; privada con modo 0600; la privada nunca se imprime ni se devuelve; no sobrescribe sin `--force`). ADR-0-02 pedía que el usuario aportara la llave; ahora el script puede generarla. Sigue firmando con `node:crypto` y `tsx`, y se niega a operar con `NODE_ENV=production`.
2. El token firmado lleva `kid` (`dev-1`), `iss="flight-platform-dev"`, `aud="flight-platform"` y los claims `sub`, `app_role`, `scope`, `iat`, `exp`.
3. Cada entrada de `JWT_ISSUERS` acepta `jwksUri` **o** `publicKeyFile` (exactamente uno). `publicKeyFile` solo es válido si `NODE_ENV != production`; en producción el Gateway **rechaza arrancar** si algún emisor lo usa. Esa validación y su prueba (`S`: arranque en producción con `publicKeyFile` ⇒ error) pertenecen a GW-SEC-01.

## Consecuencias
Sin servidor JWKS local. El riesgo de que una llave de desarrollo llegue a producción se cierra con el rechazo en arranque. Quien reciba el token de dev solo es aceptado por Gateways con ese emisor configurado.
