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
  it('ESB-CAT-01: hay 44 operaciones gRPC, 1 compuesta de asientos y 1 de salud (46)', () => {
    expect(OPERATIONS.filter((operation) => operation.kind === 'rpc')).toHaveLength(44);
    expect(OPERATIONS.filter((operation) => operation.kind === 'composite')).toHaveLength(1);
    expect(OPERATIONS.filter((operation) => operation.kind === 'health')).toHaveLength(1);
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

  it('ESB-CAT-05: findOperation devuelve la operación o undefined', () => {
    expect(findOperation('vuelos.buscar-ofertas')).toMatchObject({ kind: 'rpc', service: 'pricing', method: 'searchOffers' });
    expect(findOperation('vuelos.no-existe')).toBeUndefined();
  });
});
