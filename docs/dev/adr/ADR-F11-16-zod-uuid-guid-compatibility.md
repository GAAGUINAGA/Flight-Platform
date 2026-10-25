# ADR-F11-16 — Compatibilidad UUID de Zod 3 al migrar a Zod 4

- Estado: Aceptado · Fecha: 2026-10-25 · Fase/Tarea: F11d-1

## Contexto

Zod 4 endurece `uuid()` según los bits de variante RFC. El contrato OpenAPI usa
`format: uuid`, cuya validación con Ajv acepta cualquier cadena hexadecimal con
forma 8-4-4-4-12. Booking puede emitir identificadores con esa forma que no
cumplen los bits RFC.

## Decisión

Los validadores que usaban `z.string().uuid()` en Zod 3 pasan a
`z.string().guid()` en Zod 4. Así se conserva la aceptación previa y la
semántica del contrato: forma hexadecimal 8-4-4-4-12, sin exigir versión ni
variante RFC.

## Decisión del humano: `datetime` según RFC 3339 (audit-11, O1)

Zod 4 rechaza fechas sin segundos (`2026-10-24T00:00Z`) y desplazamientos sin
dos puntos (`+0200`), que Zod 3 aceptaba. Se ACEPTA el comportamiento nuevo: el
contrato usa `format: date-time` (RFC 3339), igual que `ajv-formats`; Zod 3 era
más permisivo que el contrato.

- Se aceptan `2026-10-24T00:00:00Z` y `2026-10-24T00:00:00+02:00`; se rechazan
  `2026-10-24T00:00Z` y `2026-10-24T00:00:00+0200` con `VALIDATION_FAILED`
  (gRPC `INVALID_ARGUMENT`, código 3).
- Webhooks (`occurredAt`) y Operations (`*At`) usaban `datetime()` sin
  `offset`, que ya rechazaba cualquier desplazamiento (también en Zod 3), aunque
  el Gateway admin sí los acepta (`datetime({ offset: true })`) y los reenvía.
  Para que el contrato se cumpla de extremo a extremo ambos pasan a
  `datetime({ offset: true })`. **Es un cambio de comportamiento intencional**:
  corrige la inconsistencia por la que el Gateway aceptaba `+02:00` y lo
  reenviaba a Operations, que lo rechazaba; los tres componentes quedan
  alineados con RFC 3339.
- Condición: un desplazamiento se trata como el mismo instante que su
  equivalente UTC. Operations convierte con `new Date()` y responde con
  `toISOString()` (`2026-11-20T10:00:00+02:00` → `2026-11-20T08:00:00.000Z`);
  su formato de respuesta no cambia. Webhooks guardaba `occurredAt` tal cual
  llegaba, por lo que habría entregado el desplazamiento; ahora lo normaliza con
  `new Date(...).toISOString()`, el mismo formato que el valor por defecto.
  Pruebas: `webhook-use-cases.spec.ts` y `operations-security.spec.ts`.
- Pruebas: `webhooks-service/test/unit/datetime-zod4.spec.ts` y
  `test/security/grpc-security.spec.ts`; `operations-service/test/unit/datetime-zod4.spec.ts`
  y `test/security/operations-security.spec.ts`; `api-gateway/src/admin-datetime.spec.ts`.

## Cambios numéricos de Zod 4 (audit-11, O2)

`z.number()` rechaza `Infinity` y `.int()` rechaza enteros desde 2^53 (Zod 3 los
aceptaba). No son alcanzables: JSON no puede representar `Infinity` y todos los
enteros de los esquemas están acotados muy por debajo de `Number.MAX_SAFE_INTEGER`.
No requieren adaptación ni prueba adicional.

## Consecuencias

Se mantiene la compatibilidad de entradas de los RPC y REST; se añaden pruebas
que aceptan `11111111-1111-1111-1111-111111111111` y rechazan formas no UUID
con `VALIDATION_FAILED`. No se adopta la validación RFC más estricta de Zod 4.
