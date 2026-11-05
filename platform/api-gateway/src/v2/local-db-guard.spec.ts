import { assertDeletableClient, assertLocalDatabase } from './local-db-guard';

describe('local-db-guard', () => {
  it.each([
    'postgresql://u:p@127.0.0.1:15432/flight_platform?schema=gateway',
    'postgresql://u:p@localhost:5432/flight_platform',
  ])('acepta la base local %#', (url) => { expect(() => assertLocalDatabase(url)).not.toThrow(); });

  it.each([
    'postgresql://u:p@aws-0-us.pooler.supabase.com:6543/flight_platform',
    'postgresql://u:p@127.0.0.1:15432/flight_platform_integracion',
    'postgresql://u:p@db.internal:5432/flight_platform',
    'postgresql://u:p@127.0.0.1.evil.com:5432/flight_platform',
    'no es una url',
    '',
  ])('aborta con %#', (url) => { expect(() => assertLocalDatabase(url)).toThrow('se aborta sin hacer nada'); });

  it('aborta sin DATABASE_URL', () => { expect(() => assertLocalDatabase(undefined)).toThrow('se aborta sin hacer nada'); });

  it('los errores no revelan la cadena de conexión', () => {
    try { assertLocalDatabase('postgresql://usuario:secreto@pooler.supabase.com:6543/flight_platform'); } catch (error) {
      expect(String(error)).not.toMatch(/secreto|usuario|pooler/);
    }
  });

  it('borra solo journey-* salvo --allow-any-id', () => {
    expect(() => assertDeletableClient('journey-local', false)).not.toThrow();
    expect(() => assertDeletableClient('booking', false)).toThrow('journey-');
    expect(() => assertDeletableClient('booking', true)).not.toThrow();
  });
});
