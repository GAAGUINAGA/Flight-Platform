/* global afterEach */
import process from 'node:process';
import { createTicketingServer, resolveFailMode } from '../../src/infrastructure/grpc/server';

const key = 'k'.repeat(32);
const start = () => createTicketingServer({ url: '127.0.0.1:0', internalApiKey: key, prisma: {} as never, store: {} as never });

describe('TKT-FM: TICKETING_FAIL_MODE es un control de prueba y no puede activarse en producción', () => {
  const previous = { mode: process.env.TICKETING_FAIL_MODE, env: process.env.NODE_ENV };
  const set = (name: 'TICKETING_FAIL_MODE' | 'NODE_ENV', value?: string) => { if (value === undefined) delete process.env[name]; else process.env[name] = value; };
  afterEach(() => { set('TICKETING_FAIL_MODE', previous.mode); set('NODE_ENV', previous.env); });

  it('TKT-FM-01: en producción con la variable activa el servicio no arranca, con un error claro y sin el valor', async () => {
    for (const value of ['always', 'first_attempt', 'cualquier-otro-valor']) {
      set('NODE_ENV', 'production'); set('TICKETING_FAIL_MODE', value);
      const error = await start().then(() => undefined, (failure: Error) => failure);
      expect(error?.message).toContain('TICKETING_FAIL_MODE');
      expect(error?.message).toContain('NODE_ENV=production');
      expect(error?.message).not.toContain(value);
    }
  });
  it('TKT-FM-02: en producción sin la variable arranca', async () => {
    set('NODE_ENV', 'production'); set('TICKETING_FAIL_MODE');
    const app = await start();
    try { await app.listen(); } finally { await app.close(); }
  });
  it.each(['', 'off', 'OFF', 'none', '  '])('TKT-FM-03: en producción la variable inactiva (%j) no impide arrancar ni activa el modo', (value) => {
    expect(resolveFailMode({ NODE_ENV: 'production', TICKETING_FAIL_MODE: value })).toBe('none');
  });
  it('TKT-FM-04: fuera de producción el modo de fallo sigue funcionando', async () => {
    expect(resolveFailMode({ NODE_ENV: 'test', TICKETING_FAIL_MODE: 'always' })).toBe('always');
    expect(resolveFailMode({ TICKETING_FAIL_MODE: 'first_attempt' })).toBe('first_attempt');
    expect(resolveFailMode({ NODE_ENV: 'development' })).toBe('none');
    set('NODE_ENV', 'test'); set('TICKETING_FAIL_MODE', 'always');
    const app = await start(); await app.close();
  });
});
