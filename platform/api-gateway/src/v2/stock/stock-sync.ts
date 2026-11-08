/* global __dirname */
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Logger } from '@nestjs/common';
import { flightLocalDay, flightLocalTime } from '@flight-platform/shared';
import { credentials, loadPackageDefinition, Metadata, type ChannelCredentials } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import type { GatewayConfig } from '../../config';
import { callGatewayGrpc } from '../../grpc-clients';
import type { StockOutboxStore } from './outbox';

export interface StockUpdate { service_id: string; item_id: string; date: string; time_slot: string; available_units: number; timestamp: number }
export interface StockPusher { push(update: StockUpdate, correlationId: string): Promise<void> }

const protoFile = (): string => {
  let directory = __dirname;
  for (;;) { const candidate = join(directory, 'contracts', 'proto', 'external', 'booking', 'inventory.proto'); if (existsSync(candidate)) return candidate; const parent = dirname(directory); if (parent === directory) throw new Error('booking inventory.proto not found'); directory = parent; }
};

type PushClient = { PushStockUpdate(request: StockUpdate, metadata: Metadata, options: { deadline: Date }, callback: (error: Error | null, response?: { success?: boolean; message?: string }) => void): void; close(): void };

/** Cliente gRPC de la ingesta de stock de Booking (`inventory.InventoryStockService/PushStockUpdate`), con `x-api-key` y `x-correlation-id` en la metadata. */
export class GrpcStockPusher implements StockPusher {
  private client?: PushClient;
  constructor(private readonly stock: NonNullable<GatewayConfig['v2']>['stock']) {}
  private channel(): PushClient {
    if (this.client) return this.client;
    const definition = loadSync(protoFile(), { keepCase: true, longs: Number, enums: String, defaults: true, oneofs: true });
    const service = (loadPackageDefinition(definition) as unknown as { inventory: { InventoryStockService: new (address: string, creds: ChannelCredentials) => PushClient } }).inventory.InventoryStockService;
    const creds = this.stock.tls ? credentials.createSsl(this.stock.caFile ? readFileSync(this.stock.caFile) : undefined) : credentials.createInsecure();
    this.client = new service(this.stock.url as string, creds); return this.client;
  }
  push(update: StockUpdate, correlationId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const metadata = new Metadata(); metadata.set('x-api-key', this.stock.apiKey!); metadata.set('x-correlation-id', correlationId || 'gateway-stock');
      this.channel().PushStockUpdate(update, metadata, { deadline: new Date(Date.now() + this.stock.timeoutMs) }, (error, response) => {
        if (error) return reject(new Error('stock push failed'));
        if (response?.success === false) return reject(new Error('stock push rejected'));
        resolve();
      });
    });
  }
  close(): void { this.client?.close(); this.client = undefined; }
}

/** Hora y fecha locales del aeropuerto de salida (HH:mm y YYYY-MM-DD) a partir de un instante ISO; zonas de `@flight-platform/shared` (sin zona: UTC con aviso). */
export function localSlot(isoInstant: string, iata: string): { date: string; time: string } {
  return { date: flightLocalDay(isoInstant, iata, 'stockSync'), time: flightLocalTime(isoInstant, iata, 'stockSync') };
}

const BACKOFF_MINUTES = [1, 2, 5, 15, 30, 60, 120, 360];
const system = { ownerId: 'gateway-stock', role: 'system', scopes: new Set<string>() };
interface FlightSnapshot { closed?: boolean; segment?: { flightNumber?: string; departure?: { iataCode?: string; at?: string }; arrival?: { iataCode?: string } }; cabins?: Array<{ cabinClass: string }> }
interface Availability { flights?: Array<{ segment?: { flightNumber?: string }; cabinClass: string; availableSeats: number }> }

/**
 * Sincronización de stock hacia Booking (P5). Cada cambio que mueve la capacidad (hold, liberación, venta, cancelación, cambio de fecha) encola el
 * vuelo; el envío usa siempre la disponibilidad ACTUAL por cabina, así que repetir o juntar envíos es inocuo. Sin `BOOKING_STOCK_API_KEY` queda apagado:
 * se registra una vez y las operaciones siguen sin tocar la cola.
 */
