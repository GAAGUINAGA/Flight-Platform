import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { PrismaClient } from '../../generated/prisma-client';
import { PrismaPromotionStore } from '../../src/v2/promotions';

describe('F12a P6 integración: promotion_agreement en Postgres', () => {
  const prisma = new PrismaClient(); const store = new PrismaPromotionStore(prisma); const run = `it-${randomUUID().slice(0, 8)}`; let connected = false;
  beforeAll(async () => { await prisma.$connect(); connected = true; });
  afterAll(async () => { if (connected) await prisma.promotionAgreement.deleteMany({ where: { clientId: { startsWith: run } } }); await prisma.$disconnect(); });
  const base = { permite_promociones: true, porcentaje_descuento_maximo: 12.5, destinos_habilitados: ['Quito'], rutas_habilitadas: ['UIO-GYE'], cabinas_habilitadas: ['ECONOMY'], vigencia_hasta: '2026-12-31', condiciones_combo: 'No aplica en feriados.' };

  it('V2-P6-DB-01 guarda y lee el acuerdo de un cliente con todos sus campos', async () => {
    await store.save(`${run}-a`, base); const found = await store.find(`${run}-a`);
    expect(found).toMatchObject(base); expect(Date.parse(found!.actualizado_en)).not.toBeNaN();
  });
  it('V2-P6-DB-02 guardar de nuevo reemplaza el acuerdo sin duplicarlo', async () => {
    await store.save(`${run}-b`, base); await store.save(`${run}-b`, { ...base, permite_promociones: false, porcentaje_descuento_maximo: 0, rutas_habilitadas: [] });
    expect(await store.find(`${run}-b`)).toMatchObject({ permite_promociones: false, porcentaje_descuento_maximo: 0, rutas_habilitadas: [] }); expect(await prisma.promotionAgreement.count({ where: { clientId: `${run}-b` } })).toBe(1);
  });
  it('V2-P6-DB-03 el acuerdo es por cliente y uno sin registro devuelve null', async () => {
    expect(await store.find(`${run}-nunca`)).toBeNull(); await store.save(`${run}-c`, base); expect(await store.find(`${run}-d`)).toBeNull();
  });
  it('V2-P6-DB-04 los campos opcionales ausentes no se inventan', async () => {
    const { vigencia_hasta: _vigencia, condiciones_combo: _condiciones, ...minimal } = base; void _vigencia; void _condiciones;
    await store.save(`${run}-e`, minimal); const found = await store.find(`${run}-e`); expect(found).not.toHaveProperty('vigencia_hasta'); expect(found).not.toHaveProperty('condiciones_combo');
  });
});
