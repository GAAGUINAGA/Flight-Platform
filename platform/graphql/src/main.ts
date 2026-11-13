import process from 'node:process';
import { setTimeout } from 'node:timers';
import { knownOperations } from '@flight-platform/graphql-schema';
import { loadConfig } from './config';
import { createApp } from './infrastructure/app';
import { PinoAuditLog } from './infrastructure/audit-log';
import { HttpGateway } from './infrastructure/http-gateway';
import { JoseTokenVerifier } from './infrastructure/jwt-verifier';
import { buildServiceSchema } from './infrastructure/schema';

function main(): void {
  const config = loadConfig();
  const app = createApp({ config, schema: buildServiceSchema(), gateway: new HttpGateway(config.gatewayBaseUrl, config.gatewayTimeoutMs), verifier: new JoseTokenVerifier(config.jwtIssuers), known: knownOperations(), log: new PinoAuditLog() });
  const server = app.listen(config.port, () => { process.stdout.write(`graphql listening on ${config.port} (${config.production ? 'production' : 'development'})\n`); });
  const stop = (): void => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
main();
