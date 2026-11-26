# ADR-F12b1-01 — Gate en respuestas de Operations
- Estado: Aceptado · Fecha: 2026-11-24 · Fase/Tarea: F12b1 / entrega 3
## Contexto
El contrato v2 declara `gate` opcional y nullable en `FlightStatusEndpoint` y `BoardingPass`. Operations ya persiste `departureGate`, pero los RPC `FlightStatus` y `BoardingPass` no lo transportan.
## Decisión
Agregar `gate` como campo opcional nuevo al final de ambos mensajes protobuf. Operations lo copia desde el vuelo operacional a la salida gRPC cuando existe. En pases se consulta el estado actual del vuelo, sin guardar otra copia de la puerta. Si no está asignada, se omite, tal como permite el contrato v2.
## Consecuencias
No hay migración ni modificación de campos protobuf existentes. Los consumidores anteriores ignoran los campos nuevos. Los pases reflejan cambios posteriores de puerta al consultarlos otra vez.
