/* global fetch, Response, AbortSignal */
import { URL } from 'node:url';
import { gatewayUnavailable } from '../domain/errors';
import type { GatewayPort, GatewayRequest, GatewayResponse } from '../application/ports';

/** Adaptador HTTP del Gateway (fetch). Tiempo máximo por llamada; un fallo de red o un tiempo agotado es `GATEWAY_UNAVAILABLE` (nunca el detalle interno). */
export class HttpGateway implements GatewayPort {
  constructor(private readonly baseUrl: string, private readonly timeoutMs: number, private readonly fetchImpl: typeof fetch = fetch) {}
  async send(request: GatewayRequest): Promise<GatewayResponse> {
    const url = new URL(`${this.baseUrl}${request.path}`);
    for (const [name, value] of Object.entries(request.query ?? {})) if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
    const headers: Record<string, string> = { Accept: 'application/json' };
    for (const [name, value] of Object.entries(request.headers)) if (value !== undefined) headers[name] = value;
    if (request.body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: request.method, headers, ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}), signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
    } catch { throw gatewayUnavailable(); }
    const retryAfter = response.headers.get('retry-after');
    if (response.status === 204) return { status: 204, body: undefined, retryAfter, invalidBody: false };
    const text = await response.text().catch(() => '');
    if (text === '') return { status: response.status, body: undefined, retryAfter, invalidBody: false };
    try { return { status: response.status, body: JSON.parse(text), retryAfter, invalidBody: false }; } catch { return { status: response.status, body: undefined, retryAfter, invalidBody: true }; }
  }
}
