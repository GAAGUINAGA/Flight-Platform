import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

export const DEV_ISSUER = 'flight-platform-dev';
export const DEV_AUDIENCE = 'flight-platform';
export const DEV_KID = 'dev-1';
const DEFAULT_KEY_DIR = 'infra/dev-keys';
const PRIVATE_NAME = 'dev-private.pem';
const PUBLIC_NAME = 'dev-public.pem';

export interface DevTokenClaims {
  sub: string;
  app_role: string;
  scope: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface DevTokenOptions {
  iss?: string;
  aud?: string;
  kid?: string;
}

const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export function createDevToken(
  privateKeyPem: string,
  claims: Pick<DevTokenClaims, 'sub' | 'app_role' | 'scope'>,
  now = Math.floor(Date.now() / 1000),
  options: DevTokenOptions = {}
): string {
  if (process.env.NODE_ENV === 'production') throw new Error('Development tokens are disabled in production');
  if (!claims.sub || !claims.app_role || !claims.scope) throw new Error('sub, app_role and scope are required');
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'rsa') throw new Error('An RSA private key is required');
  const payload: DevTokenClaims = {
    ...claims,
    iss: options.iss ?? DEV_ISSUER,
    aud: options.aud ?? DEV_AUDIENCE,
    iat: now,
    exp: now + 3600
  };
  const input = `${encode({ alg: 'RS256', typ: 'JWT', kid: options.kid ?? DEV_KID })}.${encode(payload)}`;
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

/** Genera el par RSA local. Nunca devuelve ni imprime la llave privada. */
export function initDevKeys(dir = DEFAULT_KEY_DIR, force = false): { publicKeyPath: string; privateKeyPath: string } {
  if (process.env.NODE_ENV === 'production') throw new Error('Development keys are disabled in production');
  const privateKeyPath = join(dir, PRIVATE_NAME);
  const publicKeyPath = join(dir, PUBLIC_NAME);
  if (!force && (existsSync(privateKeyPath) || existsSync(publicKeyPath))) {
    throw new Error(`Keys already exist in ${dir}; pass --force to replace them`);
  }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey);
  return { publicKeyPath, privateKeyPath };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1]?.endsWith('dev-token.ts')) {
  try {
    const dir = argument('key-dir') ?? DEFAULT_KEY_DIR;
    if (process.argv.includes('--init-keys')) {
      const { publicKeyPath, privateKeyPath } = initDevKeys(dir, process.argv.includes('--force'));
      process.stdout.write(`Private key written to ${privateKeyPath} (git-ignored, not printed)\nPublic key written to ${publicKeyPath}\n`);
    } else {
      const path = argument('private-key') ?? join(dir, PRIVATE_NAME);
      const token = createDevToken(
        readFileSync(path, 'utf8'),
        { sub: argument('sub') ?? '', app_role: argument('app-role') ?? '', scope: argument('scope') ?? '' },
        undefined,
        { iss: argument('iss'), aud: argument('aud'), kid: argument('kid') }
      );
      process.stdout.write(`${token}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Token generation failed'}\n`);
    process.stderr.write(
      'Usage: dev-token.ts --init-keys [--key-dir <dir>] [--force]\n' +
        '       dev-token.ts --sub <id> --app-role <role> --scope <scopes> [--private-key <PEM>] [--iss <iss>] [--aud <aud>] [--kid <kid>]\n'
    );
    process.exitCode = 1;
  }
}
