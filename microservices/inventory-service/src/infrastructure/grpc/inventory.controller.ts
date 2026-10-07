import { Controller, Inject } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { Metadata } from '@grpc/grpc-js';
import { RequestContext, requestContextFromMetadata } from '@flight-platform/shared';
import { FlightAdmin } from '../../application/flight-admin';
import { FlightQueries } from '../../application/flight-queries';
import { HoldUseCases, HoldView } from '../../application/hold-use-cases';
import { InventoryConfig } from '../../application/ports';
import { FlightInstance } from '../../domain/flight-instance';

export const INVENTORY_DEPS = Symbol('INVENTORY_DEPS');

export interface InventoryDeps {
  queries: FlightQueries;
  admin: FlightAdmin;
  holds: HoldUseCases;
  config: InventoryConfig;
}

// El interceptor global de llave interna siempre deja el contexto en el metadata.
const ctxOf = (metadata: Metadata): RequestContext => requestContextFromMetadata(metadata) as RequestContext;

/** DTOs expl?citos: nunca se devuelve la fila completa (?2.4). */
export function toFlightDto(f: FlightInstance, airlineCode: string) {
  const p = f.props;
  return {
    flightInstanceId: p.id,
    segment: segmentDto(f, airlineCode),
    cabins: p.cabins.map((c) => ({ cabinClass: c.cabinClass, capacity: c.sellable })),
    closed: p.closed
  };
}

function segmentDto(f: FlightInstance, airlineCode: string) {
  const p = f.props;
  return {
    segmentId: p.id,
    flightInstanceId: p.id,
    flightNumber: p.flightNumber,
    departure: { iataCode: p.departureIata, at: p.departureAt.toISOString() },
    arrival: { iataCode: p.arrivalIata, at: p.arrivalAt.toISOString() },
    marketingCarrier: airlineCode,
    operatingCarrier: airlineCode,
    ...(p.aircraft ? { aircraft: p.aircraft } : {}),
    durationMinutes: f.durationMinutes()
  };
}

function holdDto({ hold, status }: HoldView) {
  return {
    holdId: hold.id,
    ownerId: hold.ownerId,
    status,
    expiresAt: hold.expiresAt.toISOString(),
    segments: hold.lines.map((l) => ({ flightInstanceId: l.flightInstanceId, cabinClass: l.cabinClass, seats: l.seats }))
  };
}

@Controller()
export class InventoryController {
  constructor(private readonly d: InventoryDeps) {}

  private flight(f: FlightInstance) {
    return toFlightDto(f, this.d.config.airlineCode);
  }

  async upsertFlightInstance(data: unknown, metadata: Metadata) {
    return this.flight(await this.d.admin.upsert(ctxOf(metadata), data));
  }

  async closeFlightInstance(data: unknown, metadata: Metadata) {
    return this.flight(await this.d.admin.close(ctxOf(metadata), data));
  }

  async listFlightInstances(data: unknown, metadata: Metadata) {
    const { items, nextCursor } = await this.d.queries.list(ctxOf(metadata), data);
    return { items: items.map((f) => this.flight(f)), page: nextCursor ? { nextCursor } : {} };
  }

  async getFlightInstance(data: unknown, metadata: Metadata) {
    return this.flight(await this.d.queries.get(ctxOf(metadata), data));
  }

  async findFlightInstance(data: unknown, metadata: Metadata) {
    return this.flight(await this.d.queries.find(ctxOf(metadata), data));
  }

  async queryAvailability(data: unknown, metadata: Metadata) {
    const flights = await this.d.queries.queryAvailability(ctxOf(metadata), data);
    return {
      flights: flights.map((a) => ({
        segment: segmentDto(a.flight, this.d.config.airlineCode),
        cabinClass: a.cabinClass,
        availableSeats: a.availableSeats
      }))
    };
  }

  async createHold(data: unknown, metadata: Metadata) {
    return holdDto(await this.d.holds.create(ctxOf(metadata), data));
  }

  async getHold(data: unknown, metadata: Metadata) {
    return holdDto(await this.d.holds.get(ctxOf(metadata), data));
  }

  async releaseHold(data: unknown, metadata: Metadata) {
    return holdDto(await this.d.holds.release(ctxOf(metadata), data));
  }

  async consumeHold(data: unknown, metadata: Metadata) {
    return holdDto(await this.d.holds.consume(ctxOf(metadata), data));
  }

  async releaseReservedInventory(data: unknown, metadata: Metadata) {
    await this.d.holds.releaseReserved(ctxOf(metadata), data);
    return {};
  }

  async expireHolds(data: unknown, metadata: Metadata) {
    return { expiredCount: await this.d.holds.expireHolds(ctxOf(metadata), data) };
  }
}

// Los decoradores de m?todo/par?metro de Nest requieren experimentalDecorators, que el
// tsconfig base (compartido con Jest) no habilita; se aplican de forma imperativa (ADR-1-04).
const RPC_METHODS: Record<string, keyof InventoryController> = {
  UpsertFlightInstance: 'upsertFlightInstance',
  CloseFlightInstance: 'closeFlightInstance',
  ListFlightInstances: 'listFlightInstances',
  GetFlightInstance: 'getFlightInstance',
  FindFlightInstance: 'findFlightInstance',
  QueryAvailability: 'queryAvailability',
  CreateHold: 'createHold',
  GetHold: 'getHold',
  ReleaseHold: 'releaseHold',
  ConsumeHold: 'consumeHold',
  ReleaseReservedInventory: 'releaseReservedInventory',
  ExpireHolds: 'expireHolds'
};
for (const [rpc, key] of Object.entries(RPC_METHODS)) {
  const descriptor = Object.getOwnPropertyDescriptor(InventoryController.prototype, key) as PropertyDescriptor;
  GrpcMethod('InventoryService', rpc)(InventoryController.prototype, key, descriptor);
}
Inject(INVENTORY_DEPS)(InventoryController, undefined as unknown as string, 0);
