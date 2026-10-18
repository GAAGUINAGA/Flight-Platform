import { DomainError, validate } from '@flight-platform/shared';
import { OperationalFlight } from '../domain/operational-flight'; import { EventPublisher, FlightStore, InventoryGateway, ReservationGateway } from './ports'; import { getFlightStatusSchema, updateSchema } from './schemas';
export class FlightStatusUseCases {
 constructor(private readonly store:FlightStore,private readonly inventory:InventoryGateway,private readonly reservations:ReservationGateway,private readonly events:EventPublisher,private readonly delayThresholdMinutes:number) {}
 async get(input:unknown):Promise<OperationalFlight>{ const q=validate(getFlightStatusSchema,input); const existing=await this.store.find(q.flightNumber,q.date); if(existing)return existing; let f; try { f=await this.inventory.findFlight({flightNumber:q.flightNumber,date:q.date}); } catch (error) { if (error instanceof DomainError && error.code==='NOT_FOUND') throw new DomainError('FLIGHT_STATUS_NOT_AVAILABLE'); throw error; } const v=new OperationalFlight({id:'',flightInstanceId:f.flightInstanceId,flightNumber:f.flightNumber,date:q.date,marketingCarrier:f.marketingCarrier,operatingCarrier:f.operatingCarrier,departureIata:f.departure.iataCode,arrivalIata:f.arrival.iataCode,scheduledDepartureAt:new Date(f.departure.at),scheduledArrivalAt:new Date(f.arrival.at),aircraft:f.aircraft,status:'SCHEDULED'}); await this.store.save(v); return v; }
 async update(input:unknown):Promise<OperationalFlight>{
   const q=validate(updateSchema,input); const f=await this.store.findByInstance(q.flightInstanceId); if(!f) throw new DomainError('FLIGHT_STATUS_NOT_AVAILABLE');
   f.transition(q.status);
   const data={ ...(q.estimatedDepartureAt!==undefined?{estimatedDepartureAt:new Date(q.estimatedDepartureAt)}:{}),...(q.actualDepartureAt!==undefined?{actualDepartureAt:new Date(q.actualDepartureAt)}:{}),...(q.estimatedArrivalAt!==undefined?{estimatedArrivalAt:new Date(q.estimatedArrivalAt)}:{}),...(q.actualArrivalAt!==undefined?{actualArrivalAt:new Date(q.actualArrivalAt)}:{}),...(q.departureTerminal!==undefined?{departureTerminal:q.departureTerminal}:{}),...(q.arrivalTerminal!==undefined?{arrivalTerminal:q.arrivalTerminal}:{}) };
   Object.assign(f.props,data); await this.store.update(f,data);
   const cancelled=f.props.status==='CANCELLED';
   if(cancelled&&!f.props.cancellationClosed){await this.inventory.closeFlightInstance(f.props.flightInstanceId);f.props.cancellationClosed=true;await this.store.update(f,{})}
   const scheduleChanged=!cancelled&&f.delayMinutes()>=this.delayThresholdMinutes&&f.props.estimatedDepartureAt?.getTime()!==f.props.notifiedDepartureAt?.getTime();
   if((cancelled&&!f.props.cancellationNotified)||scheduleChanged){const bookings=await this.reservations.listByFlightInstance(f.props.flightInstanceId);await Promise.all(bookings.map(b=>this.events.publish({ownerId:b.ownerId,bookingId:b.bookingId,pnr:b.pnr,eventType:cancelled?'flight.cancelled':'flight.schedule_changed',occurredAt:new Date().toISOString()})));if(cancelled)f.props.cancellationNotified=true;else f.props.notifiedDepartureAt=f.props.estimatedDepartureAt;await this.store.update(f,{})}
   return f;
 }
}
