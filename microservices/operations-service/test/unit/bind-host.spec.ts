import { describe, expect, it } from '@jest/globals';
import { grpcBindUrl } from '../../src/bind-host';

describe('operations-service: dirección de escucha gRPC (perfil de integración local)', () => {
  it('BIND-01 por defecto escucha en 0.0.0.0 (Cloud Run) y en el puerto del servicio', () => { expect(grpcBindUrl({}, '50056')).toBe('0.0.0.0:50056'); });
  it('BIND-02 PORT sustituye al puerto por defecto', () => { expect(grpcBindUrl({ PORT: '8080' }, '50056')).toBe('0.0.0.0:8080'); });
  it('BIND-03 INTEGRATION_LOCAL=true escucha solo en 127.0.0.1', () => { expect(grpcBindUrl({ INTEGRATION_LOCAL: 'true' }, '50056')).toBe('127.0.0.1:50056'); });
  it('BIND-04 solo el valor exacto "true" activa el perfil', () => { for (const value of ['TRUE', '1', 'yes', 'false', '']) expect(grpcBindUrl({ INTEGRATION_LOCAL: value }, '50056')).toBe('0.0.0.0:50056'); });
  it('BIND-05 INTEGRATION_LOCAL=true con NODE_ENV=production se rechaza', () => { expect(() => grpcBindUrl({ INTEGRATION_LOCAL: 'true', NODE_ENV: 'production' }, '50056')).toThrow('INTEGRATION_LOCAL is forbidden in production'); });
  it('BIND-06 NODE_ENV=production sin el perfil sigue en 0.0.0.0', () => { expect(grpcBindUrl({ NODE_ENV: 'production', PORT: '8080' }, '50056')).toBe('0.0.0.0:8080'); });
  it('BIND-07 GRPC_BIND_HOST fuerza la dirección', () => { expect(grpcBindUrl({ GRPC_BIND_HOST: '10.0.0.5', INTEGRATION_LOCAL: 'true' }, '50056')).toBe('10.0.0.5:50056'); });
});
