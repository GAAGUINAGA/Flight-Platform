import { Controller, Inject, Logger } from '@nestjs/common';
import { Metadata, status } from '@grpc/grpc-js';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { DomainError, RequestContext, requestContextFromMetadata, requireRole, rpcString } from '@flight-platform/shared';
import { z } from 'zod';

export interface ReservationHandlers {
  createReservation?(input: unknown): Promise<unknown>; getReservation?(input: unknown): Promise<unknown>; listReservations?(input: unknown): Promise<unknown>;
  getReservationSnapshot?(input: unknown): Promise<unknown>; listReservationsByFlightInstance?(input: unknown): Promise<unknown>; resumePending?(input: unknown): Promise<unknown>;
  getBaggageOptions?(input: unknown): Promise<unknown>; addBaggage?(input: unknown): Promise<unknown>;
  searchDateChange?(input: unknown): Promise<unknown[]>;
  confirmDateChange?(input: unknown): Promise<unknown>;
  getCancellationQuote?(input: unknown): Promise<unknown>;
  cancelReservation?(input: unknown): Promise<unknown>;
}
export const RESERVATION_DEPS = Symbol('RESERVATION_DEPS');
const passengerSchema = z.object({ passengerId: rpcString(128), passengerType: z.enum(['ADULT', 'YOUTH', 'CHILD', 'INFANT']), associatedAdultId: z.string().uuid().optional(), firstName: z.string().trim().min(1).max(50), lastName: z.string().trim().min(1).max(50), documentType: z.enum(['PASSPORT', 'NATIONAL_ID']), documentNumber: z.string().regex(/^[A-Za-z0-9]{5,20}$/), nationality: z.string().trim().min(2).max(3), documentExpiryDate: z.string().date().optional(), birthDate: z.string().date(), gender: z.enum(['M', 'F', 'X']), contact: z.object({ email: z.string().email(), phone: z.string().regex(/^\+[1-9]\d{1,14}$/) }).strict(), assignedSeats: z.array(z.object({ segmentId: z.string().uuid(), seatNumber: rpcString(4) }).strict()), extraBaggage: z.array(z.object({ itineraryId: z.string().uuid(), quantity: z.number().int().min(1).max(3) }).strict()) }).strict();
const createSchema = z.object({ holdId: z.string().uuid(), passengers: z.array(passengerSchema).min(1).max(9), payment: z.object({ paymentReference: rpcString(255) }).strict(), idempotencyKey: rpcString(255) }).strict();
const getSchema = z.object({ bookingId: z.string().uuid() }).strict();
const listSchema = z.object({ pnr: z.string().trim().length(6).optional(), page: z.object({ cursor: z.string().optional(), limit: z.number().int().min(1).max(50) }).strict().optional() }).strict();
const flightSchema = z.object({ flightInstanceId: z.string().uuid(), limit: z.number().int().min(1).max(50).optional(), cursor: z.string().uuid().optional() }).strict();
const resumeSchema = z.object({ limit: z.number().int().min(0).max(4294967295).optional() }).strict();
const baggageSchema = z.object({ bookingId: z.string().uuid(), passengerId: z.string().uuid(), itineraryId: z.string().uuid(), quantity: z.number().int().min(1).max(3), payment: z.object({ paymentReference: rpcString(255) }).strict(), idempotencyKey: z.string().uuid() }).strict();
const dateChangeSchema = z.object({ bookingId: z.string().uuid(), changes: z.array(z.object({ itineraryId: z.string().uuid(), newDepartureDate: z.string().date() }).strict()).min(1).max(6) }).strict();
const confirmChangeSchema = z.object({ bookingId: z.string().uuid(), changeOfferId: rpcString(128), payment: z.object({ paymentReference: rpcString(255) }).strict().optional(), assignedSeats: z.array(z.object({ segmentId: z.string().uuid(), seatNumber: rpcString(4) }).strict()).max(9), idempotencyKey: z.string().uuid() }).strict();
const cancelSchema = z.object({ bookingId: z.string().uuid(), quoteId: rpcString(128), reason: z.string().trim().max(255).optional(), idempotencyKey: z.string().uuid() }).strict();
const validationLogger = new Logger('ReservationValidation');
const requested = (data: unknown): unknown => { if (typeof data !== 'object' || data === null || Array.isArray(data)) return data; const { ownerId, ...body } = data as Record<string, unknown>; void ownerId; return body; };
const validate = (data: unknown, schema: z.AnyZodObject, rpc: string): Record<string, unknown> => {
  const parsed = schema.strict().safeParse(data);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.map(String).join('.')).filter(Boolean))];
    validationLogger.warn(`${rpc} validation failed fields=${fields.join(',') || '(root)'}`);
    throw new RpcException({ code: status.INVALID_ARGUMENT, details: 'VALIDATION_FAILED' });
  }
  return parsed.data;
};
const withOwner = (data: unknown, metadata: Metadata, schema: z.AnyZodObject, rpc: string): Record<string, unknown> => {
  const ownerId = (requestContextFromMetadata(metadata) as RequestContext | undefined)?.ownerId;
  if (!ownerId) throw new DomainError('NOT_FOUND');
  return { ...validate(requested(data), schema, rpc), ownerId };
};
const booking = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const changes = Array.isArray(record.changes) ? record.changes : [];
  const createdAt = changes[0] && typeof changes[0] === 'object' ? (changes[0] as Record<string, unknown>).changedAt : undefined;
  return { ...record, ...(typeof record.id === 'string' && !record.bookingId ? { bookingId: record.id } : {}), ...(!record.createdAt && typeof createdAt === 'string' ? { createdAt } : {}) };
};
const grpcResponse = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = booking(value) as Record<string, unknown>;
  return Array.isArray(record.items) ? { ...record, items: record.items.map(booking) } : record;
};
const unavailable = (): never => { throw new RpcException({ code: status.UNIMPLEMENTED, details: 'UNIMPLEMENTED' }); };
@Controller()
export class ReservationController {
  constructor(private readonly deps: ReservationHandlers) {}
  createReservation(data: unknown, metadata: Metadata) { return this.deps.createReservation ? this.deps.createReservation(withOwner(data, metadata, createSchema, 'CreateReservation')).then(grpcResponse) : unavailable(); }
  getReservation(data: unknown, metadata: Metadata) { return this.deps.getReservation ? this.deps.getReservation(withOwner(data, metadata, getSchema, 'GetReservation')).then(grpcResponse) : unavailable(); }
  listReservations(data: unknown, metadata: Metadata) { return this.deps.listReservations ? this.deps.listReservations(withOwner(data, metadata, listSchema, 'ListReservations')).then(grpcResponse) : unavailable(); }
  getReservationSnapshot(data: unknown, metadata: Metadata) { return this.deps.getReservationSnapshot ? this.deps.getReservationSnapshot(withOwner(data, metadata, getSchema, 'GetReservationSnapshot')).then(grpcResponse) : unavailable(); }
  listReservationsByFlightInstance(data: unknown, metadata: Metadata) { requireRole(requestContextFromMetadata(metadata) as RequestContext, 'system'); return this.deps.listReservationsByFlightInstance ? this.deps.listReservationsByFlightInstance(validate(data, flightSchema, 'ListReservationsByFlightInstance')).then(grpcResponse) : unavailable(); }
  getBaggageOptions(data: unknown, metadata: Metadata) { return this.deps.getBaggageOptions ? this.deps.getBaggageOptions(withOwner(data, metadata, getSchema, 'GetBaggageOptions')).then((options) => ({ options })) : unavailable(); }
  addBaggage(data: unknown, metadata: Metadata) { return this.deps.addBaggage ? this.deps.addBaggage(withOwner(data, metadata, baggageSchema, 'AddBaggage')) : unavailable(); }
  searchDateChange(data: unknown, metadata: Metadata) { return this.deps.searchDateChange ? this.deps.searchDateChange(withOwner(data, metadata, dateChangeSchema, 'SearchDateChange')).then((offers) => ({ offers })) : unavailable(); }
  confirmDateChange(data: unknown, metadata: Metadata) { return this.deps.confirmDateChange ? this.deps.confirmDateChange(withOwner(data, metadata, confirmChangeSchema, 'ConfirmDateChange')).then(grpcResponse) : unavailable(); }
  getCancellationQuote(data: unknown, metadata: Metadata) { return this.deps.getCancellationQuote ? this.deps.getCancellationQuote(withOwner(data, metadata, getSchema, 'GetCancellationQuote')) : unavailable(); }
  cancelReservation(data: unknown, metadata: Metadata) { return this.deps.cancelReservation ? this.deps.cancelReservation(withOwner(data, metadata, cancelSchema, 'CancelReservation')).then(grpcResponse) : unavailable(); }
  resumePending(data: unknown, metadata: Metadata) { requireRole(requestContextFromMetadata(metadata) as RequestContext, 'system'); return this.deps.resumePending ? this.deps.resumePending(validate(data, resumeSchema, 'ResumePending')) : unavailable(); }
}
const methods: Record<string, keyof ReservationController> = { CreateReservation: 'createReservation', GetReservation: 'getReservation', ListReservations: 'listReservations', GetReservationSnapshot: 'getReservationSnapshot', ListReservationsByFlightInstance: 'listReservationsByFlightInstance', GetBaggageOptions: 'getBaggageOptions', AddBaggage: 'addBaggage', SearchDateChange: 'searchDateChange', ConfirmDateChange: 'confirmDateChange', GetCancellationQuote: 'getCancellationQuote', CancelReservation: 'cancelReservation', ResumePending: 'resumePending' };
for (const [rpc, key] of Object.entries(methods)) GrpcMethod('ReservationService', rpc)(ReservationController.prototype, key, Object.getOwnPropertyDescriptor(ReservationController.prototype, key)!);
Inject(RESERVATION_DEPS)(ReservationController, undefined as unknown as string, 0);
