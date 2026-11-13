import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTVerifyGetKey, type KeyLike } from 'jose';
import type { JwtIssuer } from '../config';
import type { Role, TokenVerifier, Viewer } from '../application/ports';

/**
 * Valida el JWT contra los mismos emisores del Gateway (RS256/ES256 solamente: sin `none` ni HS*), con `iss`, `aud` y `exp`.
 * El servicio no confía en nada que llegue sin firma; el Gateway vuelve a validar el token que se le reenvía.
 */
export class JoseTokenVerifier implements TokenVerifier {
  private readonly keys = new Map<JwtIssuer, JWTVerifyGetKey | KeyLike>();
  constructor(private readonly issuers: JwtIssuer[]) {}
  private async keyFor(issuer: JwtIssuer): Promise<JWTVerifyGetKey | KeyLike> {
    let key = this.keys.get(issuer);
    if (!key) { key = issuer.jwksUri ? createRemoteJWKSet(new URL(issuer.jwksUri)) : await importSPKI(readFileSync(issuer.publicKeyFile!, 'utf8'), 'RS256'); this.keys.set(issuer, key); }
    return key;
  }
  async verify(token: string): Promise<Viewer | undefined> {
    for (const issuer of this.issuers) {
      try {
        const key = await this.keyFor(issuer); const options = { issuer: issuer.iss, audience: issuer.aud, algorithms: ['RS256', 'ES256'], clockTolerance: 30 };
        const { payload } = typeof key === 'function' ? await jwtVerify(token, key, options) : await jwtVerify(token, key, options);
        if (typeof payload.sub !== 'string' || payload.sub.length === 0) continue;
        const role: Role = payload.app_role === 'admin' ? 'ADMIN' : 'CUSTOMER'; // un socio no es un caso de la web: se trata como cliente sin privilegios adicionales
        return { userId: payload.sub, role };
      } catch { /* probar el siguiente emisor */ }
    }
    return undefined;
  }
}
