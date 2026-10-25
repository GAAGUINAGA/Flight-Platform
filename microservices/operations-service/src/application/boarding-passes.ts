import { DomainError, validate } from '@flight-platform/shared';
import { z } from 'zod';
import { CheckInPass, CheckInReservationGateway, CheckInStore } from './check-in-ports';
import { FlightStore } from './ports';

const requestSchema = z.object({ bookingId: z.string().guid(), ownerId: z.string().trim().min(1).max(128) }).strict();

export class ListBoardingPasses {
  constructor(private readonly reservations: CheckInReservationGateway, private readonly flights: FlightStore, private readonly store: CheckInStore) {}

  async execute(input: unknown): Promise<{ bookingId: string; boardingPasses: CheckInPass[] }> {
    const request = validate(requestSchema, input);
    const snapshot = await this.reservations.getSnapshot(request.ownerId, request.bookingId);
    if (snapshot.bookingId !== request.bookingId) throw new DomainError('NOT_FOUND');
    if (snapshot.status !== 'CONFIRMED') throw new DomainError('BOARDING_PASS_NOT_AVAILABLE');
    const saved = await this.store.listPasses(request.ownerId, request.bookingId);
    const segments = snapshot.itineraries.flatMap((itinerary) => itinerary.segments);
    const passengers = new Set(snapshot.passengers.map((passenger) => passenger.passengerId));
    const boardingPasses: CheckInPass[] = [];
    for (const pass of saved) {
      const segment = segments.find((value) => value.segmentId === pass.segmentId);
      if (!segment || !passengers.has(pass.passengerId)) continue;
      const flight = await this.flights.findByInstance(segment.flightInstanceId);
      const status = flight?.props.status ?? segment.status;
      if (status === 'CANCELLED' || status === 'DEPARTED' || status === 'ARRIVED' || status === 'DIVERTED') continue;
      boardingPasses.push(pass);
    }
    if (!boardingPasses.length) throw new DomainError('BOARDING_PASS_NOT_AVAILABLE');
    return { bookingId: request.bookingId, boardingPasses };
  }
}
