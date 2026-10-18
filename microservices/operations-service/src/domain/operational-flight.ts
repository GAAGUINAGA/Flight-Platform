import { DomainError } from '@flight-platform/shared';
export type OperationalStatus = 'SCHEDULED'|'BOARDING'|'DELAYED'|'DEPARTED'|'ARRIVED'|'CANCELLED'|'DIVERTED';
const allowed: Record<OperationalStatus, OperationalStatus[]> = { SCHEDULED:['BOARDING','DELAYED','CANCELLED'], BOARDING:['DELAYED','DEPARTED'], DELAYED:['BOARDING','CANCELLED'], DEPARTED:['ARRIVED','DIVERTED'], ARRIVED:[], CANCELLED:[], DIVERTED:[] };
export class OperationalFlight {
  constructor(readonly props: { id:string; flightInstanceId:string; flightNumber:string; date:string; marketingCarrier:string; operatingCarrier:string; departureIata:string; arrivalIata:string; scheduledDepartureAt:Date; scheduledArrivalAt:Date; aircraft?:string; status:OperationalStatus; estimatedDepartureAt?:Date; actualDepartureAt?:Date; estimatedArrivalAt?:Date; actualArrivalAt?:Date; departureTerminal?:string; arrivalTerminal?:string; cancellationClosed?:boolean; cancellationNotified?:boolean; notifiedDepartureAt?:Date }) {}
  transition(status: OperationalStatus): void { if (status !== this.props.status && !allowed[this.props.status].includes(status)) throw new DomainError('VALIDATION_FAILED'); this.props.status = status; }
  delayMinutes(): number { return this.props.estimatedDepartureAt ? Math.floor((this.props.estimatedDepartureAt.getTime()-this.props.scheduledDepartureAt.getTime())/60000) : 0; }
}
