/**
 * Identificadores que viajan en cada petición (diseño F12c-0 §6.5):
 *   - X-Device-Fingerprint: un UUID aleatorio guardado en el dispositivo. NO es una huella del navegador ni contiene datos personales.
 *   - X-Correlation-Id: un UUID por INTENCIÓN de negocio (una búsqueda, una consulta de estado, una compra completa).
 */
export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

const DEVICE_KEY = 'fp.device';
const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Contextos no seguros (http en red local): mismo formato con getRandomValues.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `localStorage` si está disponible (puede fallar en modo privado o por política); si no, memoria. */
export function browserStore(): KeyValueStore {
  try {
    const store = window.localStorage; const probe = 'fp.probe';
    store.setItem(probe, '1'); store.removeItem(probe);
    return store;
  } catch { return memoryStore(); }
}

export function memoryStore(): KeyValueStore {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}

/** Devuelve una función que entrega SIEMPRE el mismo identificador de dispositivo (lo crea la primera vez). */
export function deviceIdProvider(store: KeyValueStore): () => string {
  let cached: string | undefined;
  return () => {
    if (cached) return cached;
    let value: string | null = null;
    try { value = store.getItem(DEVICE_KEY); } catch { value = null; }
    if (!value || !SAFE_ID.test(value)) {
      value = newId();
      try { store.setItem(DEVICE_KEY, value); } catch { /* sin almacenamiento: vale para esta visita */ }
    }
    cached = value;
    return value;
  };
}

/** Un identificador de correlación nuevo para una intención del usuario. */
export const newCorrelationId = (): string => newId();
