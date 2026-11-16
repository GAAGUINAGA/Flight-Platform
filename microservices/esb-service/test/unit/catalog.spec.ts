import { join } from 'node:path';
import { loadSync } from '@grpc/proto-loader';
import { describe, expect, it } from '@jest/globals';
import { DOMAINS, OPERATIONS, SERVICES, findOperation, type ServiceName } from '../../src/domain/catalog';
import { protoRoot } from '../../src/infrastructure/grpc/grpc-invoker';

const protoMethods = (service: ServiceName): Set<string> => {
  const root = protoRoot();
  const definition = loadSync(join(root, 'flightplatform', service, 'v1', `${service}.proto`), { includeDirs: [root], keepCase: false });
  const serviceName = `flightplatform.${service}.v1.${service[0].toUpperCase()}${service.slice(1)}Service`;
  const methods = definition[serviceName] as Record<string, unknown>;
  return new Set(Object.keys(methods).map((method) => `${method[0].toLowerCase()}${method.slice(1)}`));
};

describe('ESB-CAT: catálogo de operaciones con nombre', () => {
  it('ESB-CAT-01: hay 53 operaciones gRPC (44 + apartar y liberar asientos del hold, F12b2fix + buscar por PNR y estado de check-in del administrador, F12c-4a + check-in y pases de la aerolínea, F12c-4b + crear y abrir vuelo y catálogo de aviones, F12c-4c), 1 compuesta de asientos y 1 de salud', () => {
    expect(OPERATIONS.filter((operation) => operation.kind === 'rpc')).toHaveLength(53);
    expect(OPERATIONS.filter((operation) => operation.kind === 'composite')).toHaveLength(1);
    expect(OPERATIONS.filter((operation) => operation.kind === 'health')).toHaveLength(1);
  });

  it('ESB-CAT-06 (F12b-2): la única operación nativa es sistema.publicar-eventos, solo para el rol system', () => {
    expect(OPERATIONS.filter((operation) => operation.kind === 'native')).toEqual([{ kind: 'native', name: 'sistema.publicar-eventos', handler: 'publishOutbox', roles: ['system'] }]);
  });

  it('ESB-CAT-02: los nombres son únicos, en minúsculas con guiones y de un dominio del contrato', () => {
    const names = OPERATIONS.map((operation) => operation.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+\.[a-z-]+$/);
      expect(DOMAINS).toContain(name.split('.')[0]);
    }
  });

  it('ESB-CAT-03: cada método gRPC usado existe en el .proto de su servicio y se expone en una sola operación', () => {
    const methodsByService = new Map(SERVICES.map((service) => [service, protoMethods(service)]));
    const seen = new Set<string>();
    for (const operation of OPERATIONS) {
      const steps = operation.kind === 'rpc' ? [operation] : operation.kind === 'composite' ? operation.steps : [];
      for (const step of steps) {
        expect(methodsByService.get(step.service)?.has(step.method)).toBe(true);
        if (operation.kind === 'rpc') {
          const id = `${step.service}.${step.method}`;
          expect(seen.has(id)).toBe(false);
          seen.add(id);
        }
      }
    }
  });

  it('ESB-CAT-04: solo las cuatro operaciones orquestadas tienen plazo largo', () => {
    const orchestrated = OPERATIONS.filter((operation) => operation.kind === 'rpc' && operation.orchestrated).map((operation) => operation.name).sort();
    expect(orchestrated).toEqual(['postventa.agregar-equipaje', 'postventa.cancelar', 'postventa.confirmar-cambio-fecha', 'reservas.crear']);
  });

  it('ESB-CAT-07 (F12c-4a): buscar por PNR y el estado de check-in del administrador exigen el rol admin en el ESB', () => {
    expect(findOperation('reservas.buscar-por-pnr')).toMatchObject({ kind: 'rpc', service: 'reservation', method: 'adminGetReservationByPnr', roles: ['admin'] });
    expect(findOperation('postventa.admin-estado-check-in')).toMatchObject({ kind: 'rpc', service: 'operations', method: 'adminGetCheckInStatus', roles: ['admin'] });
  });

  it('ESB-CAT-08 (F12c-4b/4c): check-in y pases de la aerolínea, crear y abrir vuelo y el catálogo de aviones exigen el rol admin en el ESB', () => {
    expect(findOperation('postventa.check-in-aerolinea')).toMatchObject({ kind: 'rpc', service: 'operations', method: 'adminCheckIn', roles: ['admin'] });
    expect(findOperation('postventa.listar-pases-aerolinea')).toMatchObject({ kind: 'rpc', service: 'operations', method: 'adminListBoardingPasses', roles: ['admin'] });
    expect(findOperation('vuelos.crear-instancia')).toMatchObject({ kind: 'rpc', service: 'inventory', method: 'createFlightInstance', roles: ['admin'] });
    expect(findOperation('vuelos.abrir-instancia')).toMatchObject({ kind: 'rpc', service: 'inventory', method: 'openFlightInstance', roles: ['admin'] });
    expect(findOperation('vuelos.catalogo-aviones')).toMatchObject({ kind: 'rpc', service: 'ancillaries', method: 'listAircraftLayouts', roles: ['admin'] });
  });

  it('ESB-CAT-05: findOperation devuelve la operación o undefined', () => {
    expect(findOperation('vuelos.buscar-ofertas')).toMatchObject({ kind: 'rpc', service: 'pricing', method: 'searchOffers' });
    expect(findOperation('vuelos.no-existe')).toBeUndefined();
  });
});
