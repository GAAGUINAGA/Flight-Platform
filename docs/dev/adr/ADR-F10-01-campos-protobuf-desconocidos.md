# ADR-F10-01 — Validación de campos desconocidos en Operations
- Estado: Aceptado · Fecha: 2026-10-17 · Fase/Tarea: F10 / OPS-SEC-01
## Contexto
La validación Zod estricta no recibe campos protobuf desconocidos, porque el decodificador los descarta antes de invocar el RPC. El plan exige rechazarlos.
## Decisión
El adaptador de transporte inspecciona los campos de nivel superior de cada solicitud de Operations y conserva un indicador cuando encuentra uno desconocido o con un tipo de wire no admitido; Zod lo rechaza. Los campos declarados actualmente en esas solicitudes son strings. La prueba envía bytes protobuf con un campo adicional por gRPC real.
## Consecuencias
El servidor debe desplegarse con la versión del contrato que incluya cualquier campo nuevo antes de que un cliente lo envíe. Si se agregan tipos de campos distintos de strings habrá que extender la inspección. El contrato no cambia.
