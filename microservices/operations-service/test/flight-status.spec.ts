import { FlightStatusUseCases } from '../src/application/flight-status'; import { FlightStore,InventoryGateway } from '../src/application/ports'; import { OperationalFlight } from '../src/domain/operational-flight';
import { DomainError } from '@flight-platform/shared';
import { InventoryUnavailable } from '../src/application/ports';
class Store implements FlightStore { values:OperationalFlight[]=[]; async find(n:string,d:string){return this.values.find(x=>x.props.flightNumber===n&&x.props.date===d)??null} async findByInstance(id:string){return this.values.find(x=>x.props.flightInstanceId===id)??null} async save(x:OperationalFlight){x.props.id='1';this.values.push(x)} async update(){}}
describe('OPS-04/OPS-05',()=>{it('OPS-04: crea el estado perezosamente desde Inventory',async()=>{const s=new Store();const inventory:InventoryGateway={findFlight:async()=>({flightInstanceId:'00000000-0000-0000-0000-000000000001',flightNumber:'FP101',departure:{iataCode:'UIO',at:'2026-10-11T10:00:00Z'},arrival:{iataCode:'BOG',at:'2026-10-11T11:00:00Z'},marketingCarrier:'FP',operatingCarrier:'FP'}),closeFlightInstance:async()=>{}};const u=new FlightStatusUseCases(s,inventory,{listByFlightInstance:async()=>[]},{publish:async()=>{}},15);expect((await u.get({flightNumber:'FP101',date:'2026-10-11'})).props.status).toBe('SCHEDULED')});it('OPS-05: publica cambios desde quince minutos',async()=>{const s=new Store();await s.save(new OperationalFlight({id:'',flightInstanceId:'00000000-0000-0000-0000-000000000001',flightNumber:'FP101',date:'2026-10-11',marketingCarrier:'FP',operatingCarrier:'FP',departureIata:'UIO',arrivalIata:'BOG',scheduledDepartureAt:new Date('2026-10-11T10:00:00Z'),scheduledArrivalAt:new Date('2026-10-11T11:00:00Z'),status:'SCHEDULED'}));const events:string[]=[];const u=new FlightStatusUseCases(s,{findFlight:async()=>{throw new Error()},closeFlightInstance:async()=>{}},{listByFlightInstance:async()=>[{bookingId:'b',ownerId:'o'}]},{publish:async e=>{events.push(e.eventType)}},15);await u.update({flightInstanceId:'00000000-0000-0000-0000-000000000001',status:'DELAYED',estimatedDepartureAt:'2026-10-11T10:15:00.000Z'});expect(events).toHaveLength(1)})});

