import { createGatewayApp } from './app';
import { loadConfig } from './config';

async function bootstrap() { const config = loadConfig(); const app = await createGatewayApp(config); await app.listen(config.port, '0.0.0.0'); }
void bootstrap();
