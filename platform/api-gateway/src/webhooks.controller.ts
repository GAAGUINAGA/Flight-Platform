import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { GatewayConfig } from './config';
import { callGatewayGrpc } from './grpc-clients';
import { Roles, Scopes } from './security';

export class WebhooksController {
  constructor(private readonly config: GatewayConfig) {}
  private call(req: Request, method: string, body: object = {}) { return callGatewayGrpc(this.config, 'webhooks', method, { ...body, ownerId: req.auth!.ownerId }, String(req.res?.getHeader('X-Correlation-Id') ?? ''), req.auth); }
  async list(req: Request) { return (await this.call(req, 'listSubscriptions') as { subscriptions: unknown[] }).subscriptions; }
  create(req: Request, body: object) { return this.call(req, 'createSubscription', body); }
  async remove(req: Request, id: string): Promise<void> { await this.call(req, 'deleteSubscription', { id }); }
}
Controller('flights/v1/webhooks')(WebhooksController); Inject('GATEWAY_CONFIG')(WebhooksController, undefined as unknown as string, 0);
const d = (method: keyof WebhooksController) => Object.getOwnPropertyDescriptor(WebhooksController.prototype, method)!;
Get()(WebhooksController.prototype, 'list', d('list')); Req()(WebhooksController.prototype, 'list', 0);
Post()(WebhooksController.prototype, 'create', d('create')); Req()(WebhooksController.prototype, 'create', 0); Body()(WebhooksController.prototype, 'create', 1);
Delete(':id')(WebhooksController.prototype, 'remove', d('remove')); HttpCode(204)(WebhooksController.prototype, 'remove', d('remove')); Req()(WebhooksController.prototype, 'remove', 0); Param('id')(WebhooksController.prototype, 'remove', 1);
for (const method of ['list', 'create', 'remove'] as const) { Roles('partner', 'admin')(WebhooksController.prototype, method, d(method)); Scopes('flights:webhooks')(WebhooksController.prototype, method, d(method)); }
