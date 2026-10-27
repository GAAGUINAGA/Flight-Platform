import { DomainError } from '@flight-platform/shared';
import { PaymentResult, PaymentVerifier } from '../../application/ports';

/**
 * Elige el verificador por canal: sin canal (v1) se usa el de siempre; con `BOOKING` (clientes client_credentials de v2)
 * se consulta a Booking. Un canal desconocido se rechaza en lugar de caer al verificador permisivo.
 */
export class RoutingPaymentVerifier implements PaymentVerifier {
  constructor(private readonly fallback: PaymentVerifier, private readonly channels: Record<string, PaymentVerifier>) {}
  async verify(input: { paymentReference: string; currency: string; total: string; channel?: string }): Promise<PaymentResult> {
    if (!input.channel) return this.fallback.verify(input);
    const verifier = Object.hasOwn(this.channels, input.channel) ? this.channels[input.channel] : undefined;
    if (!verifier) throw new DomainError('VALIDATION_FAILED');
    return verifier.verify(input);
  }
  void(input: { paymentReference: string }): Promise<void> { return this.fallback.void(input); }
  async refund(input: { paymentReference: string; amount: string; currency: string }): Promise<void> { await this.fallback.refund?.(input); }
}
