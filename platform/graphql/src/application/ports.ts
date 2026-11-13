export type Role = 'CUSTOMER' | 'ADMIN' | 'PARTNER';
export interface Viewer { userId: string; role: Role }

/** Petición al Gateway (la hace el adaptador HTTP; los resolvers no conocen `fetch`). */
export interface GatewayRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Ruta bajo la URL base del Gateway, p. ej. `/api/v2/vuelos/bookings`. */
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers: Record<string, string | undefined>;
}
export interface GatewayResponse { status: number; body: unknown; retryAfter: string | null; invalidBody: boolean }
export interface GatewayPort { send(request: GatewayRequest): Promise<GatewayResponse> }

/** Verificación del JWT (firma, iss, aud, exp). `undefined` si no es válido. */
export interface TokenVerifier { verify(token: string): Promise<Viewer | undefined> }

/** Contexto de cada petición GraphQL. */
export interface RequestContext {
  gateway: GatewayPort;
  /** Token verificado (solo se reenvía un token válido). */
  token?: string;
  viewer?: Viewer;
  /** Había cabecera Authorization pero no era válida. */
  invalidToken: boolean;
  correlationId: string;
  requestId: string;
  fingerprint?: string;
  /** Lo llena el resolver de cada operación (registro sin datos sensibles). */
  gatewayCalls: number;
}
