import { GoTrueClient, type GoTrueClientOptions, type Session } from '@supabase/auth-js';
import { readClaims } from './jwt';

/**
 * Sesión del front sobre Supabase Auth (diseño F12c-0 §3.4 y §8): Authorization Code + PKCE, credenciales directas a Supabase
 * (nunca por GraphQL ni por el Gateway) y almacenamiento INYECTADO (web: localStorage; móvil: almacenamiento seguro).
 * Sin UI ni DOM. Los errores salen como motivos genéricos: nunca el texto del proveedor ni si un correo existe.
 */
export interface SessionStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface SessionConfig {
  /** URL del proyecto de Supabase (sin `/auth/v1`). */
  supabaseUrl: string;
  /** Llave `anon` (pública por diseño). Nunca la de servicio. */
  anonKey: string;
  storage: SessionStorage;
  storageKey?: string;
  /** Solo pruebas o plataformas sin `fetch` global. */
  fetch?: GoTrueClientOptions['fetch'];
  /** Refresco automático en segundo plano (por omisión, sí). */
  autoRefresh?: boolean;
}

export type SessionRole = 'customer' | 'admin';
export interface SessionUser { id: string; email: string | null; name: string | null; role: SessionRole; emailVerified: boolean }
export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous'; /** La sesión terminó sin que el usuario la cerrara (refresco fallido). */ expired: boolean }
  | { status: 'authenticated'; user: SessionUser; expiresAt: number | null };

export type AuthFailure = 'invalid_credentials' | 'email_not_confirmed' | 'weak_password' | 'same_password' | 'rate_limited' | 'link_expired' | 'signup_failed' | 'network' | 'unknown';
export type AuthResult<T = unknown> = ({ ok: true } & T) | { ok: false; reason: AuthFailure };

export interface SessionClient {
  /** Carga la sesión guardada y empieza a escuchar cambios. Idempotente. */
  start(): Promise<SessionState>;
  stop(): Promise<void>;
  getState(): SessionState;
  subscribe(listener: (state: SessionState) => void): () => void;
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(input: { email: string; password: string; name?: string; redirectTo: string }): Promise<AuthResult<{ needsEmailConfirmation: boolean }>>;
  signOut(): Promise<void>;
  /** Siempre responde igual exista o no la cuenta. */
  requestPasswordReset(email: string, redirectTo: string): Promise<AuthResult>;
  updatePassword(password: string): Promise<AuthResult>;
  /** Retorno del enlace del correo (confirmación o recuperación): canjea el `code` con el verificador PKCE guardado. */
  exchangeCode(code: string): Promise<AuthResult<{ recovery: boolean }>>;
  /** Token de acceso vigente (refrescado si hace falta) o `null` si no hay sesión. */
  getAccessToken(): Promise<string | null>;
}

interface ProviderError { code?: unknown; status?: unknown; name?: unknown }

const FAILURES: Readonly<Record<string, AuthFailure>> = {
  invalid_credentials: 'invalid_credentials', email_not_confirmed: 'email_not_confirmed', weak_password: 'weak_password', same_password: 'same_password',
  over_request_rate_limit: 'rate_limited', over_email_send_rate_limit: 'rate_limited',
  otp_expired: 'link_expired', flow_state_expired: 'link_expired', flow_state_not_found: 'link_expired', bad_code_verifier: 'link_expired',
  user_already_exists: 'signup_failed', email_exists: 'signup_failed', signup_disabled: 'signup_failed', email_address_invalid: 'signup_failed'
};

function failure(error: unknown): AuthFailure {
  const { code, status, name } = (error ?? {}) as ProviderError;
  if (typeof code === 'string' && FAILURES[code]) return FAILURES[code];
  if (name === 'AuthRetryableFetchError' || status === 0) return 'network';
  if (name === 'AuthPKCEGrantCodeExchangeError' || name === 'AuthPKCECodeVerifierMissingError') return 'link_expired';
  if (name === 'AuthWeakPasswordError') return 'weak_password';
  if (status === 429) return 'rate_limited';
  return 'unknown';
}

function toUser(session: Session): SessionUser {
  const claims = readClaims(session.access_token);
  const metadata = (session.user?.user_metadata ?? {}) as Record<string, unknown>;
  const name = typeof metadata.full_name === 'string' && metadata.full_name.trim() ? metadata.full_name.trim() : null;
  return {
    id: session.user?.id ?? (typeof claims.sub === 'string' ? claims.sub : ''),
    email: session.user?.email ?? null,
    name,
    // El rol viene SOLO del claim firmado `app_role` (lo pone el hook de Supabase desde app_metadata); user_metadata lo edita el usuario y no cuenta.
    role: claims.app_role === 'admin' ? 'admin' : 'customer',
    emailVerified: claims.email_verified === true || Boolean(session.user?.email_confirmed_at)
  };
}

