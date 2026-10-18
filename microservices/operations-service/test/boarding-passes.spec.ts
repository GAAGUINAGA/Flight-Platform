import { ListBoardingPasses } from '../src/application/boarding-passes';
import { CheckInPass, CheckInSnapshot, CheckInStore } from '../src/application/check-in-ports';
import { FlightStore } from '../src/application/ports';

const bookingId = '00000000-0000-4000-8000-000000000001';
const passengerId = '00000000-0000-4000-8000-000000000002';
const segmentId = '00000000-0000-4000-8000-000000000003';
const flightInstanceId = '00000000-0000-4000-8000-000000000004';
const pass: CheckInPass = { passengerId, segmentId, seat: '12A', barcode: 'M1/opaque/12A', barcodeType: 'QR' };
const snapshot = (): CheckInSnapshot => ({ bookingId, pnr: 'ABC123', status: 'CONFIRMED', passengers: [{ passengerId, passengerType: 'ADULT', documentType: 'NATIONAL_ID' }], itineraries: [{ itineraryId: 'i', segments: [{ segmentId, flightInstanceId, flightNumber: 'FP101', departure: { at: '2026-10-20T12:00:00Z' } }], pricingOptions: [{ cabinClass: 'ECONOMY' }] }] });

describe('DCS-04: revalidación de pases', () => {
  it('DCS-04: exige reserva confirmada antes de leer los pases', async () => {
    const current = snapshot(); current.status = 'CANCELLED';
    const listPasses = jest.fn(async () => [pass]);
    const useCase = new ListBoardingPasses({ getSnapshot: async () => current }, {} as FlightStore, { listPasses } as unknown as CheckInStore);
    await expect(useCase.execute({ ownerId: 'owner', bookingId })).rejects.toThrow('BOARDING_PASS_NOT_AVAILABLE');
    expect(listPasses).not.toHaveBeenCalled();
  });

  it('DCS-04: excluye segmentos cancelados o pasajeros ausentes del snapshot', async () => {
    const current = snapshot(); current.itineraries.find(() => true)!.segments.find(() => true)!.status = 'CANCELLED';
    const listPasses = jest.fn(async () => [pass, { ...pass, passengerId: '00000000-0000-4000-8000-000000000005' }]);
    const useCase = new ListBoardingPasses({ getSnapshot: async () => current }, { findByInstance: async () => null } as unknown as FlightStore, { listPasses } as unknown as CheckInStore);
    await expect(useCase.execute({ ownerId: 'owner', bookingId })).rejects.toThrow('BOARDING_PASS_NOT_AVAILABLE');
    expect(listPasses).toHaveBeenCalledWith('owner', bookingId);
  });
});
