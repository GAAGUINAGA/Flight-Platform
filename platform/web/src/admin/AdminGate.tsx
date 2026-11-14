import { lazy, Suspense } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../app/services';
import { LoadingState } from '../components/ui/LoadingState';
import { ForbiddenPage } from '../pages/SystemPages';
import { loginPath } from '../session/return-to';

/**
 * El panel es un FRAGMENTO CARGADO APARTE: su código no se descarga para los clientes (el `import()` solo se ejecuta tras comprobar el rol).
 * La guardia por rol es una comodidad de la interfaz (PLAN §2.3): la autoridad es el servicio GraphQL (`@admin`) y el Gateway, que rechazan con 403 a quien no es administrador.
 */
const AdminRoutes = lazy(() => import('./AdminRoutes'));

export function AdminGate() {
  const session = useSession(); const location = useLocation();
  if (session.status === 'loading') return <LoadingState phase="normal" label="Verificando tu sesión" />;
  if (session.status === 'anonymous') {
    // Una sesión vencida la atiende el vigilante de sesión («Tu sesión expiró»); sin sesión, al inicio de sesión y de vuelta al panel.
    return session.expired ? null : <Navigate to={loginPath(`${location.pathname}${location.search}`)} replace />;
  }
  if (session.user.role !== 'admin') return <ForbiddenPage />;
  return <Suspense fallback={<LoadingState phase="normal" label="Cargando el panel" />}><AdminRoutes /></Suspense>;
}
