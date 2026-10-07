import { generateKeyPairSync } from 'node:crypto';
import process from 'node:process';
import { createDevToken, verifyDevToken } from './dev-token';

describe('development token', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });

  it('signs configurable claims with RS256 and verifies with the local public key', () => {
    const token = createDevToken(privateKey, { sub: 'local-user', app_role: 'admin', scope: 'flights:read' });
    expect(verifyDevToken(publicKey, token)).toMatchObject({ sub: 'local-user', app_role: 'admin', scope: 'flights:read' });
    expect(verifyDevToken(publicKey, `${token}tampered`)).toBeUndefined();
  });

  it('refuses to sign in production', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => createDevToken(privateKey, { sub: 'user', app_role: 'admin', scope: 'flights:read' })).toThrow();
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
