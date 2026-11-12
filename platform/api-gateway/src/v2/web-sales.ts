import { Logger } from '@nestjs/common';
import type { AuthContext } from '../auth';
import type { GatewayConfig } from '../config';
import { GatewayProblemError } from '../web-errors';

/**
 * Canal de venta de la web (ADR-F12c-02, B-1). El canal lo decide SOLO el rol del token: un `partner` (Booking) usa `BOOKING`
 * y su verificación no cambia; cualquier otro usuario autenticado (cliente o administrador de Supabase) usa `WEB`, el pago simulado de prueba.
 * Nunca se lee del cuerpo ni de cabeceras.
 */
export type SaleChannel = 'BOOKING' | 'WEB';
export const channelFor = (auth: AuthContext): SaleChannel => auth.clientId ? 'BOOKING' : 'WEB';

/** `ProblemDetails.type` de los rechazos propios del canal WEB: el `code` queda dentro del enum de v2 y el front distingue el caso por el tipo. */
export const WEB_PROBLEM_TYPES = {
  disabled: 'web-payments-disabled', emailNotVerified: 'email-not-verified', activeBookings: 'web-active-bookings-limit', passengersPerDay: 'web-passengers-per-day-limit'
} as const;

/** Marca de las reservas del canal WEB en el estado v2 (`salesChannel`): son de prueba; `passengers` sirve al tope diario por usuario. */
export const WEB_TEST_PARTNER_ID = 'WEB_TEST';
export const webSalesChannel = (passengers: number): { partnerId: string; passengers: number } => ({ partnerId: WEB_TEST_PARTNER_ID, passengers });
export const isWebTestBooking = (salesChannel: Record<string, unknown> | undefined): boolean => salesChannel?.partnerId === WEB_TEST_PARTNER_ID;
export const webPassengerCount = (salesChannel: Record<string, unknown> | undefined): number => typeof salesChannel?.passengers === 'number' ? salesChannel.passengers : 0;

/** Avisa al arrancar si el canal WEB vende o no (y si el valor de WEB_PAYMENT_MODE no se reconoce). Sin valores secretos. */
export function warnWebSales(config: GatewayConfig, logger: Pick<Logger, 'warn'> = new Logger('WebSales')): void {
  if (config.web.paymentMode === 'simulated') { logger.warn('WEB_PAYMENT_MODE=simulated: el canal WEB vende con PAGO SIMULADO (reservas de prueba, sin cobro).'); return; }
  logger.warn(config.web.paymentModeRaw
    ? 'WEB_PAYMENT_MODE tiene un valor desconocido: las ventas de la web están DESHABILITADAS (solo se reconoce "simulated").'
    : 'WEB_PAYMENT_MODE no está definida: las ventas de la web están DESHABILITADAS.');
}

/** Sin `WEB_PAYMENT_MODE=simulated` ninguna operación de pago del canal WEB se acepta (sin valor por omisión que permita vender). */
export function assertWebPaymentsEnabled(config: GatewayConfig): void {
  const valid = (value: unknown): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
  // Falla cerrado: sin topes validos (config construida a mano o corrupta) la web no vende; loadConfig ya impide arrancar con valores invalidos.
  if (config.web.paymentMode !== 'simulated' || !valid(config.web.maxActiveBookings) || !valid(config.web.maxPassengersPerDay)) throw new GatewayProblemError(422, 'PAYMENT_NOT_AUTHORIZED', 'Las ventas de prueba de la web están deshabilitadas', WEB_PROBLEM_TYPES.disabled);
}

/** Solo usuarios con el correo confirmado: lee el claim `email_verified` del JWT (lo agrega el hook de Supabase desde `email_confirmed_at`). */
export function assertVerifiedEmail(config: GatewayConfig, auth: AuthContext): void {
  if (config.web.requireVerifiedEmail && auth.emailVerified !== true) throw new GatewayProblemError(403, 'FORBIDDEN', 'Confirma tu correo para reservar', WEB_PROBLEM_TYPES.emailNotVerified);
}

/** Pagos del canal WEB (reserva, equipaje, cambio de fecha): interruptor y correo confirmado. */
export function assertWebMayPay(config: GatewayConfig, auth: AuthContext): void { assertWebPaymentsEnabled(config); assertVerifiedEmail(config, auth); }

/**
 * Los topes por usuario los aplica Reservation (ADR-F12c-03) en la transacción que inserta la reserva; el Gateway solo envía los valores configurados
 * con la petición del canal WEB y traduce el rechazo: 429 RATE_LIMIT_EXCEEDED con el tipo propio de cada tope. Cualquier otro error pasa tal cual.
 */
export const webLimitsFor = (config: GatewayConfig): { webMaxActiveBookings: number; webMaxPassengersPerDay: number } => ({ webMaxActiveBookings: config.web.maxActiveBookings, webMaxPassengersPerDay: config.web.maxPassengersPerDay });
export function translateWebLimitError(error: unknown): unknown {
  const details = typeof error === 'object' && error !== null ? (error as { details?: unknown }).details : undefined;
  if (details === 'WEB_ACTIVE_LIMIT_EXCEEDED') return new GatewayProblemError(429, 'RATE_LIMIT_EXCEEDED', 'Alcanzaste el máximo de reservas activas de prueba', WEB_PROBLEM_TYPES.activeBookings);
  if (details === 'WEB_PASSENGERS_LIMIT_EXCEEDED') return new GatewayProblemError(429, 'RATE_LIMIT_EXCEEDED', 'Alcanzaste el máximo de pasajeros por día de las reservas de prueba', WEB_PROBLEM_TYPES.passengersPerDay);
  return error;
}
