const grpc = require('@grpc/grpc-js');
const { loadSync } = require('@grpc/proto-loader');
const { loadPackageDefinition } = grpc;
const { join } = require('node:path');
const process = require('node:process');

const address = process.env.OPERATIONS_GRPC_URL || '127.0.0.1:50056';
const key = process.env.INTERNAL_API_KEY;
const flightNumber = process.env.FLIGHT_NUMBER;
const date = process.env.FLIGHT_DATE;
const flightInstanceId = process.env.FLIGHT_INSTANCE_ID;
if (!key || !flightNumber || !date || !flightInstanceId) throw new Error('INTERNAL_API_KEY, FLIGHT_NUMBER, FLIGHT_DATE and FLIGHT_INSTANCE_ID are required');

const root = join(process.cwd(), 'contracts', 'proto');
const definition = loadSync(join(root, 'flightplatform', 'operations', 'v1', 'operations.proto'), { includeDirs: [root], keepCase: false, enums: String, longs: Number, defaults: true, arrays: true, objects: true });
const pkg = loadPackageDefinition(definition);
const OperationsService = pkg.flightplatform.operations.v1.OperationsService;
const client = new OperationsService(address, process.env.GRPC_TLS === 'true' ? grpc.credentials.createSsl() : grpc.credentials.createInsecure());
const call = (method, request, metadata) => new Promise((resolve, reject) => client[method](request, metadata, { deadline: Date.now() + 5000 }, (error, response) => error ? reject(error) : resolve(response)));
const metadata = (includeKey) => { const value = new grpc.Metadata(); if (includeKey) value.set('x-internal-key', key); value.set('x-correlation-id', 'operations-smoke'); value.set('x-role', 'admin'); return value; };

(async () => {
  try {
    try {
      await call('getFlightStatus', { flightNumber, date }, metadata(false));
      throw new Error('GetFlightStatus without key unexpectedly succeeded');
    } catch (error) {
      if (error.code !== grpc.status.UNAUTHENTICATED) throw error;
    }
    const before = await call('getFlightStatus', { flightNumber, date }, metadata(true));
    await call('recordOperationalUpdate', { flightInstanceId, status: 'DELAYED', estimatedDepartureAt: new Date(Date.parse(before.departure.scheduledAt) + 15 * 60_000).toISOString() }, metadata(true));
    const after = await call('getFlightStatus', { flightNumber, date }, metadata(true));
    if (!after.departure.estimatedAt) throw new Error('estimatedAt missing after operational delay');
    process.stdout.write('GetFlightStatus, delay update, estimatedAt verification and unauthenticated rejection passed\n');
  } finally {
    client.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
