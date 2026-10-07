# ADR-1-04 ? Decoradores de Nest aplicados de forma imperativa
- Estado: Aceptado ? Fecha: 2026-10-06 ? Fase/Tarea: F1 / INV-01

## Contexto
`jest.config.cjs` ra?z compila con `tsconfig.base.json`, que no habilita `experimentalDecorators`. Los decoradores de m?todo y par?metro de Nest (`@GrpcMethod`, `@Inject`) fallan con la sem?ntica est?ndar de TS 5, y la configuraci?n ra?z no se modifica desde F1.

## Decisi?n
`InventoryController` registra sus RPCs con `GrpcMethod(...)(prototype, key, descriptor)` e `Inject(...)(Controller, undefined, 0)` tras la clase; solo `@Controller`, `@Module`, `@Catch` e `@Injectable` (decoradores de clase) se usan en sintaxis normal.

## Consecuencias
Las pruebas levantan el servidor gRPC real bajo el Jest ra?z sin configuraci?n adicional. Si la ra?z habilita decoradores legacy, el bloque puede reemplazarse por decoradores normales.
