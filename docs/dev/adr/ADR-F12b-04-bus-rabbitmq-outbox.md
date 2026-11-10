# ADR-F12b-04 — Bus de eventos en RabbitMQ con outbox y consumo por lotes
- Estado: Aceptado (bloque 0 aprobado por el humano 2026-11-08) · Fecha: 2026-11-08 · Fase/Tarea: F12b-2 / Bloque 0
## Contexto
Los servicios emisores llaman hoy a Webhooks por gRPC de forma síncrona; si Webhooks cae, el evento se pierde o la operación se degrada. La arquitectura del curso pide un bus de eventos. La plataforma corre en Cloud Run (CPU reducida entre peticiones, escala a cero) y se apaga entre sesiones; CloudAMQP tiene plan gratuito.
## Decisión
- RabbitMQ solo para eventos: CloudAMQP gratuito en la nube; contenedor en local. Un exchange `topic` (`flight.events`), clave de enrutamiento = `eventType`, mensajes CloudEvents 1.0 con `correlationid` (el `data` es el mismo `ownerId` + `payload` del `PublishEvent` actual).
- Publicación con **outbox** en `esb.outbox_events`: los emisores llaman al ESB (`clientes.publicar-evento`, operación nativa), que inserta (idempotente por `event_id`) y responde. Un lote reclamado con `FOR UPDATE SKIP LOCKED` y arriendo se publica con confirmación y recién entonces se marca `PUBLISHED`.
- **Consumo por lotes disparado por el scheduler** (`basic.get`), sin consumidores permanentes: la tarea `dispatch-pending` publica la outbox y luego Webhooks retira, ingresa y entrega. La conexión al broker se abre solo durante la corrida.
- Garantía al menos una vez; efecto exactamente una vez por idempotencia por `eventId` (ADR-F12b-05).
- Vuelta atrás: `ESB_EVENTS_MODE=outbox|grpc` (por defecto `outbox`); `grpc` reenvía a Webhooks como hoy, sin redesplegar emisores.
- `PublishEvent` (RPC) y los `.proto` no cambian. Librería: `amqplib`.
## Consecuencias
- Si RabbitMQ cae, los eventos esperan en la outbox y se publican al volver, en orden de `seq`; el ingreso sigue respondiendo.
- Latencia de feed y de entrega de hasta un tick del scheduler (60 s en la nube).
- El ESB gana base de datos (ADR-F12b-06). Si el ESB cae, la emisión falla como hoy cuando cae Webhooks (sin outbox en cada emisor).
- Fuera de alcance: consumidores permanentes, más propósitos de cola, reproceso automático de fallidos.
- **Limitación conocida (D-4):** el emisor llama al ESB por HTTP síncrono. Si el ESB no responde, el evento se pierde para ese emisor, igual que hoy cuando Webhooks no responde (inventory y Gateway lo registran y siguen; reservation lo trata como dependencia). Solución prevista en F12b-3: el orquestador escribe el evento en la outbox en la misma transacción que sus cambios.
- **Contrato observable (D-2):** desde F12b-2 los eventos (webhooks y feed `GET /vuelos/eventos`) pueden tardar hasta un tick del scheduler (60 s en la nube); documentado en `docs/booking-integration.md`.
