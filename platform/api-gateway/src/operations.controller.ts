import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { GatewayConfig } from './config';
import { callGatewayGrpc } from './grpc-clients';
import { Public, Scopes } from './security';

export class OperationsController {
  constructor(private readonly config: GatewayConfig) {}
  private call(req: Request, method: string, body: object): Promise<unknown> {
    return callGatewayGrpc(this.config, 'operations', method, body, String(req.res?.getHeader('X-Correlation-Id') ?? ''), req.auth);
  }
  checkIn(req: Request, bookingId: string): Promise<unknown> { return this.call(req, 'checkIn', { bookingId, ownerId: req.auth!.ownerId }); }
  boardingPasses(req: Request, bookingId: string): Promise<unknown> { return this.call(req, 'listBoardingPasses', { bookingId, ownerId: req.auth!.ownerId }); }
  flightStatus(req: Request, flightNumber: string, date: string): Promise<unknown> { return this.call(req, 'getFlightStatus', { flightNumber, date }); }
}
Controller('flights/v1')(OperationsController);
Inject('GATEWAY_CONFIG')(OperationsController, undefined, 0);
const descriptor = (method: keyof OperationsController) => Object.getOwnPropertyDescriptor(OperationsController.prototype, method)!;
Post('bookings/:bookingId/check-in')(OperationsController.prototype, 'checkIn', descriptor('checkIn')); HttpCode(200)(OperationsController.prototype, 'checkIn', descriptor('checkIn'));
Req()(OperationsController.prototype, 'checkIn', 0); Param('bookingId')(OperationsController.prototype, 'checkIn', 1); Scopes('flights:book')(OperationsController.prototype, 'checkIn', descriptor('checkIn'));
Get('bookings/:bookingId/boarding-passes')(OperationsController.prototype, 'boardingPasses', descriptor('boardingPasses'));
Req()(OperationsController.prototype, 'boardingPasses', 0); Param('bookingId')(OperationsController.prototype, 'boardingPasses', 1); Scopes('flights:read')(OperationsController.prototype, 'boardingPasses', descriptor('boardingPasses'));
Get('flights/:flightNumber/status')(OperationsController.prototype, 'flightStatus', descriptor('flightStatus'));
Req()(OperationsController.prototype, 'flightStatus', 0); Param('flightNumber')(OperationsController.prototype, 'flightStatus', 1); Query('date')(OperationsController.prototype, 'flightStatus', 2); Public()(OperationsController.prototype, 'flightStatus', descriptor('flightStatus'));
