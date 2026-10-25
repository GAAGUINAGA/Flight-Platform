# ADR-F11-12 — Publicación best-effort de Inventory a Webhooks

Inventory usa `GrpcEventPublisher` hacia Webhooks al arrancar. El estado de holds se confirma antes de publicar; un fallo gRPC se registra solo con dependencia y código y no revierte ni falla la operación. La recuperación de entrega corresponde a Webhooks cuando recibe el evento; Inventory no añade una cola propia.
