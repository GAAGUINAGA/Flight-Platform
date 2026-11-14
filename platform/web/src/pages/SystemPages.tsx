import type { ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CloudOff, Compass, LockKeyhole, ShieldX, Ticket, type LucideIcon } from 'lucide-react';
import { brand } from '@flight-platform/brand';
import { formatMoney, type MoneyLike } from '@flight-platform/format';
import { usePageTitle } from '../app/page';
import { useSession } from '../app/services';
import { useCountdown } from '../components/ErrorPanel';
import { pageClass } from '../components/layout/AppLayout';
import { Button, ButtonLink } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { loginPath, safeReturnTo } from '../session/return-to';
import styles from './pages.module.css';

/** Pantallas de sistema (diseño F12c-0 §3.14) y la pantalla provisional de «elegir oferta» (la compra llega en F12c-2b). */
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

interface OfferState { route?: string; total?: MoneyLike; back?: string }

/** Provisional: desde Resultados, «Elegir» llega aquí. Invita a iniciar sesión o avisa que la compra llega en la próxima versión. */
export function SelectOfferPage() {
  usePageTitle('Tu selección');
  const session = useSession(); const location = useLocation();
  const state = (location.state ?? {}) as OfferState;
  const back = safeReturnTo(state.back, '/');
  return (
    <StatePage icon={Ticket} title="Ya casi puedes comprar aquí">
      {state.route ? (
        <div className={styles.summary}>
          <strong>{state.route}</strong>
          {state.total && typeof state.total.total === 'string' ? <span>Total desde {formatMoney(state.total)}</span> : null}
        </div>
      ) : null}
      <Notice kind="info" title={brand.texts.purchaseComingSoon}>
        <p>Por ahora puedes buscar vuelos y consultar su estado. La selección de asientos, los pasajeros y el pago simulado se habilitan en la siguiente entrega.</p>
      </Notice>
      {session.status === 'authenticated'
        ? <p>Tu sesión está iniciada: cuando la compra esté disponible podrás continuar sin registrarte de nuevo.</p>
        : <p>Mientras tanto, crea tu cuenta o inicia sesión para tenerla lista.</p>}
      <div className={ui.actions}>
        {session.status === 'authenticated' ? null : <><ButtonLink to={loginPath(`${location.pathname}`)}>Iniciar sesión</ButtonLink><ButtonLink variant="secondary" to="/registro">Crear cuenta</ButtonLink></>}
        <ButtonLink variant="secondary" to={back}>Volver a los resultados</ButtonLink>
      </div>
    </StatePage>
  );
}
