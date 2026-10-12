import { expect, it } from '@jest/globals';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import process from 'node:process';

/**
 * ANC-10 — ejecución humana: RUN_ANC10_REAL=true, PRICING_GRPC_URL e INTERNAL_API_KEY.
 * Puertos: Inventory localhost:50051, Pricing localhost:50052 y Ancillaries localhost:50053.
 * Con los tres servicios ya iniciados y las variables en el entorno, ejecutar desde la raíz:
 * RUN_ANC10_REAL=true, ANCILLARIES_GRPC_URL=localhost:50053, PRICING_GRPC_URL=localhost:50052
 * e INTERNAL_API_KEY=<llave> npx jest microservices/ancillaries-service/test/integration/anc-10-real.spec.ts --runInBand --verbose.
 * La prueba no carga .env; smoke.cjs usa Pricing y Pricing resuelve Inventory local.
 */
const enabled = process.env.RUN_ANC10_REAL === 'true';
const integration = enabled ? it : it.skip;

integration('ANC-10 / I: ReserveSeats acepta el mismo payload del smoke contra servicios reales', async () => {
  if (!process.env.PRICING_GRPC_URL || !process.env.INTERNAL_API_KEY || !process.env.ANCILLARIES_GRPC_URL) throw new Error('PRICING_GRPC_URL, ANCILLARIES_GRPC_URL and INTERNAL_API_KEY are required for ANC-10');
  const result = await promisify(execFile)(process.execPath, [join(process.cwd(), 'microservices/ancillaries-service/scripts/smoke.cjs'), process.env.ANCILLARIES_GRPC_URL, '--insecure'], { env: process.env, timeout: 60_000 });
  expect(result.stdout).toContain('OK   GetSeatMapForOffer');
  expect(result.stdout).toContain('OK   ReserveSeats');
  expect(result.stdout).toContain('OK   seat map muestra ocupado');
  expect(result.stdout).toContain('OK   ReleaseSeats');
}, 65_000);
