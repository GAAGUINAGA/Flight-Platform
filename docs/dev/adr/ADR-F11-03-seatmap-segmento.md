# ADR-F11-03 — Comprobación de segmento para seatmap
- Estado: Aceptado · Fecha: 2026-10-20 · Fase/Tarea: F11 / PLT-A
## Contexto
Ancillaries consulta Pricing para resolver el segmento, pero transforma el error gRPC de segmento inexistente en un error interno. El contrato del Gateway exige 404 para seatmap inexistente.
## Decisión
El Gateway resuelve primero el segmento mediante el cliente gRPC real de Pricing y traduce su NOT_FOUND a un 404 público antes de solicitar el mapa a Ancillaries.
## Consecuencias
La ruta realiza una consulta adicional a Pricing. Por decisión del humano, F11a no amplía ese contrato. Las ofertas son anónimas y el mapa no contiene datos personales, por lo que la falta de comprobación de pertenencia no expone información personal. `ResolveSegment` debe devolver el `offerId` del segmento mediante un cambio aditivo en `pricing.proto` para comprobar esa relación; se registra en el backlog junto al ordenamiento de `pricingOptions`. Como los identificadores de segmento se reutilizan entre ofertas, esta limitación también impide distinguir una oferta expirada de otra activa para el mismo segmento.

Ancillaries no utiliza `offerId`: tanto un identificador inexistente como uno expirado pueden devolver 200 cuando el segmento está presente en alguna oferta activa. La comprobación actual solo acredita la existencia del segmento, no su pertenencia a la oferta solicitada.
