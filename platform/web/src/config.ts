/** Configuración pública de la app (variables VITE_*: se incrustan en el bundle, ninguna es secreta). Los umbrales viven aquí, no en las pantallas. */
export type EnvName = 'produccion' | 'pruebas' | 'local';

export interface AppConfig {
  graphqlUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  envName: EnvName;
  /** Habilita los escenarios de rechazo y pendiente del pago simulado (solo entornos de prueba; por omisión, apagado). */
  testPaymentScenarios: boolean;
  /** Ventana de check-in que se MUESTRA como ayuda (la autoridad es el servidor; mismos valores por defecto que Operations: 48 h y 60 min). */
  checkIn: { openHours: number; closeMinutes: number };
  /** Estado de carga amable (diseño §9.1): mensajes a partir de `slowMs` y `verySlowMs`; a los `timeoutMs` la operación falla como indisponible. */
  loading: { slowMs: number; verySlowMs: number; timeoutMs: number };
  /** Reintentos automáticos SOLO de lecturas ante indisponibilidad (las mutaciones nunca se reintentan solas). */
  retry: { max: number; baseDelayMs: number };
}

type Env = Record<string, string | boolean | undefined>;

const text = (env: Env, name: string): string => { const value = env[name]; return typeof value === 'string' ? value.trim() : ''; };
const positive = (env: Env, name: string, fallback: number): number => { const value = Number(text(env, name)); return Number.isFinite(value) && value > 0 ? value : fallback; };

export function readConfig(env: Env = import.meta.env): AppConfig {
  const envName = text(env, 'VITE_ENV_NAME');
  return {
    graphqlUrl: text(env, 'VITE_GRAPHQL_URL'),
    supabaseUrl: text(env, 'VITE_SUPABASE_URL'),
    supabaseAnonKey: text(env, 'VITE_SUPABASE_ANON_KEY'),
    envName: envName === 'produccion' || envName === 'local' ? envName : 'pruebas',
    testPaymentScenarios: text(env, 'VITE_TEST_PAYMENT_SCENARIOS') === 'true' && envName !== 'produccion',
    loading: { slowMs: positive(env, 'VITE_LOADING_SLOW_MS', 1500), verySlowMs: positive(env, 'VITE_LOADING_VERY_SLOW_MS', 8000), timeoutMs: positive(env, 'VITE_REQUEST_TIMEOUT_MS', 25_000) },
    checkIn: { openHours: positive(env, 'VITE_CHECKIN_OPEN_HOURS', 48), closeMinutes: positive(env, 'VITE_CHECKIN_CLOSE_MINUTES', 60) },
    retry: { max: 3, baseDelayMs: 500 }
  };
}

/** Variables obligatorias que faltan (la app muestra un aviso de configuración en lugar de fallar en silencio). */
export function missingConfig(config: AppConfig): string[] {
  return ([['VITE_GRAPHQL_URL', config.graphqlUrl], ['VITE_SUPABASE_URL', config.supabaseUrl], ['VITE_SUPABASE_ANON_KEY', config.supabaseAnonKey]] as const).filter(([, value]) => !value).map(([name]) => name);
}
