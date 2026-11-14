import { Component, useEffect, type ReactNode } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { PlatformHealthOperation } from '@flight-platform/graphql-schema/generated/operations';
import { AppLayout, pageClass } from '../components/layout/AppLayout';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import { AuthCallbackPage, CALLBACK_PATH, LoginPage, NewPasswordPage, RecoverPage, RegisterPage } from '../pages/AuthPages';
import { FlightStatusPage } from '../pages/FlightStatusPage';
import { HomePage } from '../pages/HomePage';
import { ResultsPage } from '../pages/ResultsPage';
import { ForbiddenPage, NotFoundPage, SelectOfferPage, SessionExpiredPage, UnavailablePage } from '../pages/SystemPages';
import { useServices, useSession } from './services';

/** Evento que emite el arranque cuando el servicio rechaza un token que la app creía vigente. */
export const SESSION_EXPIRED_EVENT = 'fp:session-expired';
const PUBLIC_AUTH = ['/acceso', '/registro', '/recuperar', '/nueva-contrasena', '/sesion-expirada'];

/** Lleva a «Sesión expirada» (conservando a dónde volver) cuando la sesión termina sin que el usuario la cierre. */
function SessionWatcher() {
  const session = useSession(); const navigate = useNavigate(); const location = useLocation();
  const expired = session.status === 'anonymous' && session.expired;
  useEffect(() => {
    const go = (): void => {
      if (PUBLIC_AUTH.some((path) => location.pathname.startsWith(path))) return;
      navigate(`/sesion-expirada?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`, { replace: true });
    };
    if (expired) go();
    window.addEventListener(SESSION_EXPIRED_EVENT, go);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, go);
  }, [expired, location.pathname, location.search, navigate]);
  return null;
}

/** Primera consulta ligera en segundo plano para despertar la cadena mientras el usuario escribe su búsqueda (diseño §9.1). Inicio no depende de ella. */
function WarmUp() {
  const { client } = useServices();
  useEffect(() => { client.execute(PlatformHealthOperation, {}).catch(() => undefined); }, [client]);
  return null;
}

/** Último recurso ante un fallo de la propia interfaz: mensaje genérico, sin detalles internos. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={pageClass}>
        <Notice kind="error" title="Ocurrió un error inesperado.">
          <p>Recarga la página para continuar.</p>
          <Button size="small" variant="secondary" onClick={() => window.location.reload()}>Recargar</Button>
        </Notice>
      </div>
    );
  }
}

export function AppRoutes() {
  return (
    <ErrorBoundary>
      <SessionWatcher />
      <WarmUp />
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="resultados" element={<ResultsPage />} />
          <Route path="oferta/:offerId" element={<SelectOfferPage />} />
          <Route path="estado" element={<FlightStatusPage />} />
          <Route path="acceso" element={<LoginPage />} />
          <Route path={CALLBACK_PATH.slice(1)} element={<AuthCallbackPage />} />
          <Route path="registro" element={<RegisterPage />} />
          <Route path="recuperar" element={<RecoverPage />} />
          <Route path="nueva-contrasena" element={<NewPasswordPage />} />
          <Route path="sesion-expirada" element={<SessionExpiredPage />} />
          <Route path="sin-permiso" element={<ForbiddenPage />} />
          <Route path="no-disponible" element={<UnavailablePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
