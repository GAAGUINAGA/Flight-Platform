import { expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

describe('RSV-02: modelo y migración', () => {
  it('RSV-02 / I: persiste tablas, restricciones únicas y no administra esquemas', () => {
    const sql = readFileSync(join(process.cwd(), 'microservices/reservation-service/prisma/migrations/20261011000100_init/migration.sql'), 'utf8');
    expect(sql).toContain('reservations'); expect(sql).toContain('reservation_passengers'); expect(sql).toContain('reservation_changes'); expect(sql).toContain('payment_usages'); expect(sql).toContain('reservations_owner_id_idempotency_key_key'); expect(sql).toContain('payment_usages_pkey'); expect(sql).not.toMatch(/CREATE\s+(SCHEMA|EXTENSION)/i);
  });
});