export function createSessionClient(config: SessionConfig): SessionClient {
  const base = config.supabaseUrl.replace(/\/+$/, '');
  const storageKey = config.storageKey ?? 'fp.session';
  const auth = new GoTrueClient({
    url: `${base}/auth/v1`,
    headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` },
    storageKey,
    storage: config.storage,
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: config.autoRefresh ?? true,
    detectSessionInUrl: false, // el retorno del enlace lo canjea la app de forma explícita con `exchangeCode`
    ...(config.fetch ? { fetch: config.fetch } : {})
  });

  let state: SessionState = { status: 'loading' };
  const listeners = new Set<(state: SessionState) => void>();
  let started: Promise<SessionState> | undefined;
  let unsubscribe: (() => void) | undefined;
  let signingOut = false;

  const publish = (next: SessionState): void => { state = next; for (const listener of listeners) listener(next); };
  const apply = (session: Session | null, expired = false): void => {
    if (session) publish({ status: 'authenticated', user: toUser(session), expiresAt: session.expires_at ?? null });
    else publish({ status: 'anonymous', expired });
  };

  const client: SessionClient = {
    start() {
      started ??= (async () => {
        const { data } = auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_OUT') { apply(null, state.status === 'authenticated' && !signingOut); return; }
          if (event === 'INITIAL_SESSION' && !session) return; // lo resuelve `getSession` abajo
          apply(session);
        });
        unsubscribe = () => data.subscription.unsubscribe();
        const { data: current } = await auth.getSession();
        apply(current.session);
        return state;
      })();
      return started;
    },
    async stop() { unsubscribe?.(); unsubscribe = undefined; started = undefined; await auth.stopAutoRefresh(); },
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },

    async signIn(email, password) {
      const { data, error } = await auth.signInWithPassword({ email, password });
      if (error || !data.session) return { ok: false, reason: failure(error) };
      apply(data.session);
      return { ok: true };
    },
    async signUp({ email, password, name, redirectTo }) {
      const { data, error } = await auth.signUp({ email, password, options: { emailRedirectTo: redirectTo, ...(name ? { data: { full_name: name } } : {}) } });
      if (error) return { ok: false, reason: failure(error) };
      if (data.session) apply(data.session);
      return { ok: true, needsEmailConfirmation: !data.session };
    },
    async signOut() {
      signingOut = true;
      try {
        const { error } = await auth.signOut({ scope: 'local' });
        // Si el aviso al servidor falla (sin red, error del proveedor) la sesión local se borra igual: cerrar sesión nunca deja el token en el dispositivo.
        if (error) { await config.storage.removeItem(storageKey); await config.storage.removeItem(`${storageKey}-code-verifier`); }
      } finally { signingOut = false; }
      apply(null);
    },
    async requestPasswordReset(email, redirectTo) {
      const { error } = await auth.resetPasswordForEmail(email, { redirectTo });
      if (!error) return { ok: true };
      const reason = failure(error);
      // Para no revelar si la cuenta existe, solo se informan los fallos que no dependen de ella.
      return reason === 'rate_limited' || reason === 'network' ? { ok: false, reason } : { ok: true };
    },
    async updatePassword(password) {
      const { error } = await auth.updateUser({ password });
      return error ? { ok: false, reason: failure(error) } : { ok: true };
    },
    async exchangeCode(code) {
      const { data, error } = await auth.exchangeCodeForSession(code);
      if (error || !data.session) return { ok: false, reason: error ? failure(error) : 'link_expired' };
      apply(data.session);
      return { ok: true, recovery: (data as { redirectType?: string | null }).redirectType === 'recovery' };
    },
    async getAccessToken() {
      const { data } = await auth.getSession();
      if (!data.session) { if (state.status === 'authenticated') apply(null, true); return null; }
      return data.session.access_token;
    }
  };
  return client;
}

/** Almacenamiento en memoria (pruebas y entornos sin almacenamiento persistente). */
export function createMemoryStorage(initial: Record<string, string> = {}): SessionStorage & { snapshot(): Record<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    snapshot: () => Object.fromEntries(values)
  };
}
