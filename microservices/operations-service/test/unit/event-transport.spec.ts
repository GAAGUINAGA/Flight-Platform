/* global afterEach */
// ADR-F12b2-01, condición 1: el emisor real (composición de operations-service) avisa al arrancar si en producción publica sin el bus.
import process from 'node:process';
import { createOperationsRuntime } from '../../src/main';

const saved = { NODE_ENV: process.env.NODE_ENV, ESB_URL: process.env.ESB_URL };
const restore = () => { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
const compose = (env: { NODE_ENV: string; ESB_URL?: string }) => {
  Object.assign(process.env, { NODE_ENV: env.NODE_ENV }); if (env.ESB_URL) process.env.ESB_URL = env.ESB_URL; else delete process.env.ESB_URL;
  const lines: string[] = []; const write = jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => { lines.push(String(chunk)); return true; });
  try { const composition = createOperationsRuntime('k'.repeat(40), {} as never); composition.close(); } finally { write.mockRestore(); }
  return lines.filter((line) => line.includes('event-bus'));
};

describe('operations-service: transporte de eventos (ADR-F12b2-01)', () => {
  afterEach(restore);
  it('en producción sin ESB_URL avisa que publica por gRPC directo, sin el bus', () => {
    const warnings = compose({ NODE_ENV: 'production' });
    expect(warnings).toHaveLength(1);
    expect(JSON.parse(warnings[0])).toMatchObject({ level: 'warn', service: 'operations-service', dependency: 'event-bus' });
    expect(warnings[0]).toContain('direct gRPC to Webhooks, bypassing the event bus');
    expect(warnings[0]).not.toContain('kkkk');
  });
  it('en producción con ESB_URL no avisa y publica por el ESB', () => { expect(compose({ NODE_ENV: 'production', ESB_URL: 'https://esb.example.test' })).toEqual([]); });
  it('fuera de producción sin ESB_URL no avisa (arneses y pruebas siguen por gRPC)', () => { expect(compose({ NODE_ENV: 'development' })).toEqual([]); });
});
