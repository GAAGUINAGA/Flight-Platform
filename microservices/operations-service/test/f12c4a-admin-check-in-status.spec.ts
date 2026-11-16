import { describe, expect, it } from '@jest/globals';
import { of } from 'rxjs';
import { Metadata } from '@grpc/grpc-js';
import { InternalKeyInterceptor } from '@flight-platform/shared';
import { AdminCheckInStatus, CheckInStatusReader } from '../src/application/admin-check-in-status';
import { CheckInResult } from '../src/application/check-in-ports';
import { OperationsController } from '../src/infrastructure/grpc/operations.controller';

/** F12c-4a (ADR-F12c4-01): estado del check-in por reserva, solo lectura, rol admin, sin dueño de entrada. */
const BOOKING = '11111111-1111-4111-8111-111111111111'; const OTHER = '22222222-2222-4222-8222-222222222222'; const KEY = 'k'.repeat(32);
const result: CheckInResult = { bookingId: BOOKING, status: 'COMPLETED', checkedInPassengers: [{ passengerId: 'p1', status: 'CHECKED_IN', segments: [{ segmentId: 's1', seat: '12A', status: 'CHECKED_IN' }, { segmentId: 's2', status: 'NOT_CHECKED_IN' }] }] };
class Memory implements CheckInStatusReader {
  calls: string[] = [];
  async findByBooking(bookingId: string) { this.calls.push(bookingId); return bookingId === BOOKING ? { status: 'COMPLETED', result: { ...result, barcode: 'M1/secreto' } as CheckInResult } : null; }
}

describe('F12c-4a: AdminCheckInStatus', () => {
  it('OPS-ADM-01: devuelve el estado por pasajero y tramo, con el asiento, y nada más (sin códigos de barras)', async () => {
    const view = await new AdminCheckInStatus(new Memory()).execute({ bookingId: BOOKING });
    expect(view).toEqual({ bookingId: BOOKING, status: 'COMPLETED', passengers: [{ passengerId: 'p1', status: 'CHECKED_IN', segments: [{ segmentId: 's1', status: 'CHECKED_IN', seat: '12A' }, { segmentId: 's2', status: 'NOT_CHECKED_IN' }] }] });
    expect(JSON.stringify(view)).not.toContain('M1/');
  });
  it('OPS-ADM-02: una reserva sin check-in es NOT_STARTED (no es un error)', async () => {
    await expect(new AdminCheckInStatus(new Memory()).execute({ bookingId: OTHER })).resolves.toEqual({ bookingId: OTHER, status: 'NOT_STARTED', passengers: [] });
  });
  it('OPS-ADM-03: valida la entrada: bookingId UUID, sin dueño ni campos extra', async () => {
    const reader = new Memory(); const useCase = new AdminCheckInStatus(reader);
    for (const bad of [{ bookingId: 'x' }, { bookingId: BOOKING, ownerId: 'otro' }, {}, { bookingId: BOOKING, extra: 1 }]) await expect(useCase.execute(bad)).rejects.toThrow('Rpc Exception');
    expect(reader.calls).toEqual([]);
  });
});

const metadata = async (role?: string): Promise<Metadata> => {
  const value = new Metadata(); value.set('x-internal-key', KEY); value.set('x-owner-id', 'sub-1'); if (role) value.set('x-role', role);
  await new Promise((resolve) => new InternalKeyInterceptor(KEY).intercept({ switchToRpc: () => ({ getContext: () => value }) } as never, { handle: () => of(null) }).subscribe({ complete: () => resolve(null) }));
  return value;
};
describe('F12c-4a: el controlador de AdminGetCheckInStatus', () => {
  const controller = (reader = new Memory()) => new OperationsController({ adminCheckInStatus: new AdminCheckInStatus(reader), validateResponse: () => undefined } as never);
  it.each([['customer'], ['partner'], ['system'], [undefined]])('OPS-ADM-04: el rol %s ⇒ PERMISSION_DENIED y no se consulta nada', async (role) => {
    const reader = new Memory();
    await expect(Promise.resolve().then(async () => controller(reader).adminGetCheckInStatus({ bookingId: BOOKING }, await metadata(role)))).rejects.toMatchObject({ error: { code: 7 } });
    expect(reader.calls).toEqual([]);
  });
  it('OPS-ADM-05: el rol admin lo lee sin importar quién es el dueño (el esquema no lo admite)', async () => {
    await expect(controller().adminGetCheckInStatus({ bookingId: BOOKING }, await metadata('admin'))).resolves.toMatchObject({ status: 'COMPLETED' });
    await expect(controller().adminGetCheckInStatus({ bookingId: BOOKING, ownerId: 'x' }, await metadata('admin'))).rejects.toThrow();
  });
});
