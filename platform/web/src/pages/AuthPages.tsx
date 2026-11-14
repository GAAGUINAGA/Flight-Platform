import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Plane } from 'lucide-react';
import type { AuthFailure } from '@flight-platform/session';
import { usePageTitle } from '../app/page';
import { useServices, useSession } from '../app/services';
import { pageClass } from '../components/layout/AppLayout';
import { Button, ButtonLink } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { LoadingState } from '../components/ui/LoadingState';
import { Notice } from '../components/ui/Notice';
import ui from '../components/ui/ui.module.css';
import { loginPath, safeReturnTo } from '../session/return-to';
import styles from './pages.module.css';

/**
 * Acceso con Supabase Auth (diseño F12c-0 §3.4). Las credenciales van del navegador a Supabase: nunca pasan por GraphQL ni por el Gateway.
 * Mensajes genéricos: no revelan si un correo tiene cuenta.
 */
const MIN_PASSWORD = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CALLBACK_PATH = '/acceso/retorno';
const callbackUrl = (): string => `${window.location.origin}${CALLBACK_PATH}`;

const FAILURE_MESSAGES: Record<AuthFailure, string> = {
  invalid_credentials: 'Correo o contraseña incorrectos.',
  email_not_confirmed: 'Confirma tu correo con el enlace que te enviamos y vuelve a intentarlo.',
  weak_password: `La contraseña es demasiado débil. Usa al menos ${MIN_PASSWORD} caracteres y evita contraseñas comunes.`,
  same_password: 'La nueva contraseña debe ser distinta de la anterior.',
  rate_limited: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  link_expired: 'El enlace venció o ya se usó. Solicita uno nuevo.',
  signup_failed: 'No pudimos crear la cuenta. Si ya tienes una, inicia sesión o recupera tu contraseña.',
  network: 'No pudimos conectar con el servicio de acceso. Revisa tu conexión e inténtalo de nuevo.',
  unknown: 'Ocurrió un error inesperado. Inténtalo de nuevo.'
};
export const failureMessage = (reason: AuthFailure): string => FAILURE_MESSAGES[reason];

function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={pageClass}>
      <div className={styles.authLayout}>
        <div className={styles.authIntro}>
          <span className={ui.eyebrow}>Bienvenido a tu próximo viaje</span>
          <h1>{title}</h1>
          <p>Administra tus viajes desde un solo lugar. Tu contraseña se envía directamente al servicio de acceso, cifrada en tránsito.</p>
          <Plane size={96} aria-hidden="true" strokeWidth={1} />
        </div>
        <div className={ui.card}>{children}</div>
      </div>
    </div>
  );
}

const validEmail = (email: string): string | undefined => (EMAIL.test(email.trim()) ? undefined : 'Escribe un correo válido.');
const validPassword = (password: string): string | undefined => (password.length >= MIN_PASSWORD ? undefined : `Usa al menos ${MIN_PASSWORD} caracteres.`);

export function LoginPage() {
  usePageTitle('Iniciar sesión');
  const { session: client } = useServices(); const session = useSession();
  const [params] = useSearchParams(); const navigate = useNavigate();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null); const [busy, setBusy] = useState(false);

  if (session.status === 'authenticated' && !busy) return <Navigate to={returnTo} replace />;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const found = { email: validEmail(email), password: password ? undefined : 'Escribe tu contraseña.' };
    setErrors(found); setFailure(null);
    if (found.email || found.password) return;
    setBusy(true);
    const result = await client.signIn(email.trim(), password);
    setBusy(false);
    if (result.ok) navigate(returnTo, { replace: true }); else { setFailure(result.reason); setPassword(''); }
  };

  return (
    <AuthShell title="Todo tu viaje, en un solo lugar">
      <form className={styles.authForm} onSubmit={(event) => { void submit(event); }} noValidate>
        <h2>Iniciar sesión</h2>
        {params.get('cuenta') === 'confirmada' ? <Notice kind="success"><p>Tu correo quedó confirmado. Ya puedes iniciar sesión.</p></Notice> : null}
        {failure ? <Notice kind="error"><p>{failureMessage(failure)}</p></Notice> : null}
        <TextField label="Correo electrónico" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} error={errors.email} />
        <TextField label="Contraseña" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} error={errors.password} />
        <Button type="submit" block loading={busy}>Iniciar sesión</Button>
        <div className={styles.authLinks}>
          <Link to="/recuperar">¿Olvidaste tu contraseña?</Link>
          <Link to={params.get('returnTo') ? `/registro?returnTo=${encodeURIComponent(returnTo)}` : '/registro'}>Crear una cuenta</Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  usePageTitle('Crear cuenta');
  const { session: client } = useServices(); const session = useSession();
  const [params] = useSearchParams(); const navigate = useNavigate();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null); const [busy, setBusy] = useState(false); const [pending, setPending] = useState(false);

  if (session.status === 'authenticated' && !busy) return <Navigate to={returnTo} replace />;

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const found = { email: validEmail(email), password: validPassword(password) };
    setErrors(found); setFailure(null);
    if (found.email || found.password) return;
    setBusy(true);
    const result = await client.signUp({ email: email.trim(), password, ...(name.trim() ? { name: name.trim() } : {}), redirectTo: callbackUrl() });
    setBusy(false);
    if (!result.ok) { setFailure(result.reason); return; }
    if (result.needsEmailConfirmation) setPending(true); else navigate(returnTo, { replace: true });
  };

  if (pending) {
    return (
      <AuthShell title="Revisa tu correo">
        <div className={styles.authForm}>
          <h2>Confirma tu correo</h2>
          <Notice kind="success"><p>Si el correo no tenía una cuenta, te enviamos un enlace para confirmarla. Ábrelo en este mismo navegador para terminar.</p></Notice>
          <ButtonLink variant="secondary" to="/acceso">Ir a iniciar sesión</ButtonLink>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Crea tu cuenta">
      <form className={styles.authForm} onSubmit={(event) => { void submit(event); }} noValidate>
        <h2>Crear cuenta</h2>
        {failure ? <Notice kind="error"><p>{failureMessage(failure)}</p></Notice> : null}
        <TextField label="Nombre (opcional)" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
        <TextField label="Correo electrónico" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} error={errors.email} />
        <TextField label="Contraseña" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} error={errors.password} hint={`Mínimo ${MIN_PASSWORD} caracteres`} />
        <Button type="submit" block loading={busy}>Crear cuenta</Button>
        <div className={styles.authLinks}><Link to="/acceso">Ya tengo una cuenta</Link></div>
      </form>
    </AuthShell>
  );
}

