import { EventPublisher } from '../../application/ports';

/** D-16: Webhooks a?n no est? desplegado; los eventos se descartan. */
export class NoopEventPublisher implements EventPublisher {
  async publish(): Promise<void> {
    // intencionalmente vac?o
  }
}
