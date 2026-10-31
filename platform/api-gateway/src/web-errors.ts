import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { problemFor, problemFromGrpc, type ProblemDetails } from './errors';
import { isV2Path, v2ProblemFromError } from './v2/problem';

export class GatewayProblemError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, public readonly safeDetail?: string) { super(code); }
}

export function asProblem(error: unknown, operation?: string): ProblemDetails {
  if (error instanceof GatewayProblemError) return { ...problemFor(error.code), status: error.statusCode, ...(error.statusCode === 503 ? { title: 'Service Unavailable' } : {}), detail: error.safeDetail };
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number') { const details = (error as { details?: unknown }).details; return problemFromGrpc(error.code, typeof details === 'string' ? details : undefined, operation); }
  if (error instanceof HttpException || (typeof error === 'object' && error !== null && 'getStatus' in error && typeof (error as { getStatus?: unknown }).getStatus === 'function')) {
    const status = (error as HttpException).getStatus();
    if (status === 401 || status === 403 || status === 404 || status === 405 || status === 413) return { ...problemFor('VALIDATION_FAILED'), status, detail: status === 404 ? 'Resource not found' : 'Request could not be processed' };
    return { ...problemFor('VALIDATION_FAILED'), status: 400, detail: 'Request could not be processed' };
  }
  if (typeof error === 'object' && error !== null && 'status' in error && typeof (error as { status: unknown }).status === 'number') {
    const status = (error as { status: number }).status;
    if (status === 400 || status === 404 || status === 405 || status === 413) return { ...problemFor('VALIDATION_FAILED'), status, detail: status === 404 ? 'Resource not found' : 'Request could not be processed' };
  }
  return { ...problemFor('VALIDATION_FAILED'), status: 500, title: 'Internal Server Error', detail: 'An unexpected error occurred' };
}

@Catch()
@Injectable()
export class GatewayExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp(); const response = http.getResponse<Response>(); const request = http.getRequest<{ method: string; path: string }>();
    if (isV2Path(request.path)) {
      const v2 = v2ProblemFromError(error, { method: request.method, path: request.path, correlationId: String(response.getHeader('X-Correlation-Id') ?? '') || undefined });
      if (v2.status === 503 && !response.getHeader('Retry-After')) response.setHeader('Retry-After', '5');
      response.status(v2.status).type('application/problem+json').json(v2); return;
    }
    const problem = asProblem(error, request.method === 'POST' && request.path === '/flights/v1/bookings' ? 'booking' : undefined);
    if (problem.status === 404 && request.path === '/flights/v1/health' && request.method !== 'GET') problem.status = 405;
    if (problem.status === 503) response.setHeader('Retry-After', '5');
    response.status(problem.status).type('application/problem+json').json(problem);
  }
}
