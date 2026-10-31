import { loadConfig } from '../config';
import { isValidClientId } from './dev-auth';

describe('F12a client_id del dev-auth', () => {
  it('V2-CID-01: acepta letras, dígitos, guion y guion bajo de 3 a 40 caracteres', () => {
    for (const id of ['booking', 'Booking_Prod-1', 'abc', 'a'.repeat(40), '1abc']) expect({ id, ok: isValidClientId(id) }).toEqual({ id, ok: true });
  });
  it('V2-CID-02: rechaza ~, espacios, símbolos, vacío, muy corto y muy largo', () => {
    for (const id of ['', 'ab', 'a'.repeat(41), 'a~b', 'a b', 'a/b', 'a.b', 'a@b', '-abc', '_abc', 'ñandú', 'a\nb']) expect({ id, ok: isValidClientId(id) }).toEqual({ id, ok: false });
  });
  it('V2-CID-03: rechaza cualquier forma de UUID para no chocar con el sub de Supabase', () => {
    for (const id of ['5f1d2c3b-aaaa-4bbb-8ccc-0123456789ab', '5F1D2C3B-AAAA-4BBB-8CCC-0123456789AB', '00000000-0000-0000-0000-000000000000']) expect({ id, ok: isValidClientId(id) }).toEqual({ id, ok: false });
    expect(isValidClientId('5f1d2c3b-aaaa-4bbb-8ccc-0123456789a')).toBe(true);
  });
});

const base = { NODE_ENV: 'test', INTERNAL_API_KEY: 'k', JWT_ISSUERS: JSON.stringify([{ iss: 'https://auth.example/auth/v1', aud: 'authenticated', jwksUri: 'https://auth.example/jwks' }]) };

describe('F12a configuración v2', () => {
  it('V2-CFG-01 los valores por defecto son los de producción: perfil local apagado, nodo GabatAIR', () => {
    const config = loadConfig({ ...base });
    expect(config.v2).toMatchObject({ integrationLocal: false, nodeId: 'NODE_VUE_GABATAIR', providerName: 'GabatAIR', publicBaseUrl: 'http://localhost:3000' });
  });
  it('V2-CFG-02 INTEGRATION_LOCAL solo se activa con el valor exacto "true"', () => {
    for (const value of ['1', 'yes', 'TRUE', '', undefined]) expect({ value, on: loadConfig({ ...base, INTEGRATION_LOCAL: value }).v2!.integrationLocal }).toEqual({ value, on: false });
    expect(loadConfig({ ...base, INTEGRATION_LOCAL: 'true' }).v2!.integrationLocal).toBe(true);
  });
  it('V2-CFG-03 INTEGRATION_LOCAL se rechaza al arrancar con NODE_ENV=production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', INTEGRATION_LOCAL: 'true' })).toThrow('INTEGRATION_LOCAL is forbidden in production');
  });
  it('V2-CFG-04 PUBLIC_BASE_URL fija el emisor y se normaliza sin barra final', () => {
    expect(loadConfig({ ...base, PUBLIC_BASE_URL: 'http://100.64.1.2:3000/' }).v2!.publicBaseUrl).toBe('http://100.64.1.2:3000');
  });
  it('V2-CFG-05 PUBLIC_BASE_URL con ruta se rechaza y en producción exige https', () => {
    expect(() => loadConfig({ ...base, PUBLIC_BASE_URL: 'http://100.64.1.2:3000/api' })).toThrow('origin without path');
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://gw.example' })).toThrow('https in production');
  });
  it('V2-CFG-06 en producción el dev-auth queda apagado sin llave y URL pública explícitas', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).v2!.devAuth.enabled).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://gw.example' }).v2!.devAuth.enabled).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'production', DEV_AUTH_PRIVATE_KEY: 'pem' }).v2!.devAuth.enabled).toBe(false);
  });
  it('V2-CFG-07 en producción con llave y URL https el dev-auth se habilita y usa la base de datos', () => {
    const v2 = loadConfig({ ...base, NODE_ENV: 'production', DEV_AUTH_PRIVATE_KEY: 'pem', PUBLIC_BASE_URL: 'https://gw.example' }).v2!;
    expect(v2.devAuth).toMatchObject({ enabled: true, store: 'prisma' });
  });
  it('V2-CFG-08 DEV_AUTH_ENABLED=false lo apaga en cualquier entorno', () => {
    expect(loadConfig({ ...base, DEV_AUTH_ENABLED: 'false' }).v2!.devAuth.enabled).toBe(false);
  });
  it('V2-CFG-09 en pruebas el almacén de clientes es en memoria salvo que se pida prisma', () => {
    expect(loadConfig({ ...base }).v2!.devAuth.store).toBe('memory');
    expect(loadConfig({ ...base, DEV_AUTH_STORE: 'prisma' }).v2!.devAuth.store).toBe('prisma');
  });
});
