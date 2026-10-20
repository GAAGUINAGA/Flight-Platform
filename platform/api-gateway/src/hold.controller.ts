import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { GatewayConfig } from './config';
import { callGatewayGrpc } from './grpc-clients';
import { Idempotent, Scopes } from './security';

export class HoldController {
  constructor(private readonly config: GatewayConfig) {}

  async create(req: Request, body: Record<string, unknown>): Promise<unknown> {
    return callGatewayGrpc(this.config, 'pricing', 'holdOffer', {
      ...body, ownerId: req.auth!.ownerId, idempotencyKey: req.header('idempotency-key')
    }, String(req.res?.getHeader('X-Correlation-Id') ?? ''), req.auth);
  }

  async get(req: Request, holdId: string): Promise<unknown> {
    const result = await callGatewayGrpc(this.config, 'pricing', 'getOfferHold', { holdId, ownerId: req.auth!.ownerId }, String(req.res?.getHeader('X-Correlation-Id') ?? ''), req.auth) as Record<string, unknown>;
    return { status: result.status, ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}), remainingSeconds: result.remainingSeconds, lockedPrice: result.lockedPrice };
  }

  async release(req: Request, holdId: string): Promise<void> {
    await callGatewayGrpc(this.config, 'pricing', 'releaseOfferHold', { holdId, ownerId: req.auth!.ownerId }, String(req.res?.getHeader('X-Correlation-Id') ?? ''), req.auth);
  }
}
Controller('flights/v1/offers/hold')(HoldController);
Inject('GATEWAY_CONFIG')(HoldController, undefined, 0);
Post()(HoldController.prototype, 'create', Object.getOwnPropertyDescriptor(HoldController.prototype, 'create')!);
Req()(HoldController.prototype, 'create', 0); Body()(HoldController.prototype, 'create', 1);
Scopes('flights:hold')(HoldController.prototype, 'create', Object.getOwnPropertyDescriptor(HoldController.prototype, 'create')!);
Idempotent()(HoldController.prototype, 'create', Object.getOwnPropertyDescriptor(HoldController.prototype, 'create')!);
Get(':holdId')(HoldController.prototype, 'get', Object.getOwnPropertyDescriptor(HoldController.prototype, 'get')!);
Req()(HoldController.prototype, 'get', 0); Param('holdId')(HoldController.prototype, 'get', 1);
Scopes('flights:read')(HoldController.prototype, 'get', Object.getOwnPropertyDescriptor(HoldController.prototype, 'get')!);
Delete(':holdId')(HoldController.prototype, 'release', Object.getOwnPropertyDescriptor(HoldController.prototype, 'release')!);
HttpCode(204)(HoldController.prototype, 'release', Object.getOwnPropertyDescriptor(HoldController.prototype, 'release')!);
Req()(HoldController.prototype, 'release', 0); Param('holdId')(HoldController.prototype, 'release', 1);
Scopes('flights:hold')(HoldController.prototype, 'release', Object.getOwnPropertyDescriptor(HoldController.prototype, 'release')!);
