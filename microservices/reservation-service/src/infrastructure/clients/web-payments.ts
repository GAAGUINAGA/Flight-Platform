import { Logger } from '@nestjs/common';
import { DomainError } from '@flight-platform/shared';
import type { PaymentResult, PaymentVerifier } from '../../application/ports';

/**
 * Canal de pago `WEB` (ADR-F12c-02): la web propia vende con PAGO SIMULADO de prueba, sin cobro. Solo funciona con `WEB_PAYMENT_MODE=simulated`;
 * sin la variable (o con otro valor) toda verificación del canal se rechaza con `PAYMENT_NOT_AUTHORIZED` y no se vende nada.
 * El Gateway es quien asigna el canal, solo por el rol del token; un socio nunca llega aquí.
 */
export type WebPaymentMode = 'simulated' | 'off';
export const webPaymentModeFromEnv = (env: Record<string, string | undefined>): WebPaymentMode => env.WEB_PAYMENT_MODE?.trim() === 'simulated' ? 'simulated' : 'off';

export class WebPaymentVerifier implements PaymentVerifier {
  constructor(private readonly mode: WebPaymentMode, private readonly simulated: PaymentVerifier) {}
  async verify(input: { paymentReference: string; currency: string; total: string; channel?: string }): Promise<PaymentResult> {
    if (this.mode !== 'simulated') throw new DomainError('PAYMENT_NOT_AUTHORIZED');
    return this.simulated.verify(input);
  }
  async void(input: { paymentReference: string }): Promise<void> { await this.simulated.void(input); }
  async refund(input: { paymentReference: string; amount: string; currency: string }): Promise<void> { await this.simulated.refund?.(input); }
}

export function warnWebPayments(mode: WebPaymentMode, logger: Pick<Logger, 'warn'> = new Logger('WebPayments')): void {
  logger.warn(mode === 'simulated'
    ? 'WEB_PAYMENT_MODE=simulated: el canal WEB acepta PAGOS SIMULADOS (referencias pay_ok_*): solo reservas de prueba.'
    : 'WEB_PAYMENT_MODE no es "simulated": el canal WEB rechaza todo pago (la web no puede vender).');
}
