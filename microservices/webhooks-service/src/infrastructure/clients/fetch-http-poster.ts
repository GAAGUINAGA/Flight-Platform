/* global fetch, AbortSignal */
import { HttpPoster } from '../../application/ports';
export class FetchHttpPoster implements HttpPoster { async post(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<number> { const response = await fetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) }); return response.status; } }
