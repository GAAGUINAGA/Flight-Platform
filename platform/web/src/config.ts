/** Configuración pública de la app (variables VITE_*: se incrustan en el bundle, ninguna es secreta). Los umbrales viven aquí, no en las pantallas. */
export type EnvName = 'produccion' | 'pruebas' | 'local';

export interface AppConfig {
  graphqlUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  envName: EnvName;
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
    loading: { slowMs: positive(env, 'VITE_LOADING_SLOW_MS', 1500), verySlowMs: positive(env, 'VITE_LOADING_VERY_SLOW_MS', 8000), timeoutMs: positive(env, 'VITE_REQUEST_TIMEOUT_MS', 25_000) },
    retry: { max: 3, baseDelayMs: 500 }
  };
}

/** Variables obligatorias que faltan (la app muestra un aviso de configuración en lugar de fallar en silencio). */
export function missingConfig(config: AppConfig): string[] {
  return ([['VITE_GRAPHQL_URL', config.graphqlUrl], ['VITE_SUPABASE_URL', config.supabaseUrl], ['VITE_SUPABASE_ANON_KEY', config.supabaseAnonKey]] as const).filter(([, value]) => !value).map(([name]) => name);
}
