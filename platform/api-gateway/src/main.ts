import process from 'node:process';
import { createGatewayApp } from './app';
import { loadConfig } from './config';
import { warnWebSales } from './v2/web-sales';

async function bootstrap() { const config = loadConfig(); warnWebSales(config); if (config.transport === 'esb' && process.env.NODE_ENV === 'production' && !config.esbUrlConfigured) throw new Error('ESB_URL is required when GATEWAY_TRANSPORT=esb in production'); const app = await createGatewayApp(config); await app.listen(config.port, '0.0.0.0'); }
void bootstrap();
