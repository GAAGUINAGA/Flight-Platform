import { credentials, makeGenericClientConstructor, Metadata, ServerCredentials, status } from '@grpc/grpc-js';
import { service as healthService } from 'grpc-health-check';
import { createHelloServer } from './main';

describe('hello gRPC health service', () => {
  it('returns SERVING with the internal key and UNAUTHENTICATED without it', async () => {
    const key = '0123456789abcdef0123456789abcdef';
    const server = createHelloServer(key);
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, boundPort) =>
        error ? reject(error) : resolve(boundPort)));
    const Client = makeGenericClientConstructor(healthService, 'Health');
    const client = new Client(`127.0.0.1:${port}`, credentials.createInsecure());
    const check = (metadata: Metadata, serviceName = '') => new Promise<unknown>((resolve, reject) => {
      (client as unknown as { check: (request: object, metadata: Metadata, callback: (error: Error | null, value: unknown) => void) => void })
        .check({ service: serviceName }, metadata, (error, value) => error ? reject(error) : resolve(value));
    });
    try {
      await expect(check(new Metadata())).rejects.toMatchObject({ code: status.UNAUTHENTICATED });
      const metadata = new Metadata();
      metadata.set('x-internal-key', key);
      await expect(check(metadata)).resolves.toMatchObject({ status: 'SERVING' });
      await expect(check(metadata, 'x'.repeat(256))).rejects.toMatchObject({ code: status.INVALID_ARGUMENT });
    } finally {
      client.close();
      server.forceShutdown();
    }
  });
});
