import { LoggerModule } from 'nestjs-pino';

export const REDACTED_LOG_PATHS = [
  'documentNumber', 'email', 'phone', 'firstName', 'lastName', 'authorization', 'secret', 'paymentReference',
  '*.documentNumber', '*.email', '*.phone', '*.firstName', '*.lastName', '*.authorization', '*.secret', '*.paymentReference',
  'req.headers.authorization', 'req.headers.cookie', 'req.body'
];

export const loggerOptions = { redact: { paths: REDACTED_LOG_PATHS, censor: '[REDACTED]' } };

export function createLoggerModule() {
  return LoggerModule.forRoot({ pinoHttp: loggerOptions });
}
