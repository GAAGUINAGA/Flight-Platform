import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevToken } from '../../../infra/scripts/dev-token';
import { verifyBearer } from './auth';
import { loadConfig } from './config';

describe('F11a partner development issuer', () => {
  it('verifies a partner token and rejects its local key in production', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gateway-partner-'));
    try {
      const keys = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
      const publicKeyFile = join(dir, 'public.pem');
      writeFileSync(publicKeyFile, keys.publicKey);
      const issuer = { iss: 'flight-platform-partner-dev', aud: 'flight-platform', publicKeyFile };
      const env = { NODE_ENV: 'test', INTERNAL_API_KEY: 'test-key', JWT_ISSUERS: JSON.stringify([issuer]) };
      const scopes = 'flights:read flights:hold flights:book flights:cancel flights:webhooks';
      const token = createDevToken(keys.privateKey, { sub: 'partner-client', app_role: 'partner', scope: scopes }, undefined, { iss: issuer.iss });
      const auth = await verifyBearer(`Bearer ${token}`, loadConfig(env).jwtIssuers);
      expect(auth.ownerId).toBe('partner-client');
      expect(auth.role).toBe('partner');
      expect(auth.scopes).toEqual(new Set(scopes.split(' ')));
      expect(() => loadConfig({ ...env, NODE_ENV: 'production' })).toThrow('Development JWT issuers');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
