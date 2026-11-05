import { afterAll, describe, expect, it } from '@jest/globals';
import { GrpcServiceInvoker } from '../../src/infrastructure/grpc/grpc-invoker';
import { GrpcHealthProbe } from '../../src/infrastructure/grpc/health-probe';
import { testConfig } from './fakes';

// Puerto 1: nada escucha, el conector rechaza al instante.
const config = testConfig();
const invoker = new GrpcServiceInvoker(config);
afterAll(async () => { await invoker.close(); });

describe('ESB-GRPC: invocador gRPC real', () => {
  it('ESB-GRPC-01: servicio inalcanzable → error UNAVAILABLE (14) o DEADLINE_EXCEEDED (4) dentro del plazo', async () => {
    const started = Date.now();
    const error = await invoker.invoke('pricing', 'searchOffers', { legs: [] }, { correlationId: 'c' }, new Date(Date.now() + 1_500)).catch((thrown: unknown) => thrown);
    expect([4, 14]).toContain((error as { code: number }).code);
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it('ESB-GRPC-02: un método inexistente falla sin abrir conexión', async () => {
    await expect(invoker.invoke('pricing', 'noExiste', {}, { correlationId: 'c' }, new Date(Date.now() + 1_000))).rejects.toThrow('Unknown gRPC method');
  });

  it('ESB-GRPC-03: close() es idempotente y deja el invocador reutilizable', async () => {
    await invoker.close(); await invoker.close();
    const error = await invoker.invoke('inventory', 'expireHolds', {}, { correlationId: 'c' }, new Date(Date.now() + 1_000)).catch((thrown: unknown) => thrown);
    expect([4, 14]).toContain((error as { code: number }).code);
  });

  it('ESB-GRPC-04: el sondeo de salud marca DOWN a los siete servicios inalcanzables, dentro del tope', async () => {
    const started = Date.now();
    const report = await new GrpcHealthProbe(config).check(400);
    expect(report).toHaveLength(7);
    expect(report.every((dependency) => dependency.status === 'DOWN')).toBe(true);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
