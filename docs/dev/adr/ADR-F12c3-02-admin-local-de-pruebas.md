# ADR-F12c3-02 — Administrador en el acceso local de pruebas (`POST /local/admin-user`)
- Estado: Aceptado · Fecha: 2026-11-14 · Fase/Tarea: F12c-3 (plataforma local y e2e)

## Contexto
ADR-F12c2a-02 dejó abierto: «no hay rol `admin` local por este servicio; el panel (F12c-3) decidirá cómo probarlo». El e2e necesita entrar como administrador y que el cliente no pueda. Un token de `npm run dev:token` no sirve (la web no puede firmar tokens y no inicia sesión con él). El token real de Supabase con rol admin lo prueba el humano.

## Decisión
1. `scripts/local-platform/local-auth.cjs` guarda un `role` por usuario (`customer` por omisión). **Un registro (`signup`) siempre es `customer`**, aunque pida otro rol en sus metadatos (prueba LAU-07).
2. Ruta nueva **solo local**: `POST /local/admin-user` `{ email, password }` crea un administrador. **Rechaza (403) cualquier petición con cabecera `Origin`**: una página web (incluida la web local) no puede crear administradores; sí un cliente sin `Origin` (el e2e de Playwright con `request`, un script). No devuelve token: se inicia sesión como cualquier usuario.
3. El token de un administrador lleva `app_role: admin` y el scope `flights:admin` además de los de cliente; el de un cliente no cambia. El Gateway y GraphQL locales lo verifican con la misma llave pública (sin cambios en `local:up`).
4. Mismos límites del servicio: no arranca con `NODE_ENV=production`, solo 127.0.0.1, usuarios en memoria, tope de usuarios, sin registrar correos, contraseñas ni tokens.

## Consecuencias
- `local-auth.spec.ts` LAU-07 ejecuta el cliente de sesión real contra el servicio: el rol llega como `admin` y el scope incluye `flights:admin`; un cliente no puede crearse administrador por `Origin` ni por metadatos.
- No cubre el comportamiento real de Supabase (el hook que pone `app_role`): lo prueba el humano con un usuario real con rol admin (S-2, S-6).
- El e2e del panel cambia el estado de un vuelo de prueba lejano a `DELAYED` (no se deshace): consume uno por corrida; `npm run local:seed` repone los datos. La edición de tarifas se restaura sola.