export class StockSync {
  private readonly logger = new Logger('StockSync');
  private flushing?: Promise<void>;
  constructor(private readonly config: GatewayConfig, readonly store: StockOutboxStore, private readonly pusher: StockPusher, private readonly clock: () => Date = () => new Date()) {
    if (!this.enabled) this.logger.warn(config.v2!.stock.apiKey ? 'Sincronización de stock desactivada (STOCK_SYNC_ENABLED=false)' : 'Sincronización de stock desactivada: faltan BOOKING_STOCK_API_KEY o BOOKING_STOCK_GRPC_URL');
  }
  get enabled(): boolean { return this.config.v2!.stock.enabled; }

  /** Encola los vuelos (y los envía enseguida si ya toca). Nunca lanza: el stock es de mejor esfuerzo y no debe romper la operación. */
  async trigger(flightInstanceIds: Iterable<string>, correlationId: string, dueAt: Date = this.clock()): Promise<void> {
    if (!this.enabled) return;
    try { for (const id of new Set(flightInstanceIds)) await this.store.enqueue(id, dueAt, correlationId); }
    catch { this.logger.warn('stock outbox enqueue failed'); return; }
    if (dueAt <= this.clock()) void this.flush().catch(() => undefined);
  }

  /** Vuelos de un hold de ofertas o de una reserva: ambos traen `itineraries[].segments[].flightInstanceId` (interno). */
  flightsOf(raw: { itineraries?: Array<Record<string, unknown>> } | undefined): string[] {
    if (!raw) return [];
    return (raw.itineraries ?? []).flatMap((itinerary) => ((itinerary.segments ?? []) as Array<{ flightInstanceId?: string }>).map((segment) => segment.flightInstanceId).filter((id): id is string => typeof id === 'string'));
  }

  /** Envía lo pendiente que ya venció (uno por vuelo y cabina); lo que falla se reintenta con backoff y se abandona tras 8 intentos. */
  flush(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    this.flushing ??= this.run().finally(() => { this.flushing = undefined; });
    return this.flushing;
  }
  private async run(): Promise<void> {
    const rows = await this.store.claimDue(this.clock(), 100); const byFlight = new Map<string, typeof rows>();
    for (const row of rows) byFlight.set(row.flightInstanceId, [...(byFlight.get(row.flightInstanceId) ?? []), row]);
    for (const [flightId, group] of byFlight) {
      const ids = group.map((row) => row.id); const correlationId = group[0].correlationId ?? 'gateway-stock';
      try { for (const update of await this.snapshot(flightId, correlationId)) await this.pusher.push(update, correlationId); await this.store.complete(ids); }
      catch {
        const attempts = Math.max(...group.map((row) => row.attempts)) + 1; const terminal = attempts >= BACKOFF_MINUTES.length;
        await this.store.fail(ids, attempts, new Date(this.clock().getTime() + BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] * 60_000), terminal);
        this.logger.warn(`stock push failed attempts=${attempts}${terminal ? ' (abandoned)' : ''}`);
      }
    }
  }

  /** Disponibilidad actual del vuelo por cabina en el formato de Booking. */
  async snapshot(flightInstanceId: string, correlationId: string): Promise<StockUpdate[]> {
    const flight = await callGatewayGrpc(this.config, 'inventory', 'getFlightInstance', { flightInstanceId }, correlationId, system) as FlightSnapshot;
    const segment = flight.segment; const departure = segment?.departure; if (!segment?.flightNumber || !departure?.iataCode || !departure.at || !segment.arrival?.iataCode) return [];
    const local = localSlot(departure.at, departure.iataCode);
    const availability = await callGatewayGrpc(this.config, 'inventory', 'queryAvailability', { origin: departure.iataCode, destination: segment.arrival.iataCode, departureDate: local.date, passengers: { adults: 1, youths: 0, children: 0, infants: 0 } }, correlationId, system) as Availability;
    return (flight.cabins ?? []).map((cabin) => {
      const match = (availability.flights ?? []).find((item) => item.segment?.flightNumber === segment.flightNumber && item.cabinClass === cabin.cabinClass);
      return { service_id: this.config.v2!.nodeId, item_id: `${segment.flightNumber}-${cabin.cabinClass}`, date: local.date, time_slot: local.time, available_units: flight.closed ? 0 : match?.availableSeats ?? 0, timestamp: this.clock().getTime() };
    });
  }
}
