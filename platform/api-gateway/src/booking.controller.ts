import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { GatewayConfig } from './config';
import { callGatewayGrpc } from './grpc-clients';
import { Idempotent, Scopes } from './security';

export class BookingController {
  constructor(private readonly config: GatewayConfig) {}
  private call(req: Request, service: 'reservation' | 'ticketing', method: string, input: object): Promise<unknown> {
    return callGatewayGrpc(this.config, service, method, { ...input, ownerId: req.auth!.ownerId }, String(req.res?.getHeader('X-Correlation-Id') ?? ''), req.auth);
  }
  list(req: Request, query: { pnr?: string; limit?: number; cursor?: string }): Promise<unknown> {
    return this.call(req, 'reservation', 'listReservations', { pnr: query.pnr, page: { limit: Number(query.limit ?? 10), cursor: query.cursor } });
  }
  async create(req: Request, res: Response, body: object): Promise<unknown> {
    const result = await this.call(req, 'reservation', 'createReservation', { ...body, idempotencyKey: req.header('idempotency-key') }) as { status: string; bookingId: string; createdAt?: string };
    res.status(result.status === 'CONFIRMED' ? 201 : 202);
    return result.createdAt ? result : this.call(req, 'reservation', 'getReservation', { bookingId: result.bookingId });
  }
  detail(req: Request, bookingId: string): Promise<unknown> { return this.call(req, 'reservation', 'getReservation', { bookingId }); }
  async tickets(req: Request, bookingId: string): Promise<unknown> { await this.call(req, 'reservation', 'getReservation', { bookingId }); return this.call(req, 'ticketing', 'listTickets', { bookingId }); }
  ticket(req: Request, bookingId: string, ticketId: string): Promise<unknown> { return this.call(req, 'ticketing', 'getTicket', { bookingId, ticketId }); }
}
Controller('flights/v1/bookings')(BookingController);
Inject('GATEWAY_CONFIG')(BookingController, undefined, 0);
Get()(BookingController.prototype, 'list', Object.getOwnPropertyDescriptor(BookingController.prototype, 'list')!);
Req()(BookingController.prototype, 'list', 0); Query()(BookingController.prototype, 'list', 1); Scopes('flights:read')(BookingController.prototype, 'list', Object.getOwnPropertyDescriptor(BookingController.prototype, 'list')!);
Post()(BookingController.prototype, 'create', Object.getOwnPropertyDescriptor(BookingController.prototype, 'create')!);
Req()(BookingController.prototype, 'create', 0); Res({ passthrough: true })(BookingController.prototype, 'create', 1); Body()(BookingController.prototype, 'create', 2); Scopes('flights:book')(BookingController.prototype, 'create', Object.getOwnPropertyDescriptor(BookingController.prototype, 'create')!); Idempotent()(BookingController.prototype, 'create', Object.getOwnPropertyDescriptor(BookingController.prototype, 'create')!);
Get(':bookingId')(BookingController.prototype, 'detail', Object.getOwnPropertyDescriptor(BookingController.prototype, 'detail')!);
Req()(BookingController.prototype, 'detail', 0); Param('bookingId')(BookingController.prototype, 'detail', 1); Scopes('flights:read')(BookingController.prototype, 'detail', Object.getOwnPropertyDescriptor(BookingController.prototype, 'detail')!);
Get(':bookingId/tickets')(BookingController.prototype, 'tickets', Object.getOwnPropertyDescriptor(BookingController.prototype, 'tickets')!);
Req()(BookingController.prototype, 'tickets', 0); Param('bookingId')(BookingController.prototype, 'tickets', 1); Scopes('flights:read')(BookingController.prototype, 'tickets', Object.getOwnPropertyDescriptor(BookingController.prototype, 'tickets')!);
Get(':bookingId/tickets/:ticketId')(BookingController.prototype, 'ticket', Object.getOwnPropertyDescriptor(BookingController.prototype, 'ticket')!);
Req()(BookingController.prototype, 'ticket', 0); Param('bookingId')(BookingController.prototype, 'ticket', 1); Param('ticketId')(BookingController.prototype, 'ticket', 2); Scopes('flights:read')(BookingController.prototype, 'ticket', Object.getOwnPropertyDescriptor(BookingController.prototype, 'ticket')!);
