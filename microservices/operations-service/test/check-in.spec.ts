import { DomainError } from '@flight-platform/shared';
import { CheckInUseCase } from '../src/application/check-in';
import { CheckInPass, CheckInResult, CheckInStore } from '../src/application/check-in-ports';
import { FlightStore } from '../src/application/ports';

const bookingId = '00000000-0000-4000-8000-000000000001';
const segmentId = '00000000-0000-4000-8000-000000000002';
const flightId = '00000000-0000-4000-8000-000000000003';
const passengerId = '00000000-0000-4000-8000-000000000004';
const failedPassenger = '00000000-0000-4000-8000-000000000005';
const ownerId = 'owner';

class MemoryStore implements CheckInStore {
  result: CheckInResult | null = null;
  begun = false;
  passes: CheckInPass[] = [];
  async find(owner: string, booking: string) { return this.begun && owner === ownerId && booking === bookingId ? { status: this.result?.status ?? 'IN_PROGRESS', result: this.result } : null; }
  async begin() { if (this.begun) return false; this.begun = true; return true; }
  async resume() { return this.begun; }
  async savePass(owner: string, booking: string, pass: CheckInPass) { void owner; void booking; this.passes.push(pass); }
  async complete(owner: string, result: CheckInResult) { void owner; this.result = result; }
  async abort() { this.begun = false; this.result = null; this.passes = []; }
  async restore(owner: string, result: CheckInResult) { void owner; this.result = result; this.passes = this.passes.filter((pass) => result.checkedInPassengers.some((passenger) => passenger.passengerId === pass.passengerId && passenger.segments.some((segment) => segment.segmentId === pass.segmentId && segment.status === 'CHECKED_IN'))); }
  async listPasses(owner: string, booking: string) { return owner === ownerId && booking === bookingId ? this.passes : []; }
}