export function RecoverPage() {
  usePageTitle('Recuperar contraseña');
  const { session: client } = useServices();
  const [email, setEmail] = useState(''); const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<AuthFailure | null>(null); const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const found = validEmail(email); setError(found); setFailure(null);
    if (found) return;
    setBusy(true);
    const result = await client.requestPasswordReset(email.trim(), callbackUrl());
    setBusy(false);
    if (result.ok) setSent(true); else setFailure(result.reason);
  };

  return (
    <AuthShell title="Recupera tu acceso">
      <form className={styles.authForm} onSubmit={(event) => { void submit(event); }} noValidate>
        <h2>Recuperar contraseña</h2>
        {sent ? <Notice kind="success"><p>Si existe una cuenta con ese correo, enviamos un enlace para definir una nueva contraseña. Ábrelo en este mismo navegador.</p></Notice> : null}
        {failure ? <Notice kind="error"><p>{failureMessage(failure)}</p></Notice> : null}
        <TextField label="Correo electrónico" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} error={error} />
        <Button type="submit" block loading={busy}>Enviar enlace</Button>
        <div className={styles.authLinks}><Link to="/acceso">Volver a iniciar sesión</Link></div>
      </form>
    </AuthShell>
  );
}

/** Definir nueva contraseña: solo con la sesión que abre el enlace de recuperación. */
export function NewPasswordPage() {
  usePageTitle('Nueva contraseña');
  const { session: client } = useServices(); const session = useSession(); const navigate = useNavigate();
  const [password, setPassword] = useState(''); const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<{ password?: string; repeat?: string }>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const found = { password: validPassword(password), repeat: repeat === password ? undefined : 'Las contraseñas no coinciden.' };
    setErrors(found); setFailure(null);
    if (found.password || found.repeat) return;
    setBusy(true);
    const result = await client.updatePassword(password);
    setBusy(false);
    if (result.ok) { setDone(true); setPassword(''); setRepeat(''); } else setFailure(result.reason);
  };

  if (session.status === 'loading') return <div className={pageClass}><LoadingState phase="normal" /></div>;
  if (session.status === 'anonymous') {
    return (
      <AuthShell title="Define tu nueva contraseña">
        <div className={styles.authForm}>
          <h2>Enlace no válido</h2>
          <Notice kind="warning"><p>{failureMessage('link_expired')}</p></Notice>
          <ButtonLink to="/recuperar">Solicitar un enlace nuevo</ButtonLink>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Define tu nueva contraseña">
      {done ? (
        <div className={styles.authForm}>
          <h2>Contraseña actualizada</h2>
          <Notice kind="success"><p>Tu contraseña se cambió y tu sesión sigue abierta.</p></Notice>
          <Button onClick={() => navigate('/', { replace: true })}>Ir al inicio</Button>
        </div>
      ) : (
        <form className={styles.authForm} onSubmit={(event) => { void submit(event); }} noValidate>
          <h2>Nueva contraseña</h2>
          {failure ? <Notice kind="error"><p>{failureMessage(failure)}</p></Notice> : null}
          <TextField label="Nueva contraseña" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} error={errors.password} hint={`Mínimo ${MIN_PASSWORD} caracteres`} />
          <TextField label="Repite la contraseña" type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} error={errors.repeat} />
          <Button type="submit" block loading={busy}>Guardar contraseña</Button>
        </form>
      )}
    </AuthShell>
  );
}

/** Retorno del enlace del correo (confirmación de cuenta o recuperación): canjea el `code` con el verificador PKCE guardado en este navegador. */
export function AuthCallbackPage() {
  usePageTitle('Verificando enlace');
  const { session: client } = useServices(); const navigate = useNavigate(); const [params] = useSearchParams();
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const started = useRef(false);
  const code = params.get('code'); const linkError = params.get('error') ?? params.get('error_code');

  useEffect(() => {
    if (started.current) return; // el código es de un solo uso
    started.current = true;
    if (linkError || !code) { setFailure('link_expired'); return; }
    void client.exchangeCode(code).then((result) => {
      if (!result.ok) { setFailure(result.reason); return; }
      navigate(result.recovery ? '/nueva-contrasena' : '/', { replace: true });
    });
  }, [client, code, linkError, navigate]);

  if (!failure) return <div className={pageClass}><LoadingState phase="normal" label="Verificando el enlace" /></div>;
  return (
    <AuthShell title="No pudimos usar ese enlace">
      <div className={styles.authForm}>
        <h2>Enlace no válido</h2>
        <Notice kind="warning"><p>{failureMessage(failure)} Si lo abriste en otro navegador o dispositivo, ábrelo en el mismo donde lo pediste.</p></Notice>
        <div className={ui.actions}>
          <ButtonLink to={loginPath()}>Iniciar sesión</ButtonLink>
          <ButtonLink variant="secondary" to="/recuperar">Recuperar contraseña</ButtonLink>
        </div>
      </div>
    </AuthShell>
  );
}
