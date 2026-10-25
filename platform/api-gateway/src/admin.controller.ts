import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { GatewayConfig } from './config';
import { callGatewayGrpc } from './grpc-clients';
import { Roles, Scopes } from './security';
import { adminFareBody, adminFareListQuery, adminFlightBody, adminFlightId, adminFlightListQuery, adminOperationalUpdateBody, parseAdmin } from './admin.schemas';

type GrpcService = 'inventory' | 'pricing' | 'operations';

/** Rutas `/flights/v1/admin/*`: no están en el OpenAPI; ver docs/dev/admin-routes.md. */
export class AdminController {
  constructor(private readonly config: GatewayConfig) {}
  private call(req: Request, service: GrpcService, method: string, body: object): Promise<unknown> {
    return callGatewayGrpc(this.config, service, method, body, String(req.res?.getHeader('X-Correlation-Id') ?? ''), req.auth);
  }
  upsertFlight(req: Request, body: unknown) { return this.call(req, 'inventory', 'upsertFlightInstance', parseAdmin(adminFlightBody, body)); }
  listFlights(req: Request, rawQuery: unknown) {
    const query = parseAdmin(adminFlightListQuery, rawQuery);
    const page = { ...(query.cursor ? { cursor: query.cursor } : {}), ...(query.limit !== undefined ? { limit: Number(query.limit) } : {}) };
    return this.call(req, 'inventory', 'listFlightInstances', { ...(Object.keys(page).length ? { page } : {}), ...(query.date ? { date: query.date } : {}) });
  }
  closeFlight(req: Request, flightInstanceId: string) { return this.call(req, 'inventory', 'closeFlightInstance', parseAdmin(adminFlightId, { flightInstanceId })); }
  upsertFare(req: Request, body: unknown) { return this.call(req, 'pricing', 'upsertFare', parseAdmin(adminFareBody, body)); }
  listFares(req: Request, rawQuery: unknown) { const { flightInstanceId } = parseAdmin(adminFareListQuery, rawQuery); return this.call(req, 'pricing', 'listFares', { ...(flightInstanceId ? { flightInstanceId } : {}), page: {} }); }
  operationalUpdate(req: Request, flightInstanceId: string, body: unknown) { return this.call(req, 'operations', 'recordOperationalUpdate', { ...parseAdmin(adminOperationalUpdateBody, body), ...parseAdmin(adminFlightId, { flightInstanceId }) }); }
}
Controller('flights/v1/admin')(AdminController);
Inject('GATEWAY_CONFIG')(AdminController, undefined as unknown as string, 0);
const d = (method: keyof AdminController) => Object.getOwnPropertyDescriptor(AdminController.prototype, method)!;
const P = AdminController.prototype;
Post('flights')(P, 'upsertFlight', d('upsertFlight')); HttpCode(200)(P, 'upsertFlight', d('upsertFlight')); Req()(P, 'upsertFlight', 0); Body()(P, 'upsertFlight', 1);
Get('flights')(P, 'listFlights', d('listFlights')); Req()(P, 'listFlights', 0); Query()(P, 'listFlights', 1);
Post('flights/:flightInstanceId/close')(P, 'closeFlight', d('closeFlight')); HttpCode(200)(P, 'closeFlight', d('closeFlight')); Req()(P, 'closeFlight', 0); Param('flightInstanceId')(P, 'closeFlight', 1);
Put('fares')(P, 'upsertFare', d('upsertFare')); Req()(P, 'upsertFare', 0); Body()(P, 'upsertFare', 1);
Get('fares')(P, 'listFares', d('listFares')); Req()(P, 'listFares', 0); Query()(P, 'listFares', 1);
Post('flights/:flightInstanceId/operational-updates')(P, 'operationalUpdate', d('operationalUpdate')); HttpCode(200)(P, 'operationalUpdate', d('operationalUpdate')); Req()(P, 'operationalUpdate', 0); Param('flightInstanceId')(P, 'operationalUpdate', 1); Body()(P, 'operationalUpdate', 2);
Roles('admin')(AdminController); Scopes('flights:admin')(AdminController);