describe('DCS-03 / DCS-05: check-in', () => {
  it('DCS-SEC-02: el QR no contiene documento, correo ni teléfono', async () => {
    const store = new MemoryStore();
    const snapshot = { bookingId, pnr: 'ABC123', status: 'CONFIRMED', passengers: [{ passengerId, passengerType: 'ADULT' as const, documentType: 'NATIONAL_ID', documentNumber: 'DOC-SECRET', contact: { email: 'private@example.test', phone: '+15551234567' } }], itineraries: [{ itineraryId: 'i', segments: [{ segmentId, flightInstanceId: flightId, flightNumber: 'FP101', departure: { at: '2026-10-20T12:00:00.000Z' } }], pricingOptions: [{ cabinClass: 'ECONOMY' }] }] };
    const useCase = new CheckInUseCase({ getSnapshot: async () => snapshot }, { getCoupons: async () => [{ passengerId, segmentId, status: 'ISSUED' }] }, { assign: async () => ({ seatNumber: '12A', status: 'CHECKED_IN' }) }, { find: async () => null, findByInstance: async () => null, save: async () => undefined, update: async () => undefined }, store, { publish: async () => undefined }, () => new Date('2026-10-19T12:00:00.000Z'), 48, 60);
    await useCase.execute({ ownerId, bookingId });
    const barcode = store.passes.find((value) => value.passengerId === passengerId)?.barcode;
    expect(barcode).toEqual(expect.stringMatching(/^M1\//));
    for (const privateValue of ['DOC-SECRET', 'private@example.test', '+15551234567']) expect(barcode).not.toContain(privateValue);
  });
  it('DCS-03: resultado mixto completo, pase QR y evento sin datos de contacto', async () => {
    const store = new MemoryStore();
    const snapshot = { bookingId, pnr: 'ABC123', status: 'CONFIRMED', passengers: [{ passengerId, passengerType: 'ADULT' as const, documentType: 'NATIONAL_ID', documentNumber: 'DOC123456', contact: { email: 'private@example.test', phone: '+15551234567' } }, { passengerId: failedPassenger, passengerType: 'ADULT' as const, documentType: 'NATIONAL_ID' }], itineraries: [{ itineraryId: 'i', segments: [{ segmentId, flightInstanceId: flightId, flightNumber: 'FP101', departure: { at: '2026-10-20T12:00:00.000Z' } }], pricingOptions: [{ cabinClass: 'ECONOMY' }] }] };
    const assign = jest.fn(async () => ({ seatNumber: '12A', status: 'CHECKED_IN' }));
    const publish = jest.fn(async () => undefined);
    const flights: FlightStore = { find: async () => null, findByInstance: async () => null, save: async () => undefined, update: async () => undefined };
    const useCase = new CheckInUseCase({ getSnapshot: async () => snapshot }, { getCoupons: async () => [{ passengerId, segmentId, status: 'ISSUED' }] }, { assign }, flights, store, { publish }, () => new Date('2026-10-19T12:00:00.000Z'), 48, 60);
    const request = { ownerId, bookingId };
    const result = await useCase.execute(request);
    expect(result).toMatchObject({ bookingId, status: 'COMPLETED', checkedInPassengers: [{ passengerId, status: 'CHECKED_IN', segments: [{ segmentId, seat: '12A', status: 'CHECKED_IN' }] }, { passengerId: failedPassenger, status: 'FAILED', segments: [{ segmentId, status: 'FAILED' }] }] });
    expect(store.passes).toEqual([expect.objectContaining({ passengerId, segmentId, seat: '12A', barcodeType: 'QR' })]);
    const barcode = store.passes.find((pass) => pass.passengerId === passengerId)?.barcode;
    expect(barcode).toEqual(expect.stringMatching(/^M1\//));
    expect(barcode).not.toContain('DOC123456');
    expect(barcode).not.toContain('private@example.test');
    expect(barcode).not.toContain('+15551234567');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ ownerId, bookingId, eventType: 'booking.checked_in' }));
    expect(await useCase.execute(request)).toEqual(result);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('DCS-SEC-01: owner ajeno no provoca efectos', async () => {
    const store = new MemoryStore();
    const assign = jest.fn(async () => ({ seatNumber: '12A', status: 'CHECKED_IN' }));
    const publish = jest.fn(async () => undefined);
    const useCase = new CheckInUseCase({ getSnapshot: async () => { throw new DomainError('NOT_FOUND'); } }, { getCoupons: async () => [] }, { assign }, { find: async () => null, findByInstance: async () => null, save: async () => undefined, update: async () => undefined }, store, { publish }, () => new Date('2026-10-19T12:00:00.000Z'), 48, 60);
    await expect(useCase.execute({ ownerId: 'other', bookingId })).rejects.toThrow('NOT_FOUND');
    expect(store.begun).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('DCS-03: infante comparte el asiento del adulto sin reservar uno adicional', async () => {
    const store = new MemoryStore();
    const infantId = '00000000-0000-4000-8000-000000000006';
    const snapshot = { bookingId, pnr: 'ABC123', status: 'CONFIRMED', passengers: [{ passengerId: infantId, passengerType: 'INFANT' as const, associatedAdultId: passengerId, documentType: 'NATIONAL_ID' }, { passengerId, passengerType: 'ADULT' as const, documentType: 'NATIONAL_ID' }], itineraries: [{ itineraryId: 'i', segments: [{ segmentId, flightInstanceId: flightId, flightNumber: 'FP101', departure: { at: '2026-10-20T12:00:00.000Z' } }], pricingOptions: [{ cabinClass: 'ECONOMY' }] }] };
    const assign = jest.fn(async () => ({ seatNumber: '12A', status: 'CHECKED_IN' }));
    const useCase = new CheckInUseCase({ getSnapshot: async () => snapshot }, { getCoupons: async () => [{ passengerId, segmentId, status: 'ISSUED' }, { passengerId: infantId, segmentId, status: 'ISSUED' }] }, { assign }, { find: async () => null, findByInstance: async () => null, save: async () => undefined, update: async () => undefined }, store, { publish: async () => undefined }, () => new Date('2026-10-19T12:00:00.000Z'), 48, 60);
    const result = await useCase.execute({ ownerId, bookingId });
    expect(result.checkedInPassengers).toEqual(expect.arrayContaining([expect.objectContaining({ passengerId: infantId, status: 'CHECKED_IN', segments: [expect.objectContaining({ segmentId, seat: '12A' })] })]));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(store.passes.find((pass) => pass.passengerId === infantId)).toMatchObject({ seat: '12A' });
  });

  it('DCS-05: un fallo de publicación permite reintentar el check-in', async () => {
    const store = new MemoryStore();
    const snapshot = { bookingId, pnr: 'ABC123', status: 'CONFIRMED', passengers: [{ passengerId, passengerType: 'ADULT' as const, documentType: 'NATIONAL_ID' }], itineraries: [{ itineraryId: 'i', segments: [{ segmentId, flightInstanceId: flightId, flightNumber: 'FP101', departure: { at: '2026-10-20T12:00:00.000Z' } }], pricingOptions: [{ cabinClass: 'ECONOMY' }] }] };
    const publish = jest.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(undefined);
    const useCase = new CheckInUseCase({ getSnapshot: async () => snapshot }, { getCoupons: async () => [{ passengerId, segmentId, status: 'ISSUED' }] }, { assign: async () => ({ seatNumber: '12A', status: 'CHECKED_IN' }) }, { find: async () => null, findByInstance: async () => null, save: async () => undefined, update: async () => undefined }, store, { publish }, () => new Date('2026-10-19T12:00:00.000Z'), 48, 60);
    await expect(useCase.execute({ ownerId, bookingId })).rejects.toThrow('temporary');
    expect(store.begun).toBe(false);
    await expect(useCase.execute({ ownerId, bookingId })).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(store.passes).toHaveLength(1);
  });

  it('DCS-03: solo procesa segmentos que están dentro de su ventana', async () => {
    const store = new MemoryStore();
    const laterSegment = '00000000-0000-4000-8000-000000000007';
    const snapshot = { bookingId, pnr: 'ABC123', status: 'CONFIRMED', passengers: [{ passengerId, passengerType: 'ADULT' as const, documentType: 'NATIONAL_ID' }], itineraries: [{ itineraryId: 'i', segments: [{ segmentId, flightInstanceId: flightId, flightNumber: 'FP101', departure: { at: '2026-10-20T12:00:00.000Z' } }, { segmentId: laterSegment, flightInstanceId: '00000000-0000-4000-8000-000000000008', flightNumber: 'FP102', departure: { at: '2026-10-24T12:00:00.000Z' } }], pricingOptions: [{ cabinClass: 'ECONOMY' }] }] };
    const assign = jest.fn(async () => ({ seatNumber: '12A', status: 'CHECKED_IN' }));
    let now = new Date('2026-10-19T12:00:00.000Z');
    const useCase = new CheckInUseCase({ getSnapshot: async () => snapshot }, { getCoupons: async () => [{ passengerId, segmentId, status: 'ISSUED' }, { passengerId, segmentId: laterSegment, status: 'ISSUED' }] }, { assign }, { find: async () => null, findByInstance: async () => null, save: async () => undefined, update: async () => undefined }, store, { publish: async () => undefined }, () => now, 48, 60);
    const result = await useCase.execute({ ownerId, bookingId });
    expect(result.checkedInPassengers).toEqual([expect.objectContaining({ passengerId, segments: expect.arrayContaining([expect.objectContaining({ segmentId, status: 'CHECKED_IN' }), expect.objectContaining({ segmentId: laterSegment, status: 'NOT_CHECKED_IN' })]) })]);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(expect.objectContaining({ segmentId }));
    now = new Date('2026-10-22T12:00:00.000Z');
    const later = await useCase.execute({ ownerId, bookingId });
    expect(later.checkedInPassengers).toEqual([expect.objectContaining({ passengerId, segments: expect.arrayContaining([expect.objectContaining({ segmentId, status: 'CHECKED_IN' }), expect.objectContaining({ segmentId: laterSegment, status: 'CHECKED_IN' })]) })]);
    expect(assign).toHaveBeenCalledTimes(2);
    expect(assign).toHaveBeenCalledWith(expect.objectContaining({ segmentId: laterSegment }));
  });
});
