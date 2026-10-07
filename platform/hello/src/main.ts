import { sendUnaryData, Server, ServerCredentials, ServerUnaryCall, ServiceError } from '@grpc/grpc-js';
import { service as healthService } from 'grpc-health-check';
import { buildRequestContext, safeGrpcError, validate } from '@flight-platform/shared';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { z } from 'zod';

const healthRequestSchema = z.object({ service: z.string().trim().max(255) });

export function createHelloServer(internalApiKey: string): Server {
  if (Buffer.byteLength(internalApiKey) < 32) throw new Error('INTERNAL_API_KEY must be at least 32 bytes');
  const server = new Server();
  server.addService({ Check: healthService.Check }, {
    Check: (call: ServerUnaryCall<{ service: string }, { status: string }>, callback: sendUnaryData<{ status: string }>) => {
      try {
        buildRequestContext(call.metadata, internalApiKey);
        validate(healthRequestSchema, call.request);
        callback(null, { status: 'SERVING' });
      } catch (error) {
        callback(safeGrpcError(error) as ServiceError);
      }
    }
  });
  return server;
}

if (process.argv[1]?.endsWith('main.js')) {
  const key = process.env.INTERNAL_API_KEY;
  if (!key) throw new Error('INTERNAL_API_KEY is required');
  const port = Number(process.env.PORT ?? '8080');
  const server = createHelloServer(key);
  server.bindAsync(`0.0.0.0:${port}`, ServerCredentials.createInsecure(), (error) => {
    if (error) throw error;
  });
}
