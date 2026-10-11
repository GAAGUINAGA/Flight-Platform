import { credentials, makeGenericClientConstructor, Metadata } from '@grpc/grpc-js';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import type { GatewayConfig } from './config';
import type { AuthContext } from './auth';
import { createGrpcMetadata } from '@flight-platform/shared';

type UnaryClient = { Execute(request: Buffer, metadata: Metadata, callback: (error: Error | null, response?: Buffer | unknown) => void): void; close(): void };
const serialize = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const deserialize = (value: Buffer | unknown): unknown => Buffer.isBuffer(value) ? JSON.parse(value.toString('utf8')) : value;
const Client = makeGenericClientConstructor({ Execute: { path: '/flight.gateway.test.v1.GatewayTest/Execute', requestStream: false, responseStream: false, requestSerialize: serialize, requestDeserialize: deserialize, responseSerialize: serialize, responseDeserialize: deserialize } }, 'GatewayTest') as unknown as new (address: string, channelCredentials: unknown) => UnaryClient;

export class GatewayTestGrpcClient {
  constructor(private readonly config: GatewayConfig) {}
  async execute(auth: AuthContext, correlationId: string): Promise<unknown> {
    const target = process.env.GATEWAY_TEST_GRPC_URL ?? '127.0.0.1:50058'; const client = new Client(target, this.config.grpcTls ? credentials.createSsl() : credentials.createInsecure());
    const metadata = createGrpcMetadata({ url: target, internalApiKey: this.config.internalApiKey, correlationId, ownerId: auth.ownerId, role: auth.role });
    return new Promise((resolve, reject) => client.Execute(Buffer.from('{}'), metadata, (error, response) => { client.close(); if (error) reject(error); else resolve(response ? deserialize(response) : {}); }));
  }
}
