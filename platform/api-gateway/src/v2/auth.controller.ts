import { Buffer } from 'node:buffer';
import type { Request, Response } from 'express';
import { DevAuthService, OAuthError } from './dev-auth';
import { v2Controller, v2Route } from './route';

const text = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : undefined;

/** Emisor `dev-auth` (RFC 6749 `client_credentials`) y su JWKS. No pertenece al contrato OpenAPI v2 (solo declara `tokenUrl`). */
export class V2AuthController {
  constructor(private readonly devAuth: DevAuthService) {}

  async token(req: Request, res: Response, body: Record<string, unknown> | undefined): Promise<unknown> {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Pragma', 'no-cache');
    if (!this.devAuth.enabled) { res.status(404); return { error: 'invalid_request', error_description: 'dev-auth no está habilitado' }; }
    try {
      const params = body ?? {};
      if (params.grant_type !== 'client_credentials') throw new OAuthError(400, 'unsupported_grant_type', 'Solo se admite client_credentials');
      let clientId = text(params.client_id); let clientSecret = text(params.client_secret); let viaBasic = false;
      const authorization = req.header('authorization');
      if (authorization?.startsWith('Basic ')) {
        const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8'); const separator = decoded.indexOf(':');
        if (separator < 1) throw new OAuthError(401, 'invalid_client', 'Credenciales Basic mal formadas', true);
        const basicId = decodeURIComponent(decoded.slice(0, separator)); const basicSecret = decodeURIComponent(decoded.slice(separator + 1));
        if (clientId && clientId !== basicId) throw new OAuthError(400, 'invalid_request', 'client_id no coincide con la autenticación Basic');
        clientId = basicId; clientSecret = basicSecret; viaBasic = true;
      }
      return await this.devAuth.issue({ clientId, clientSecret, scope: text(params.scope), viaBasic });
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      if (error.challenge) res.setHeader('WWW-Authenticate', 'Basic realm="oauth2"');
      if (error.httpStatus === 429) res.setHeader('Retry-After', '60');
      res.status(error.httpStatus);
      return { error: error.oauthError, ...(error.description ? { error_description: error.description } : {}) };
    }
  }

  jwks(res: Response): unknown {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return this.devAuth.jwks();
  }
}
v2Controller(V2AuthController, '', [DevAuthService]);
v2Route(V2AuthController.prototype, 'token', 'post', 'oauth2/token', ['req', 'res', 'body'], { public: true, status: 200 });
v2Route(V2AuthController.prototype, 'jwks', 'get', '.well-known/jwks.json', ['res'], { public: true });
