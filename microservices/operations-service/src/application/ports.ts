import { OperationalFlight } from '../domain/operational-flight';
export class DependencyUnavailable extends Error {}
export class InventoryUnavailable extends DependencyUnavailable {}
export interface InventoryFlight { flightInstanceId:string; flightNumber:string; departure:{iataCode:string;at:string}; arrival:{iataCode:string;at:string}; marketingCarrier:string; operatingCarrier:string; aircraft?:string }
export interface InventoryGateway { findFlight(input:{flightNumber:string; date:string}):Promise<InventoryFlight>; closeFlightInstance(id:string):Promise<void>; getFlight(flightInstanceId:string):Promise<InventoryFlight> }
export interface ReservationGateway { listByFlightInstance(id:string):Promise<Array<{bookingId:string;ownerId:string;pnr?:string}>> }
export interface EventPublisher { publish(input:{ownerId:string; eventType:'flight.cancelled'|'flight.schedule_changed'|'booking.checked_in'; bookingId:string; pnr?:string; occurredAt:string}):Promise<void> }
export interface FlightStore { find(flightNumber:string,date:string):Promise<OperationalFlight|null>; findByInstance(id:string):Promise<OperationalFlight|null>; save(flight:OperationalFlight):Promise<void>; update(flight:OperationalFlight, data:Record<string,unknown>):Promise<void> }
