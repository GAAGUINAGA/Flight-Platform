# Bitácora de desarrollo — F4 Dockerfile — 2026-10-11 #2

**Rama:** `fix/F4-dockerfile`  
**Commit de código verificado:** `bedd1b6dc3ecf98f33fce3bf78461c34885cf754`

## H1: lint en clon limpio

| Hallazgo | Cambio | Comando que lo demuestra |
|---|---|---|
| `require()` en `platform/api-gateway/src/app.ts:25` infringía `@typescript-eslint/no-require-imports` y `no-undef`. | `createTestComponents` ahora es asíncrona y carga `./test-grpc` con `await import('./test-grpc')`; la carga continúa condicionada a `NODE_ENV === 'test'`. No se desactivó ninguna regla ESLint. | En el clon limpio de `bedd1b6`: `npm run lint` — exit 0. |

## Verificación en clon limpio

Clon nuevo: `C:\Proyectos\fp-f4-h1-clean`. Se ejecutó `npm ci` antes de las comprobaciones, sin leer ni crear archivos `.env`.

| Comando | Resultado |
|---|---|
| `npm run lint` | Exit 0. |
| `npm run build -w @flight-platform/shared` | Exit 0. |
| `npm run build -w @flight-platform/api-gateway` | Exit 0; Prisma Client 6.12.0 generado durante el build. |
| `npx jest platform/api-gateway/src/gateway.spec.ts --runInBand` | Exit 0; 43/43 pruebas unitarias. |
| `npx jest platform/api-gateway --runInBand` | No aplicable como verificación limpia: 43/44 pruebas pasan y la única integración (`prisma-idempotency.integration.spec.ts`) falla rápido porque no existe `DATABASE_URL`. No se suministraron ni leyeron credenciales; la política del repositorio reserva integración con Postgres para el checkout principal administrado por el humano. |
| `docker build -f platform/api-gateway/Dockerfile -t flight-platform-api-gateway:f4-h1-clean .` | Exit 0; imagen `flight-platform-api-gateway:f4-h1-clean` creada desde el clon limpio. |

## Cierre

- Estado: listo para auditoría (código).
