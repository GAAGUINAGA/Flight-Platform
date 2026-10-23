import { afterEach, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { ReservationQueries } from '../src/application/queries';
import { InMemoryReservationStore } from '../src/application/reservation-store';
import { GrpcAncillariesGateway, GrpcInventoryGateway, GrpcTicketingGateway } from '../src/infrastructure/clients/grpc-gateways';

const bookingId = 'booking';
const ownerId = 'owner';
const passengerId = 'passenger';
const input = { bookingId, ownerId };
const fixture = async (assignmentCode?: number, baggageCode?: number, ticketCode?: number) => {
  const store = new InMemoryReservationStore();
  await store.create({ id: bookingId, ownerId, pnr: 'ABC123', status: 'CONFIRMED', holdId: 'hold', paymentReference: 'pay_ok_secret', idempotencyKey: 'key', passengers: [{ passengerId }], itineraries: [], grandTotal: { currency: 'USD', total: '1.00' }, changes: [], attempts: 0 });
  const response = (code: number | undefined, value: unknown) => code === undefined ? of(value) : throwError(() => ({ code, details: 'secret@example.com +15551234567' }));
  const ancillaries = new GrpcAncillariesGateway(() => ({ getAssignments: () => response(assignmentCode, { assignments: [] }), getBaggageOptions: () => response(baggageCode, { options: [] }) }));
  const ticketing = new GrpcTicketingGateway(() => ({ listTickets: () => response(ticketCode, { tickets: [{ status: 'ISSUED' }] }) }));
  return new ReservationQueries(store, ancillaries, ticketing);
};
afterEach(() => jest.restoreAllMocks());

it('RSV-08: Ancillaries NOT_FOUND en ambas lecturas produce detalle vacío para el owner', async () => {
  const queries = await fixture(5, 5);
  const detail = await queries.get(input);
  expect(detail.passengers[0]).toMatchObject({ assignedSeats: [], extraBaggage: [] });
  expect(detail.tickets).toEqual([{ status: 'ISSUED' }]);
});

it.each([['getAssignments', 14, undefined], ['getBaggageOptions', undefined, 14]] as const)('RSV-08: Ancillaries %s UNAVAILABLE falla y registra dependencia y código sin PII', async (method, assignmentCode, baggageCode) => {
  const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const queries = await fixture(assignmentCode, baggageCode);
  await expect(queries.get(input)).rejects.toMatchObject({ code: 14 });
  expect(log).toHaveBeenCalledWith(`dependency=ancillaries operation=${method} code=14`);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|15551234567|owner|booking/);
});

it.each([5, 14])('RSV-08: Ticketing código %i falla y registra dependencia y código sin PII', async (code) => {
  const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const queries = await fixture(undefined, undefined, code);
  await expect(queries.get(input)).rejects.toMatchObject({ code });
  expect(log).toHaveBeenCalledWith(`dependency=ticketing operation=listTickets code=${code}`);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|15551234567|owner|booking/);
});

const failing = (code: number) => () => throwError(() => ({ code, details: 'secret@example.com +15551234567' }));
it.each([
  ['inventory', 'createHold', 14, (c: () => unknown) => new GrpcInventoryGateway(() => ({ createHold: c }) as never).createHold({ ownerId, segments: [], expiresAt: '', idempotencyKey: 'key' })],
  ['inventory', 'releaseReservedInventory', 4, (c: () => unknown) => new GrpcInventoryGateway(() => ({ releaseReservedInventory: c }) as never).releaseReservedInventory(input)],
  ['ancillaries', 'purchaseBaggage', 14, (c: () => unknown) => new GrpcAncillariesGateway(() => ({ purchaseBaggage: c }) as never).purchaseBaggage({ ...input, passengerId, itineraryId: 'it', quantity: 1, operationId: 'op' })],
  ['ticketing', 'voidTickets', 14, (c: () => unknown) => new GrpcTicketingGateway(() => ({ voidTickets: c }) as never).voidTickets(input)],
  ['ticketing', 'reissueTickets', 4, (c: () => unknown) => new GrpcTicketingGateway(() => ({ reissueTickets: c }) as never).reissueTickets({ ...input, newItineraries: [] })],
  ['ticketing', 'refundTickets', 14, (c: () => unknown) => new GrpcTicketingGateway(() => ({ refundTickets: c }) as never).refundTickets(input)]
] as const)('RSV-08: %s %s falla y registra dependencia y código sin PII', async (dependency, method, code, run) => {
  const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await expect(run(failing(code))).rejects.toMatchObject({ code });
  expect(log).toHaveBeenCalledWith(`dependency=${dependency} operation=${method} code=${code}`);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|15551234567|owner|booking/);
});

it('RSV-08: owner ajeno se rechaza antes de consultar dependencias', async () => {
  const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const queries = await fixture(14, 14, 14);
  await expect(queries.get({ bookingId, ownerId: 'other' })).rejects.toThrow('NOT_FOUND');
  expect(log).not.toHaveBeenCalled();
});
