import type { Request } from 'express';
import type { PrismaClient } from '../../generated/prisma-client';
import type { GatewayConfig } from '../config';
import { GatewayProblemError } from '../web-errors';
import { v2Controller, v2Route } from './route';

type Json = Record<string, unknown>;

/** Acuerdo B2B de promociones y combos de la aerolínea (`promotion_agreement`, una fila con clave = NODE_ID; no requiere otra migración). */
export interface PromotionAgreement {
  permite_promociones: boolean; porcentaje_descuento_maximo: number; destinos_habilitados: string[]; rutas_habilitadas: string[]; cabinas_habilitadas: string[];
  vigencia_hasta?: string; condiciones_combo?: string; actualizado_en: string;
}
export interface PromotionStore { find(clientId: string): Promise<PromotionAgreement | null>; save(clientId: string, agreement: Omit<PromotionAgreement, 'actualizado_en'>): Promise<PromotionAgreement> }

export class InMemoryPromotionStore implements PromotionStore {
  readonly agreements = new Map<string, PromotionAgreement>();
  async find(clientId: string): Promise<PromotionAgreement | null> { const found = this.agreements.get(clientId); return found ? { ...found } : null; }
  async save(clientId: string, agreement: Omit<PromotionAgreement, 'actualizado_en'>): Promise<PromotionAgreement> { const saved = { ...agreement, actualizado_en: new Date().toISOString() }; this.agreements.set(clientId, saved); return { ...saved }; }
}

type Row = { permitePromociones: boolean; porcentajeDescuentoMaximo: { toNumber(): number } | number; destinosHabilitados: string[]; rutasHabilitadas: string[]; cabinasHabilitadas: string[]; vigenciaHasta: string | null; condicionesCombo: string | null; updatedAt: Date };
const toAgreement = (row: Row): PromotionAgreement => ({
  permite_promociones: row.permitePromociones, porcentaje_descuento_maximo: typeof row.porcentajeDescuentoMaximo === 'number' ? row.porcentajeDescuentoMaximo : row.porcentajeDescuentoMaximo.toNumber(),
  destinos_habilitados: row.destinosHabilitados, rutas_habilitadas: row.rutasHabilitadas, cabinas_habilitadas: row.cabinasHabilitadas,
  ...(row.vigenciaHasta ? { vigencia_hasta: row.vigenciaHasta } : {}), ...(row.condicionesCombo ? { condiciones_combo: row.condicionesCombo } : {}), actualizado_en: row.updatedAt.toISOString()
});

export class PrismaPromotionStore implements PromotionStore {
  constructor(private readonly prisma: PrismaClient) {}
  async find(clientId: string): Promise<PromotionAgreement | null> { const row = await this.prisma.promotionAgreement.findUnique({ where: { clientId } }); return row ? toAgreement(row) : null; }
  async save(clientId: string, a: Omit<PromotionAgreement, 'actualizado_en'>): Promise<PromotionAgreement> {
    const data = { permitePromociones: a.permite_promociones, porcentajeDescuentoMaximo: a.porcentaje_descuento_maximo, destinosHabilitados: a.destinos_habilitados, rutasHabilitadas: a.rutas_habilitadas, cabinasHabilitadas: a.cabinas_habilitadas, vigenciaHasta: a.vigencia_hasta ?? null, condicionesCombo: a.condiciones_combo ?? null };
    return toAgreement(await this.prisma.promotionAgreement.upsert({ where: { clientId }, create: { clientId, ...data }, update: data }));
  }
}

const ROUTE = /^[A-Z]{3}-[A-Z]{3}$/;
/** Valida lo que el esquema no cubre: el rango del descuento es 422 en el contrato (el validador OpenAPI daría 400) y las rutas deben ser pares IATA. */
export function assertAgreementRules(body: { porcentaje_descuento_maximo?: unknown; rutas_habilitadas?: unknown }): void {
  const percent = body.porcentaje_descuento_maximo;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) throw new GatewayProblemError(422, 'PROMOTION_DISCOUNT_OUT_OF_RANGE', 'porcentaje_descuento_maximo debe estar entre 0 y 100');
  if (Array.isArray(body.rutas_habilitadas) && body.rutas_habilitadas.some((route) => typeof route !== 'string' || !ROUTE.test(route))) throw new GatewayProblemError(400, 'VALIDATION_FAILED', 'rutas_habilitadas debe usar pares IATA AAA-BBB');
}

/** `GET/PUT /vuelos/promociones/contrato`: un único acuerdo de la aerolínea; lo registra un admin (`flights:admin`) y lo lee cualquier socio con `flights:read`. El PUT reemplaza el anterior. */
export class V2PromotionsController {
  constructor(private readonly config: GatewayConfig, private readonly store: PromotionStore) {}
  /** Un único acuerdo de la aerolínea: la fila se identifica con el nodo, no con el cliente que consulta. */
  private key(): string { return this.config.v2!.nodeId; }
  private view(agreement: PromotionAgreement): Json { return { proveedor_codigo: this.config.v2!.nodeId, nombre_socio: this.config.v2!.providerName, vertical: 'VUELOS', ...agreement }; }

  async get(): Promise<Json> {
    const agreement = await this.store.find(this.key());
    if (!agreement) throw new GatewayProblemError(404, 'NOT_FOUND', 'No hay un acuerdo de promociones registrado');
    return this.view(agreement);
  }

  async put(req: Request, body: Json & { permite_promociones: boolean; porcentaje_descuento_maximo: number }): Promise<Json> {
    // El middleware HTTP aparta un descuento fuera de rango para que el esquema no lo rechace con 400; aquí, ya autenticado y autorizado, se responde 422.
    assertAgreementRules({ ...body, porcentaje_descuento_maximo: (req.res?.locals.outOfRangeDiscount as number | undefined) ?? body.porcentaje_descuento_maximo });
    const saved = await this.store.save(this.key(), {
      permite_promociones: body.permite_promociones, porcentaje_descuento_maximo: body.porcentaje_descuento_maximo,
      destinos_habilitados: (body.destinos_habilitados as string[] | undefined) ?? [], rutas_habilitadas: (body.rutas_habilitadas as string[] | undefined) ?? [], cabinas_habilitadas: (body.cabinas_habilitadas as string[] | undefined) ?? [],
      ...(body.vigencia_hasta ? { vigencia_hasta: String(body.vigencia_hasta) } : {}), ...(body.condiciones_combo ? { condiciones_combo: String(body.condiciones_combo) } : {})
    });
    return { success: true, mensaje: 'Acuerdo B2B de promociones de vuelos actualizado exitosamente.', contrato: this.view(saved) };
  }
}
v2Controller(V2PromotionsController, 'vuelos/promociones', ['GATEWAY_CONFIG', 'V2_PROMOTIONS']);
v2Route(V2PromotionsController.prototype, 'get', 'get', 'contrato', [], { scopes: ['flights:read'] });
v2Route(V2PromotionsController.prototype, 'put', 'put', 'contrato', ['req', 'body'], { scopes: ['flights:admin'], status: 200, idempotent: { operation: 'putPromotionAgreement' } });
