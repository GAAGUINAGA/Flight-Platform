import type { Request, Response } from 'express';
import type { GatewayConfig } from '../config';
import { callGatewayGrpc } from '../grpc-clients';
import { GatewayProblemError } from '../web-errors';
import { Roles } from '../security';
import { v2Controller, v2Route } from './route';

type Json = Record<string, unknown>;
const correlation = (req: Request): string => String(req.res?.getHeader('X-Correlation-Id') ?? '');
const EVENT_ID = /^evt-vue-(\d{1,15})$/;
const COMPOSITE = '~';

/** Las suscripciones pertenecen al cliente (`<clientId>`) y reciben los eventos de todos los recursos `<clientId>~*` (D1). */
const subscriberOf = (req: Request): string => req.auth!.clientId ?? req.auth!.ownerId;

/** WebhookSubscription de v2. `secret` es `writeOnly` en el contrato: no se devuelve nunca, ni siquiera enmascarado. */
const subscriptionView = (value: Json): Json => ({ id: value.id, url: value.url, events: value.events, active: value.active ?? true, ...(value.createdAt ? { createdAt: value.createdAt } : {}) });

/** `POST/GET/DELETE /api/v2/vuelos/webhooks`. */
export class V2WebhooksController {
  constructor(private readonly config: GatewayConfig) {}
  private call(req: Request, method: string, body: object = {}): Promise<unknown> { return callGatewayGrpc(this.config, 'webhooks', method, { ...body, ownerId: subscriberOf(req) }, correlation(req), req.auth); }
  async list(req: Request): Promise<Json[]> {
    const result = await this.call(req, 'listSubscriptions') as { subscriptions?: Json[] };
    // Solo las suscripciones creadas por v2 (las de v1 de un mismo dueño no llevan `active`).
    return (result.subscriptions ?? []).filter((subscription) => subscription.active !== undefined).map(subscriptionView);
  }
  async create(req: Request, res: Response, body: { url: string; events: string[]; secret: string }): Promise<Json> {
    const created = await this.call(req, 'createSubscription', { url: body.url, events: body.events, secret: body.secret, apiVersion: '2' }) as Json;
    res.status(201); return subscriptionView(created);
  }
  async remove(req: Request, id: string): Promise<void> { await this.call(req, 'deleteSubscription', { id }); }
}
v2Controller(V2WebhooksController, 'vuelos/webhooks', ['GATEWAY_CONFIG']);
for (const [name, verb, path, params, extra] of [['list', 'get', '', ['req'], {}], ['create', 'post', '', ['req', 'res', 'body'], {}], ['remove', 'delete', ':id', ['req', 'param:id'], { status: 204 }]] as const) {
  v2Route(V2WebhooksController.prototype, name, verb, path, [...params], { scopes: ['flights:webhooks'], ...extra });
  Roles('partner', 'admin')(V2WebhooksController.prototype, name, Object.getOwnPropertyDescriptor(V2WebhooksController.prototype, name)!);
}

interface StoredEvent { seq: number; eventId: string; ownerId: string; eventType: string; occurredAt: string; correlationId?: string; dataJson: string }
const subjectOf = (data: Json): string | undefined => typeof data.bookingId === 'string' ? data.bookingId : typeof data.holdId === 'string' ? data.holdId : typeof data.flightNumber === 'string' ? `${data.flightNumber}${typeof data.date === 'string' ? `/${data.date}` : ''}` : undefined;

/** Un evento guardado, como CloudEvent v1.0 (la misma forma que recibe el webhook). */
export function toCloudEvent(stored: StoredEvent, sourceCode: string): Json {
  const data = JSON.parse(stored.dataJson) as Json; const owner = stored.ownerId.includes(COMPOSITE) ? stored.ownerId.slice(stored.ownerId.indexOf(COMPOSITE) + 1) : undefined;
  const merged: Json = { ...data, ...(owner ? { ownerId: owner } : {}) }; const subject = subjectOf(merged);
  return { specversion: '1.0', type: `ec.edu.epn.booking.vuelos.${stored.eventType}`, source: `/aerolineas/${sourceCode}/vuelos`, id: `evt-vue-${String(stored.seq).padStart(6, '0')}`, time: stored.occurredAt, ...(subject ? { subject } : {}), datacontenttype: 'application/json', correlationid: stored.correlationId ?? stored.eventId, data: merged };
}

/** `GET /api/v2/vuelos/eventos`: feed de respaldo con los eventos del cliente, en orden y paginado por `after`. */
export class V2EventsController {
  constructor(private readonly config: GatewayConfig) {}
  async list(req: Request, query: { limit?: string; after?: string; type?: string }): Promise<Json> {
    const limit = Number(query.limit ?? 20); let afterSeq: number | undefined;
    if (query.after !== undefined) { const match = EVENT_ID.exec(query.after); if (!match) throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'after debe tener la forma evt-vue-NNNNNN'); afterSeq = Number(match[1]); }
    // Se pide uno más para saber si quedan eventos después de esta página.
    const result = await callGatewayGrpc(this.config, 'webhooks', 'listEvents', { ownerPrefix: req.auth!.clientId ?? req.auth!.ownerId, ...(afterSeq !== undefined ? { afterSeq } : {}), limit: limit + 1, ...(query.type ? { eventType: query.type } : {}) }, correlation(req), req.auth) as { items?: StoredEvent[] };
    const items = result.items ?? []; const page = items.slice(0, limit); const events = page.map((item) => toCloudEvent(item, this.config.v2!.sourceCode));
    return { events, metadata: { total: events.length, next_after: items.length > limit ? events.at(-1)!.id : null, timestamp: new Date().toISOString() } };
  }
}
v2Controller(V2EventsController, 'vuelos/eventos', ['GATEWAY_CONFIG']);
v2Route(V2EventsController.prototype, 'list', 'get', '', ['req', 'query'], { scopes: ['flights:read'] });