describe('OPS-04/OPS-05: errores e idempotencia', () => {
  const request = { flightNumber: 'FP101', date: '2026-10-11' };
  const make = (error: Error) => new FlightStatusUseCases(new Store(), { findFlight: async () => { throw error; }, closeFlightInstance: async () => undefined }, { listByFlightInstance: async () => [] }, { publish: async () => undefined }, 15);
  it('OPS-04: un vuelo inexistente devuelve FLIGHT_STATUS_NOT_AVAILABLE', async () => {
    await expect(make(new DomainError('NOT_FOUND')).get(request)).rejects.toMatchObject({ code: 'FLIGHT_STATUS_NOT_AVAILABLE' });
  });
  it('OPS-04: Inventory no disponible conserva UNAVAILABLE', async () => {
    await expect(make(new InventoryUnavailable()).get(request)).rejects.toBeInstanceOf(InventoryUnavailable);
  });
  it('OPS-05: repetir cancelación no vuelve a cerrar ni publicar', async () => {
    const store = new Store();
    await store.save(new OperationalFlight({ id: '', flightInstanceId: '00000000-0000-0000-0000-000000000001', flightNumber: 'FP101', date: '2026-10-11', marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: 'UIO', arrivalIata: 'BOG', scheduledDepartureAt: new Date('2026-10-11T10:00:00Z'), scheduledArrivalAt: new Date('2026-10-11T11:00:00Z'), status: 'SCHEDULED' }));
    const closeFlightInstance = jest.fn(async () => undefined);
    const publish = jest.fn(async () => undefined);
    const useCases = new FlightStatusUseCases(store, { findFlight: async () => { throw new Error(); }, closeFlightInstance }, { listByFlightInstance: async () => [{ bookingId: 'b', ownerId: 'o' }] }, { publish }, 15);
    const update = { flightInstanceId: '00000000-0000-0000-0000-000000000001', status: 'CANCELLED' };
    await useCases.update(update); await useCases.update(update);
    expect(closeFlightInstance).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'flight.cancelled' }));
  });
  it('OPS-05: repetir el mismo horario de retraso no vuelve a publicar', async () => {
    const store = new Store();
    await store.save(new OperationalFlight({ id: '', flightInstanceId: '00000000-0000-0000-0000-000000000001', flightNumber: 'FP101', date: '2026-10-11', marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: 'UIO', arrivalIata: 'BOG', scheduledDepartureAt: new Date('2026-10-11T10:00:00Z'), scheduledArrivalAt: new Date('2026-10-11T11:00:00Z'), status: 'SCHEDULED' }));
    const publish = jest.fn(async () => undefined);
    const useCases = new FlightStatusUseCases(store, { findFlight: async () => { throw new Error(); }, closeFlightInstance: async () => undefined }, { listByFlightInstance: async () => [{ bookingId: 'b', ownerId: 'o' }] }, { publish }, 15);
    const update = { flightInstanceId: '00000000-0000-0000-0000-000000000001', status: 'DELAYED', estimatedDepartureAt: '2026-10-11T10:15:00.000Z' };
    await useCases.update(update); await useCases.update(update);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'flight.schedule_changed' }));
  });
  it('OPS-05: si falla el cierre de Inventory, el reintento vuelve a intentarlo', async () => {
    const store = new Store();
    await store.save(new OperationalFlight({ id: '', flightInstanceId: '00000000-0000-0000-0000-000000000001', flightNumber: 'FP101', date: '2026-10-11', marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: 'UIO', arrivalIata: 'BOG', scheduledDepartureAt: new Date('2026-10-11T10:00:00Z'), scheduledArrivalAt: new Date('2026-10-11T11:00:00Z'), status: 'SCHEDULED' }));
    const closeFlightInstance = jest.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(undefined);
    const publish = jest.fn(async () => undefined);
    const useCases = new FlightStatusUseCases(store, { findFlight: async () => { throw new Error(); }, closeFlightInstance }, { listByFlightInstance: async () => [{ bookingId: 'b', ownerId: 'o' }] }, { publish }, 15);
    const request = { flightInstanceId: '00000000-0000-0000-0000-000000000001', status: 'CANCELLED' };
    await expect(useCases.update(request)).rejects.toThrow('unavailable');
    await useCases.update(request);
    expect(closeFlightInstance).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it('OPS-05: si falla la publicación, el reintento no vuelve a cerrar el vuelo', async () => {
    const store = new Store();
    await store.save(new OperationalFlight({ id: '', flightInstanceId: '00000000-0000-0000-0000-000000000001', flightNumber: 'FP101', date: '2026-10-11', marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: 'UIO', arrivalIata: 'BOG', scheduledDepartureAt: new Date('2026-10-11T10:00:00Z'), scheduledArrivalAt: new Date('2026-10-11T11:00:00Z'), status: 'SCHEDULED' }));
    const closeFlightInstance = jest.fn(async () => undefined);
    const publish = jest.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(undefined);
    const useCases = new FlightStatusUseCases(store, { findFlight: async () => { throw new Error(); }, closeFlightInstance }, { listByFlightInstance: async () => [{ bookingId: 'b', ownerId: 'o' }] }, { publish }, 15);
    const request = { flightInstanceId: '00000000-0000-0000-0000-000000000001', status: 'CANCELLED' };
    await expect(useCases.update(request)).rejects.toThrow('unavailable');
    await useCases.update(request);
    expect(closeFlightInstance).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(2);
  });
});

describe('OPS-P6: puerta y motivo del cambio de estado', () => {
  const id = '00000000-0000-0000-0000-000000000001';
  const seeded = async () => { const store = new Store(); await store.save(new OperationalFlight({ id: '', flightInstanceId: id, flightNumber: 'FP101', date: '2026-10-11', marketingCarrier: 'FP', operatingCarrier: 'FP', departureIata: 'UIO', arrivalIata: 'BOG', scheduledDepartureAt: new Date('2026-10-11T10:00:00Z'), scheduledArrivalAt: new Date('2026-10-11T11:00:00Z'), status: 'SCHEDULED' })); return store; };
  const make = (store: Store) => new FlightStatusUseCases(store, { findFlight: async () => { throw new Error(); }, closeFlightInstance: async () => undefined }, { listByFlightInstance: async () => [] }, { publish: async () => undefined }, 15);
  it('OPS-P6-01: departureGate y reason se guardan en el vuelo y en el registro de la actualización', async () => {
    const store = await seeded(); const update = jest.spyOn(store, 'update'); const flight = await make(store).update({ flightInstanceId: id, status: 'BOARDING', departureGate: 'A6', reason: 'Embarque anticipado' });
    expect(flight.props).toMatchObject({ status: 'BOARDING', departureGate: 'A6', statusReason: 'Embarque anticipado' }); expect(update).toHaveBeenCalledWith(flight, expect.objectContaining({ departureGate: 'A6', statusReason: 'Embarque anticipado' }));
  });
  it('OPS-P6-02: sin puerta ni motivo el vuelo conserva los que ya tenía', async () => {
    const store = await seeded(); const useCases = make(store); await useCases.update({ flightInstanceId: id, status: 'BOARDING', departureGate: 'B2', reason: 'Cambio de puerta' });
    const flight = await useCases.update({ flightInstanceId: id, status: 'BOARDING' }); expect(flight.props).toMatchObject({ departureGate: 'B2', statusReason: 'Cambio de puerta' });
  });
  it('OPS-P6-03: una puerta o un motivo vacíos o demasiado largos se rechazan', async () => {
    const store = await seeded(); const useCases = make(store);
    for (const extra of [{ departureGate: '' }, { departureGate: 'G'.repeat(17) }, { reason: '' }, { reason: 'x'.repeat(201) }, { gate: 'A1' }]) await expect(useCases.update({ flightInstanceId: id, status: 'BOARDING', ...extra })).rejects.toThrow();
  });
});
