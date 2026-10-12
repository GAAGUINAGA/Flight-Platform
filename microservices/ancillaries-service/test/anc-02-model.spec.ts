import { expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

it('ANC-02 / I: la migración contiene el índice único parcial de asientos activos', () => {
  const sql = readFileSync(join(process.cwd(), 'microservices/ancillaries-service/prisma/migrations/20261011000000_initial/migration.sql'), 'utf8');
  expect(sql).toContain('CREATE UNIQUE INDEX "seat_assignments_active_flight_seat_key"');
  expect(sql).toContain('WHERE "status" <> \'RELEASED\'');
  expect(sql).not.toMatch(/CREATE SCHEMA|CREATE EXTENSION/i);
});
