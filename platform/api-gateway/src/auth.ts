import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createRemoteJWKSet, importSPKI, jwtVerify } from 'jose';
import type { JwtIssuer } from './config';

export interface AuthContext { ownerId: string; role: string; scopes: Set<string>; }
export async function verifyBearer(header: string | undefined, issuers: JwtIssuer[]): Promise<AuthContext> {
  if (!header?.startsWith('Bearer ')) throw new Error('UNAUTHENTICATED');
  const token = header.slice(7);
  for (const issuer of issuers) {
    try {
      const result = issuer.jwksUri
        ? await jwtVerify(token, createRemoteJWKSet(new URL(issuer.jwksUri)), { issuer: issuer.iss, audience: issuer.aud, algorithms: ['RS256', 'ES256'], clockTolerance: 30 })
        : await jwtVerify(token, await importSPKI(readFileSync(issuer.publicKeyFile!, 'utf8'), 'RS256'), { issuer: issuer.iss, audience: issuer.aud, algorithms: ['RS256', 'ES256'], clockTolerance: 30 });
      const { payload } = result;
      if (typeof payload.sub !== 'string') throw new Error('missing sub');
      return { ownerId: payload.sub, role: typeof payload.app_role === 'string' ? payload.app_role : (issuer.role ?? 'customer'), scopes: new Set(typeof payload.scope === 'string' ? payload.scope.split(' ') : []) };
    } catch { /* Try the next configured issuer. */ }
  }
  throw new Error('UNAUTHENTICATED');
}

export const requireRole = (context: AuthContext, role: string): void => { if (context.role !== role) throw new Error('PERMISSION_DENIED'); };
export const requireScope = (context: AuthContext, scope: string): void => { if (!context.scopes.has(scope)) throw new Error('PERMISSION_DENIED'); };
