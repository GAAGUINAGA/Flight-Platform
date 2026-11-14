import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CloudOff, Compass, LockKeyhole, ShieldX, type LucideIcon } from 'lucide-react';
import { usePageTitle } from '../app/page';
import { useCountdown } from '../components/ErrorPanel';
import { pageClass } from '../components/layout/AppLayout';
import { Button, ButtonLink } from '../components/ui/Button';
import ui from '../components/ui/ui.module.css';
import { loginPath, safeReturnTo } from '../session/return-to';

/** Pantallas de sistema (diseño F12c-0 §3.14). */
function StatePage({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className={pageClass}>
      <div className={ui.statePage}>
        <span className={ui.stateIcon}><Icon size={36} aria-hidden="true" /></span>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function SessionExpiredPage() {
  usePageTitle('Sesión expirada');
  const [params] = useSearchParams();
  return (
    <StatePage icon={LockKeyhole} title="Tu sesión expiró">
      <p>Por seguridad cerramos tu sesión. Inicia sesión de nuevo para continuar donde estabas.</p>
      <div className={ui.actions}>
        <ButtonLink to={loginPath(params.get('returnTo'))}>Iniciar sesión</ButtonLink>
        <ButtonLink variant="secondary" to="/">Ir al inicio</ButtonLink>
      </div>
    </StatePage>
  );
}

export function ForbiddenPage() {
  usePageTitle('Sin permiso');
  return (
    <StatePage icon={ShieldX} title="No tienes permiso para esta sección">
      <p>Tu cuenta no tiene acceso a esta parte del sitio.</p>
      <ButtonLink to="/">Ir al inicio</ButtonLink>
    </StatePage>
  );
}

/** Mensaje único: no distingue lo inexistente de lo ajeno. */
export function NotFoundPage() {
  usePageTitle('No encontrado');
  return (
    <StatePage icon={Compass} title="No encontramos esa página">
      <p>Puede que el enlace esté incompleto o que la página ya no exista.</p>
      <div className={ui.actions}>
        <ButtonLink to="/">Buscar vuelos</ButtonLink>
        <ButtonLink variant="secondary" to="/estado">Estado de un vuelo</ButtonLink>
      </div>
    </StatePage>
  );
}

/** Servicio no disponible (503/red). `?espera=N` trae el Retry-After; `?id=` el correlationId para soporte. */
export function UnavailablePage() {
  usePageTitle('Servicio no disponible');
  const [params] = useSearchParams(); const navigate = useNavigate();
  const wait = Number(params.get('espera')); const left = useCountdown(Number.isInteger(wait) && wait > 0 && wait <= 3600 ? wait : null);
  const back = safeReturnTo(params.get('returnTo')); const id = params.get('id');
  return (
    <StatePage icon={CloudOff} title="Estamos teniendo problemas">
      <p>El servicio no está disponible por ahora. No perdiste nada: vuelve a intentarlo en un momento.</p>
      {left > 0 ? <p role="status">Podrás reintentar en {left} s.</p> : null}
      <div className={ui.actions}>
        <Button onClick={() => navigate(back, { replace: true })} disabled={left > 0}>Reintentar</Button>
        <ButtonLink variant="secondary" to="/">Ir al inicio</ButtonLink>
      </div>
      {id && /^[A-Za-z0-9._-]{1,100}$/.test(id) ? <details className={ui.details}><summary>Detalles técnicos</summary>Identificador para soporte: <code>{id}</code></details> : null}
    </StatePage>
  );
}

