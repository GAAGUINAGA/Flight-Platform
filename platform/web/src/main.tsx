import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { createSessionClient } from '@flight-platform/session';
import './brand/assets';
import './styles/global.css';
import { AppRoutes, SESSION_EXPIRED_EVENT } from './app/App';
import { ServicesProvider, type Services } from './app/services';
import { missingConfig, readConfig } from './config';
import { createGraphqlClient } from './data/graphql-client';
import { browserStore, deviceIdProvider } from './data/identity';

/** Arranque: crea UNA vez la sesión (Supabase, PKCE, almacenamiento del navegador) y la capa de datos (solo el servicio GraphQL). */
function bootstrap(): void {
  const root = createRoot(document.getElementById('root')!);
  const config = readConfig();
  const missing = missingConfig(config);
  if (missing.length > 0) {
    root.render(<p role="alert">Falta configuración pública de la aplicación: {missing.join(', ')}.</p>);
    return;
  }
  const store = browserStore();
  const session = createSessionClient({ supabaseUrl: config.supabaseUrl, anonKey: config.supabaseAnonKey, storage: store });
  const client = createGraphqlClient({
    url: config.graphqlUrl,
    getAccessToken: () => session.getAccessToken(),
    deviceId: deviceIdProvider(store),
    timeoutMs: config.loading.timeoutMs,
    retry: config.retry,
    onSessionRejected: () => { void session.signOut().finally(() => window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))); }
  });
  const services: Services = { config, client, session };
  void session.start();
  root.render(
    <StrictMode>
      <ServicesProvider services={services}>
        <BrowserRouter><AppRoutes /></BrowserRouter>
      </ServicesProvider>
    </StrictMode>
  );
}

bootstrap();
