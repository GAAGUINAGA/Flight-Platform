import { LoggerModule } from 'nestjs-pino';

export const REDACTED_LOG_PATHS = [
  'documentNumber', 'email', 'phone', 'firstName', 'lastName', 'authorization', 'secret', 'paymentReference', 'ownerId', 'internalApiKey',
  '*.documentNumber', '*.email', '*.phone', '*.firstName', '*.lastName', '*.authorization', '*.secret', '*.paymentReference', '*.ownerId', '*.internalApiKey', 'sensitive.ownerId', 'sensitive.internalApiKey',
  'req.headers.authorization', 'req.headers.cookie', 'req.body',
  'req.headers["x-webhook-signature"]', 'req.headers["x-api-key"]', 'req.headers["x-user-id"]', 'req.headers["x-device-fingerprint"]',
  '*.headers["x-webhook-signature"]', '*.headers["x-api-key"]', '*.headers["x-user-id"]', '*.headers["x-device-fingerprint"]'
];

export const loggerOptions = { redact: { paths: REDACTED_LOG_PATHS, censor: '[REDACTED]' } };

export function createLoggerModule() {
  return LoggerModule.forRoot({ pinoHttp: loggerOptions });
}
