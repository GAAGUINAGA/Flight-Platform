import { Buffer } from 'node:buffer';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { createDevToken, initDevKeys, verifyDevToken } from './dev-token';

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

  it('includes kid, iss and aud by default and allows overriding them', () => {
    const token = createDevToken(privateKey, { sub: 'u', app_role: 'customer', scope: 'flights:read' });
    const [header] = token.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toMatchObject({ alg: 'RS256', kid: 'dev-1' });
    expect(verifyDevToken(publicKey, token)).toMatchObject({ iss: 'flight-platform-dev', aud: 'flight-platform' });
    const custom = createDevToken(privateKey, { sub: 'u', app_role: 'customer', scope: 'x' }, undefined, { iss: 'i', aud: 'a', kid: 'k' });
    expect(verifyDevToken(publicKey, custom)).toMatchObject({ iss: 'i', aud: 'a' });
  });

  it('generates a key pair on disk, refuses to overwrite and never returns the private key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-keys-'));
    try {
      const result = initDevKeys(dir);
      expect(Object.values(result).join('')).not.toContain('PRIVATE KEY');
      const token = createDevToken(readFileSync(result.privateKeyPath, 'utf8'), { sub: 'u', app_role: 'admin', scope: 's' });
      expect(verifyDevToken(readFileSync(result.publicKeyPath, 'utf8'), token)).toMatchObject({ sub: 'u' });
      expect(() => initDevKeys(dir)).toThrow(/already exist/);
      expect(() => initDevKeys(dir, true)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to generate keys in production', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => initDevKeys(join(tmpdir(), 'never-created'))).toThrow();
    } finally {
      process.env.NODE_ENV = original;
    }
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
