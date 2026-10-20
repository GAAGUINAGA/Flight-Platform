# ADR-F11-01 — Claims de Supabase y emisor B2B local
- Estado: Aceptado · Fecha: 2026-10-20 · Fase/Tarea: F11a / PLT-SEC-01, PLT-SEC-02
## Contexto
El plan exige claims de rol y scopes, pero no define cómo tratar metadatos ausentes ni valores distintos de los roles previstos para usuarios de Supabase. El emisor B2B de prueba usa el generador de tokens existente.
## Decisión
El hook conserva los claims y concede `admin` solo si `app_metadata.app_role` es exactamente `admin`; cualquier otro valor se interpreta como `customer`. Deriva los scopes de la matriz del plan, sin confiar en `user_metadata`. El B2B usa un emisor independiente `flight-platform-partner-dev`, la llave local y un `sub` de cliente, simulando el token resultante de client credentials sin desplegar un servidor OAuth.
## Consecuencias
Cambios de rol requieren renovar el token. El humano controla `app_metadata` y la configuración del hook. El emisor de prueba usa `publicKeyFile`, prohibido en producción. La autorización de webhooks y ownership debe demostrarse con las rutas reales cuando estén disponibles.
