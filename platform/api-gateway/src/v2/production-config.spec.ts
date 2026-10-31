import { generateKeyPairSync } from 'node:crypto';
import { loadConfig } from '../config';
import { DevAuthService, InMemoryDevAuthClientStore } from './dev-auth';


const base = { NODE_ENV: 'production', INTERNAL_API_KEY: 'k', JWT_ISSUERS: JSON.stringify([{ iss: 'https://auth.example/auth/v1', aud: 'authenticated', jwksUri: 'https://auth.example/jwks' }]) };
const pem = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } }).privateKey;
const create = (env: Record<string, string | undefined>) => DevAuthService.create(loadConfig({ ...base, ...env }).v2!, new InMemoryDevAuthClientStore());

describe('F12a-2 E · configuración de producción del gateway (sin servicios)', () => {
  describe('dev-auth', () => {
    it('V2-E-01 / S: en producción sin llave el servicio se niega a arrancar (no genera una efímera)', async () => {
      await expect(create({ PUBLIC_BASE_URL: 'https://gw.example' })).rejects.toThrow('DEV_AUTH_PRIVATE_KEY is required in production');
    });
    it('V2-E-02 / S: en producción sin PUBLIC_BASE_URL explícita se niega a arrancar', async () => {
      await expect(create({ DEV_AUTH_PRIVATE_KEY: pem })).rejects.toThrow('PUBLIC_BASE_URL is required in production');
    });
    it('V2-E-03 / S: en producción la llave no puede leerse de un archivo local', () => {
      for (const extra of [{}, { DEV_AUTH_PRIVATE_KEY: pem }, { DEV_AUTH_ENABLED: 'false' }]) expect(() => loadConfig({ ...base, DEV_AUTH_PRIVATE_KEY_FILE: 'C:/llaves/dev.pem', ...extra })).toThrow('DEV_AUTH_PRIVATE_KEY_FILE is forbidden in production');
    });
    it('V2-E-04 / K: con la llave en una variable y la URL pública arranca, publica su JWKS y el emisor es la URL de Render', async () => {
      const service = await create({ DEV_AUTH_PRIVATE_KEY: pem, PUBLIC_BASE_URL: 'https://flight-gateway-o37n.onrender.com' });
      expect(service.enabled).toBe(true); expect(service.jwks().keys).toHaveLength(1); expect(service.issuer).toBe('https://flight-gateway-o37n.onrender.com/api/v2');
    });
    it('V2-E-05 / K: la llave de una variable admite los saltos de línea escapados (\\n) de Render y de Secret Manager', async () => {
      const service = await create({ DEV_AUTH_PRIVATE_KEY: pem.replace(/\n/g, '\\n'), PUBLIC_BASE_URL: 'https://gw.example' });
      expect(service.jwks().keys).toHaveLength(1);
    });
    it('V2-E-06 / S: una llave inválida falla sin imprimir su contenido', async () => {
      const secret = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC-contenido-secreto';
      const error = await create({ DEV_AUTH_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${secret}\n-----END PRIVATE KEY-----`, PUBLIC_BASE_URL: 'https://gw.example' }).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe('DEV_AUTH_PRIVATE_KEY is not a valid PEM private key'); expect(String((error as Error).stack)).not.toContain(secret);
    });
    it('V2-E-07 / K: DEV_AUTH_ENABLED=false apaga el dev-auth en producción y arranca sin llave', async () => {
      const service = await create({ DEV_AUTH_ENABLED: 'false' });
      expect(service.enabled).toBe(false); expect(service.jwks().keys).toEqual([]);
    });
    it('V2-E-08 / S: fuera de producción sigue habilitado sin llave (llave efímera de desarrollo)', async () => {
      const service = await DevAuthService.create(loadConfig({ ...base, NODE_ENV: 'development' }).v2!, new InMemoryDevAuthClientStore());
      expect(service.enabled).toBe(true);
    });
  });

  describe('Booking opcional', () => {
    const empty = { DEV_AUTH_PRIVATE_KEY: pem, PUBLIC_BASE_URL: 'https://gw.example' };
    it('V2-E-09 / K: sin ninguna variable de Booking arranca con el stock apagado y booking-events sin secreto', () => {
      const v2 = loadConfig({ ...base, ...empty }).v2!;
      expect(v2.stock).toMatchObject({ enabled: false, url: undefined, apiKey: undefined, tls: true });
      expect(v2.bookingEvents).toMatchObject({ secret: undefined, clientId: undefined });
    });
    it('V2-E-10 / K: ninguna dirección de Booking queda fija: la URL del stock solo viene de BOOKING_STOCK_GRPC_URL', () => {
      expect(loadConfig({ ...base, ...empty, BOOKING_STOCK_API_KEY: 'k' }).v2!.stock).toMatchObject({ enabled: false, url: undefined });
      expect(loadConfig({ ...base, ...empty, BOOKING_STOCK_GRPC_URL: 'stock.example:50051' }).v2!.stock).toMatchObject({ enabled: false, url: 'stock.example:50051' });
      expect(loadConfig({ ...base, ...empty, BOOKING_STOCK_API_KEY: 'k', BOOKING_STOCK_GRPC_URL: 'stock.example:50051' }).v2!.stock).toMatchObject({ enabled: true, url: 'stock.example:50051', tls: true });
    });
    it('V2-E-11 / S: variables de Booking vacías (Render las deja como cadena vacía) equivalen a no configuradas', () => {
      const v2 = loadConfig({ ...base, ...empty, BOOKING_STOCK_API_KEY: '', BOOKING_STOCK_GRPC_URL: '  ', BOOKING_EVENTS_SECRET: '', BOOKING_EVENTS_CLIENT_ID: '' }).v2!;
      expect(v2.stock).toMatchObject({ enabled: false, url: undefined }); expect(v2.bookingEvents.secret).toBeUndefined();
    });
    it('V2-E-12 / S: en producción el stock no puede ir sin TLS aunque se configure', () => {
      expect(() => loadConfig({ ...base, ...empty, BOOKING_STOCK_API_KEY: 'k', BOOKING_STOCK_GRPC_URL: 'stock.example:50051', BOOKING_STOCK_TLS: 'false' })).toThrow('BOOKING_STOCK_TLS=false requires INTEGRATION_LOCAL=true');
      expect(() => loadConfig({ ...base, ...empty, BOOKING_STOCK_TLS: 'false', INTEGRATION_LOCAL: 'true' })).toThrow('INTEGRATION_LOCAL is forbidden in production');
    });
  });
});
