/* global fetch, Response, AbortSignal */
import process from 'node:process';
import { Logger } from '@nestjs/common';
import { status as grpcStatus } from '@grpc/grpc-js';
import { decimalToMinor, DomainError } from '@flight-platform/shared';
import { PaymentResult, PaymentVerifier } from '../../application/ports';
import { classifyStatus, DEFAULT_FIELDS, DEFAULT_STATUS_MAP, parseFields, parseStatusMap, pickField, PaymentFields, StatusMap } from './payment-status-map';

/** Booking no respondió a tiempo o rechazó nuestra credencial: el Gateway lo ve como UNAVAILABLE y responde 503 con Retry-After. */
export class PaymentProviderUnavailable extends Error {
  readonly code = grpcStatus.UNAVAILABLE;
  constructor() { super('payment provider unavailable'); this.name = 'PaymentProviderUnavailable'; }
}

export interface BookingPaymentsConfig {
  /** Vacío = no configurado: toda verificación falla como proveedor no disponible (nunca se acepta sin verificar). */
  baseUrl?: string;
  pathTemplate: string;
  authHeader: string;
  /** Valor completo de la cabecera de autenticación (p. ej. `Bearer …` o la llave). Secreto: nunca se registra. */
  authValue?: string;
  timeoutMs: number;
  statusMap: StatusMap;
  fields: PaymentFields;
  /** `off` solo se admite con INTEGRATION_LOCAL=true: contingencia de la reunión si la API de pagos de Booking aún no existe. */
  verify: 'on' | 'off';
  fetchImpl?: typeof fetch;
}

const logger = new Logger('BookingPayments');

export function bookingPaymentsConfigFromEnv(env: Record<string, string | undefined> = process.env): BookingPaymentsConfig {
  const production = env.NODE_ENV === 'production'; const local = env.INTEGRATION_LOCAL === 'true';
  if (local && production) throw new Error('INTEGRATION_LOCAL is forbidden in production');
  const verify = env.BOOKING_PAYMENTS_VERIFY === 'off' ? 'off' : 'on';
  if (verify === 'off' && !local) throw new Error('BOOKING_PAYMENTS_VERIFY=off requires INTEGRATION_LOCAL=true');
  const baseUrl = env.BOOKING_PAYMENTS_BASE_URL?.trim().replace(/\/+$/, '') || undefined;
  if (baseUrl && !/^https?:\/\/[^\s]+$/.test(baseUrl)) throw new Error('BOOKING_PAYMENTS_BASE_URL must be an http(s) URL');
  if (baseUrl && production && !baseUrl.startsWith('https://')) throw new Error('BOOKING_PAYMENTS_BASE_URL must use https in production');
  const timeoutMs = Number(env.BOOKING_PAYMENTS_TIMEOUT_MS ?? 2500);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 4500) throw new Error('BOOKING_PAYMENTS_TIMEOUT_MS must stay within the 5 s budget (100–4500)');
  const pathTemplate = env.BOOKING_PAYMENTS_PATH_TEMPLATE ?? '/pagos/{paymentReference}';
  if (!pathTemplate.includes('{paymentReference}')) throw new Error('BOOKING_PAYMENTS_PATH_TEMPLATE must contain {paymentReference}');
  return { baseUrl, pathTemplate, authHeader: env.BOOKING_PAYMENTS_AUTH_HEADER ?? 'Authorization', authValue: env.BOOKING_PAYMENTS_AUTH_VALUE || undefined, timeoutMs, statusMap: parseStatusMap(env.BOOKING_PAYMENTS_STATUS_MAP), fields: parseFields(env.BOOKING_PAYMENTS_FIELDS), verify };
}

const minorOf = (raw: unknown): number | undefined => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw * 100);
  if (typeof raw === 'string' && /^\d+(\.\d{1,2})?$/.test(raw.trim())) return decimalToMinor(raw.trim().includes('.') ? raw.trim().padEnd(raw.trim().indexOf('.') + 3, '0') : `${raw.trim()}.00`);
  if (raw && typeof raw === 'object') return minorOf(pickField(raw, ['total', 'value', 'amount', 'monto']));
  return undefined;
};

/**
 * Verifica el pago consultando a Booking (D4): confirmado con monto y moneda iguales continúa; monto distinto → AMOUNT_MISMATCH;
 * pendiente → PENDING (la reserva queda en PENDING_PAYMENT y el scheduler reverifica); fallido o inexistente → PAYMENT_NOT_AUTHORIZED;
 * sin respuesta en el plazo → proveedor no disponible (503). `void`/`refund` no hacen nada: Booking ejecuta los reembolsos.
 */
export class BookingPaymentVerifier implements PaymentVerifier {
  constructor(private readonly config: BookingPaymentsConfig = { pathTemplate: '/pagos/{paymentReference}', authHeader: 'Authorization', timeoutMs: 2500, statusMap: DEFAULT_STATUS_MAP, fields: DEFAULT_FIELDS, verify: 'on' }) {}

  async verify(input: { paymentReference: string; currency: string; total: string }): Promise<PaymentResult> {
    if (this.config.verify === 'off') return 'AUTHORIZED';
    if (!this.config.baseUrl) { logger.error('BOOKING_PAYMENTS_BASE_URL is not configured; payment verification is unavailable'); throw new PaymentProviderUnavailable(); }
    const url = `${this.config.baseUrl}${this.config.pathTemplate.replace('{paymentReference}', encodeURIComponent(input.paymentReference))}`;
    let response: Response;
    try {
      response = await (this.config.fetchImpl ?? fetch)(url, { method: 'GET', redirect: 'manual', headers: { accept: 'application/json', ...(this.config.authValue ? { [this.config.authHeader]: this.config.authValue } : {}) }, signal: AbortSignal.timeout(this.config.timeoutMs) });
    } catch { logger.warn('payments api unreachable or timed out'); throw new PaymentProviderUnavailable(); }
    if (response.status === 404) throw new DomainError('PAYMENT_NOT_AUTHORIZED');
    if (response.status === 401 || response.status === 403) { logger.error(`payments api rejected our credential status=${response.status}`); throw new PaymentProviderUnavailable(); }
    if (response.status >= 300) { logger.warn(`payments api status=${response.status}`); throw new PaymentProviderUnavailable(); }
    let body: unknown;
    try { body = await response.json(); } catch { logger.warn('payments api returned a body that is not JSON'); throw new PaymentProviderUnavailable(); }
    const rawStatus = pickField(body, this.config.fields.status); const outcome = classifyStatus(rawStatus, this.config.statusMap);
    if (outcome === undefined) { logger.warn(`payments api returned an unmapped status value="${typeof rawStatus === 'string' ? rawStatus.slice(0, 32) : typeof rawStatus}"`); throw new DomainError('PAYMENT_NOT_AUTHORIZED'); }
    if (outcome === 'FAILED') throw new DomainError('PAYMENT_NOT_AUTHORIZED');
    if (outcome === 'PENDING') return 'PENDING';
    const amount = minorOf(pickField(body, this.config.fields.amount)); const currency = pickField(body, this.config.fields.currency);
    if (amount === undefined || amount !== decimalToMinor(input.total)) throw new DomainError('AMOUNT_MISMATCH');
    if (typeof currency === 'string' && currency.trim().toUpperCase() !== input.currency.toUpperCase()) throw new DomainError('AMOUNT_MISMATCH');
    return 'AUTHORIZED';
  }
  async void(): Promise<void> { /* Booking administra su cobro */ }
  async refund(): Promise<void> { /* El reembolso lo ejecuta Booking con el monto calculado por la aerolínea */ }
}
