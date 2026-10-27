import process from 'node:process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { v2SeatCharacteristics } from '../../../src/v2/shopping.controller';
import { expectV2Response } from './support';
import { startStack, type Scenario, type Stack } from './stack';

const describeReal = process.env.RUN_GATEWAY_REAL === 'true' ? describe : describe.skip;

describe('F12a · características de asiento del contrato v2', () => {
  it('V2-LOC-01 EXIT_ROW del catálogo se publica como EMERGENCY_EXIT y lo desconocido se descarta', () => {
    expect(v2SeatCharacteristics(['WINDOW', 'EXIT_ROW', 'BULKHEAD', 'AISLE'])).toEqual(['WINDOW', 'EMERGENCY_EXIT', 'AISLE']);
  });
  it('V2-LOC-02 sin duplicados y tolera datos vacíos', () => { expect(v2SeatCharacteristics(['EXIT_ROW', 'EMERGENCY_EXIT'])).toEqual(['EMERGENCY_EXIT']); expect(v2SeatCharacteristics(undefined)).toEqual([]); expect(v2SeatCharacteristics([])).toEqual([]); });
});

describeReal('F12a · plataforma real: health y mapa de asientos con fila de salida (contra servicios reales)', () => {
  let stack: Stack; let scenario: Scenario;
  beforeAll(async () => { stack = await startStack(); scenario = await stack.scenario(); }, 180_000);
  afterAll(async () => { await scenario?.cleanup().catch(() => undefined); await stack?.close(); }, 120_000);

  it('V2-LOC-03 el health del gateway sondea los siete servicios reales con la llave interna: HEALTHY y siete UP', async () => {
    const res = await request(stack.server).get('/api/v2/vuelos/health');
    expect(res.status).toBe(200); expectV2Response('GET', '/vuelos/health', 200, res.body);
    expect(res.body.status).toBe('HEALTHY'); expect(res.body.dependencias).toHaveLength(7); expect(res.body.dependencias.every((item: { status: string }) => item.status === 'UP')).toBe(true);
  }, 60_000);
  it('V2-LOC-04 un asiento de fila de salida (EXIT_ROW) no rompe el mapa de asientos v2', async () => {
    await stack.db.ancillaries.seatLayout.updateMany({ where: { aircraft: scenario.aircraft, seatNumber: '1B' }, data: { characteristics: ['EXIT_ROW', 'BULKHEAD'] } });
    const offer = await scenario.search(); const res = await request(stack.server).get(`/api/v2/vuelos/offers/${offer.offerId}/seatmap`).query({ segmentId: offer.segmentId });
    expect(res.status).toBe(200); expectV2Response('GET', '/vuelos/offers/{offerId}/seatmap', 200, res.body);
    const seats = res.body.cabins.flatMap((cabin: { rows: Array<{ seats: Array<{ seatNumber: string; characteristics: string[] }> }> }) => cabin.rows.flatMap((row) => row.seats));
    expect(seats.find((seat: { seatNumber: string }) => seat.seatNumber === '1B').characteristics).toEqual(['EMERGENCY_EXIT']);
  }, 60_000);
});
