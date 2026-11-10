/** Política de reintento del consumidor del bus (ADR-F12b-05). Los nombres de cola coinciden con la topología que declara el ESB. */
export const DEFAULT_EVENTS_QUEUE = 'q.webhooks.entrega';
export const DEFAULT_MAX_ATTEMPTS = 3;
export const waitQueueName = (queue: string, step: number): string => `${queue}.espera.${step}`;
export const failedQueueName = (queue: string): string => `${queue}.fallidos`;

export type RetryDecision = { action: 'retry'; queue: string; attempt: number } | { action: 'fail'; queue: string };
/** Un error no reintentable o el último intento van a fallidos; si no, a la siguiente cola de espera. */
export function retryDecision(queue: string, attempt: number, maxAttempts: number, retryable: boolean): RetryDecision {
  if (!retryable || attempt >= maxAttempts) return { action: 'fail', queue: failedQueueName(queue) };
  return { action: 'retry', queue: waitQueueName(queue, attempt + 1), attempt: attempt + 1 };
}
