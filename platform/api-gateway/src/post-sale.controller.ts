import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { GatewayConfig } from './config';
import { callGatewayGrpc } from './grpc-clients';
import { Idempotent, Scopes } from './security';

export class PostSaleController {
  constructor(private readonly config: GatewayConfig) {}
  private call(req: Request, method: string, bookingId: string, body: object = {}): Promise<unknown> {
    return callGatewayGrpc(this.config, 'reservation', method, { ...body, bookingId, ownerId: req.auth!.ownerId }, String(req.res?.getHeader('X-Correlation-Id') ?? ''), req.auth);
  }
  async baggageOptions(req: Request, bookingId: string): Promise<unknown> { const value = await this.call(req, 'getBaggageOptions', bookingId) as { options: unknown[] }; return value.options; }
  baggage(req: Request, bookingId: string, body: object): Promise<unknown> { return this.call(req, 'addBaggage', bookingId, { ...body, idempotencyKey: req.header('idempotency-key') }); }
  async search(req: Request, bookingId: string, body: object): Promise<unknown> { const value = await this.call(req, 'searchDateChange', bookingId, body) as { offers: unknown[] }; return value.offers; }
  async change(req: Request, res: Response, bookingId: string, body: { assignedSeats?: unknown[] }): Promise<unknown> {
    const value = await this.call(req, 'confirmDateChange', bookingId, { ...body, assignedSeats: body.assignedSeats ?? [], idempotencyKey: req.header('idempotency-key') }) as { status: string };
    if (value.status === 'CHANGE_PENDING') { res.status(202); return undefined; }
    return value;
  }
  quote(req: Request, bookingId: string): Promise<unknown> { return this.call(req, 'getCancellationQuote', bookingId); }
  async cancel(req: Request, res: Response, bookingId: string, body: object): Promise<void> {
    const value = await this.call(req, 'cancelReservation', bookingId, { ...body, idempotencyKey: req.header('idempotency-key') }) as { status: string };
    res.status(value.status === 'CANCELLATION_PENDING' || value.status === 'CANCEL_PENDING' ? 202 : 200);
  }
}
Controller('flights/v1/bookings/:bookingId')(PostSaleController);
Inject('GATEWAY_CONFIG')(PostSaleController, undefined, 0);
const descriptor = (method: keyof PostSaleController) => Object.getOwnPropertyDescriptor(PostSaleController.prototype, method)!;
Get('baggage-options')(PostSaleController.prototype, 'baggageOptions', descriptor('baggageOptions'));
Req()(PostSaleController.prototype, 'baggageOptions', 0); Param('bookingId')(PostSaleController.prototype, 'baggageOptions', 1); Scopes('flights:read')(PostSaleController.prototype, 'baggageOptions', descriptor('baggageOptions'));
Post('baggage')(PostSaleController.prototype, 'baggage', descriptor('baggage')); HttpCode(200)(PostSaleController.prototype, 'baggage', descriptor('baggage'));
Req()(PostSaleController.prototype, 'baggage', 0); Param('bookingId')(PostSaleController.prototype, 'baggage', 1); Body()(PostSaleController.prototype, 'baggage', 2); Scopes('flights:book')(PostSaleController.prototype, 'baggage', descriptor('baggage')); Idempotent()(PostSaleController.prototype, 'baggage', descriptor('baggage'));
Post('date-change/search')(PostSaleController.prototype, 'search', descriptor('search')); HttpCode(200)(PostSaleController.prototype, 'search', descriptor('search'));
Req()(PostSaleController.prototype, 'search', 0); Param('bookingId')(PostSaleController.prototype, 'search', 1); Body()(PostSaleController.prototype, 'search', 2); Scopes('flights:read')(PostSaleController.prototype, 'search', descriptor('search'));
Post('date-change')(PostSaleController.prototype, 'change', descriptor('change')); HttpCode(200)(PostSaleController.prototype, 'change', descriptor('change'));
Req()(PostSaleController.prototype, 'change', 0); Res({ passthrough: true })(PostSaleController.prototype, 'change', 1); Param('bookingId')(PostSaleController.prototype, 'change', 2); Body()(PostSaleController.prototype, 'change', 3); Scopes('flights:book')(PostSaleController.prototype, 'change', descriptor('change')); Idempotent()(PostSaleController.prototype, 'change', descriptor('change'));
Get('cancellation-quote')(PostSaleController.prototype, 'quote', descriptor('quote'));
Req()(PostSaleController.prototype, 'quote', 0); Param('bookingId')(PostSaleController.prototype, 'quote', 1); Scopes('flights:read')(PostSaleController.prototype, 'quote', descriptor('quote'));
Post('cancel')(PostSaleController.prototype, 'cancel', descriptor('cancel')); HttpCode(200)(PostSaleController.prototype, 'cancel', descriptor('cancel'));
Req()(PostSaleController.prototype, 'cancel', 0); Res({ passthrough: true })(PostSaleController.prototype, 'cancel', 1); Param('bookingId')(PostSaleController.prototype, 'cancel', 2); Body()(PostSaleController.prototype, 'cancel', 3); Scopes('flights:cancel')(PostSaleController.prototype, 'cancel', descriptor('cancel')); Idempotent()(PostSaleController.prototype, 'cancel', descriptor('cancel'));
