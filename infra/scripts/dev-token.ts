import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import process from 'node:process';

export interface DevTokenClaims {
  sub: string;
  app_role: string;
  scope: string;
  iat: number;
  exp: number;
}

const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export function createDevToken(privateKeyPem: string, claims: Omit<DevTokenClaims, 'iat' | 'exp'>, now = Math.floor(Date.now() / 1000)): string {
  if (process.env.NODE_ENV === 'production') throw new Error('Development tokens are disabled in production');
  if (!claims.sub || !claims.app_role || !claims.scope) throw new Error('sub, app_role and scope are required');
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'rsa') throw new Error('An RSA private key is required');
  const payload: DevTokenClaims = { ...claims, iat: now, exp: now + 3600 };
  const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}

export function verifyDevToken(publicKeyPem: string, token: string): DevTokenClaims | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const [header, payload, signature] = parts;
  try {
    if (JSON.parse(Buffer.from(header, 'base64url').toString()).alg !== 'RS256') return undefined;
    const valid = verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url'));
    if (!valid) return undefined;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as DevTokenClaims;
    return claims.exp > Math.floor(Date.now() / 1000) ? claims : undefined;
  } catch {
    return undefined;
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1]?.endsWith('dev-token.ts')) {
  try {
    const path = argument('private-key');
    if (!path) throw new Error('Usage: dev-token.ts --private-key <local PEM> --sub <id> --app-role <role> --scope <scopes>');
    const token = createDevToken(readFileSync(path, 'utf8'), {
      sub: argument('sub') ?? '',
      app_role: argument('app-role') ?? '',
      scope: argument('scope') ?? ''
    });
    process.stdout.write(`${token}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Token generation failed'}\n`);
    process.exitCode = 1;
  }
}
