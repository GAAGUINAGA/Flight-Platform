const grpc = require('@grpc/grpc-js');
const { service } = require('grpc-health-check');
const process = require('node:process');

const address = process.argv[2] || '127.0.0.1:50059';
const key = process.argv[3];
if (!key) throw new Error('Usage: node smoke-hello.cjs <address> <internal-key>');

const HealthClient = grpc.makeGenericClientConstructor(service, 'Health');
const client = new HealthClient(address, grpc.credentials.createInsecure());

const check = (metadata) => new Promise((resolve, reject) => {
  client.check({ service: '' }, metadata, { deadline: Date.now() + 5000 }, (error, response) => {
    if (error) reject(error);
    else resolve(response);
  });
});

(async () => {
  try {
    try {
      await check(new grpc.Metadata());
      throw new Error('Unauthenticated check unexpectedly succeeded');
    } catch (error) {
      if (error.code !== grpc.status.UNAUTHENTICATED) throw error;
    }
    const metadata = new grpc.Metadata();
    metadata.set('x-internal-key', key);
    const response = await check(metadata);
    if (response.status !== 'SERVING') throw new Error(`Unexpected health status: ${response.status}`);
    process.stdout.write('UNAUTHENTICATED without key; SERVING with key\n');
  } finally {
    client.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
