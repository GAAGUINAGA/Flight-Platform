import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { GatewayConfig } from './config';
import { callGatewayGrpc } from './grpc-clients';
import { Public } from './security';
import { GatewayProblemError } from './web-errors';
import { status } from '@grpc/grpc-js';

type Json = Record<string, unknown>;
const stripSegment = (segment: Json): Json => {
  const { flightInstanceId: _internal, ...publicSegment } = segment;
  void _internal;
  return publicSegment;
};
const publicItinerary = (itinerary: Json): Json => ({
  ...itinerary,
  segments: Array.isArray(itinerary.segments) ? itinerary.segments.map((segment: Json) => stripSegment(segment)) : []
});

export class ShoppingController {
  constructor(private readonly config: GatewayConfig) {}

  async search(req: Request, body: { itineraries: unknown[]; passengers: object }): Promise<Json> {
    const response = await callGatewayGrpc(this.config, 'pricing', 'searchOffers', { legs: body.itineraries, passengers: body.passengers }, String(req.res?.getHeader('X-Correlation-Id') ?? '')) as { totalOffers: number; offers: Json[] };
    return {
      totalOffers: response.totalOffers,
      offers: response.offers.map((offer) => ({
        offerId: offer.offerId,
        airline: { code: offer.airlineCode, name: offer.airlineName },
        itineraries: Array.isArray(offer.itineraries) ? offer.itineraries.map((item: Json) => publicItinerary(item)) : [],
        grandTotal: offer.grandTotal
      }))
    };
  }

  async seatmap(req: Request, offerId: string, segmentId: string): Promise<unknown> {
    try {
      await callGatewayGrpc(this.config, 'pricing', 'resolveSegment', { segmentId }, String(req.res?.getHeader('X-Correlation-Id') ?? ''));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === status.NOT_FOUND) throw new GatewayProblemError(404, 'OFFER_NO_LONGER_AVAILABLE', 'Offer or segment not available');
      throw error;
    }
    return callGatewayGrpc(this.config, 'ancillaries', 'getSeatMapForOffer', { offerId, segmentId }, String(req.res?.getHeader('X-Correlation-Id') ?? ''));
  }
}

Controller('flights/v1')(ShoppingController);
Inject('GATEWAY_CONFIG')(ShoppingController, undefined, 0);
Post('search')(ShoppingController.prototype, 'search', Object.getOwnPropertyDescriptor(ShoppingController.prototype, 'search')!);
HttpCode(200)(ShoppingController.prototype, 'search', Object.getOwnPropertyDescriptor(ShoppingController.prototype, 'search')!);
Req()(ShoppingController.prototype, 'search', 0); Body()(ShoppingController.prototype, 'search', 1);
Public()(ShoppingController.prototype, 'search', Object.getOwnPropertyDescriptor(ShoppingController.prototype, 'search')!);
Get('offers/:offerId/seatmap')(ShoppingController.prototype, 'seatmap', Object.getOwnPropertyDescriptor(ShoppingController.prototype, 'seatmap')!);
Req()(ShoppingController.prototype, 'seatmap', 0); Param('offerId')(ShoppingController.prototype, 'seatmap', 1); Query('segmentId')(ShoppingController.prototype, 'seatmap', 2);
Public()(ShoppingController.prototype, 'seatmap', Object.getOwnPropertyDescriptor(ShoppingController.prototype, 'seatmap')!);
