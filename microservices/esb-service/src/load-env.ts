import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { parseEnv } from 'node:util';

export interface EnvFileResult { loaded: boolean }
type Env = Record<string, string | undefined>;
const BOM = 0xfeff;

/**
 * Carga un `.env` local sin pisar variables ya definidas (igual que `process.loadEnvFile`), pero tolera el BOM UTF-8
 * que dejan Set-Content/Out-File de Windows PowerShell 5.1 al inicio del archivo (rompía el nombre de la primera variable).
 * No imprime ni devuelve valores.
 */
export function loadEnvFileTolerant(path: string, env: Env = process.env): EnvFileResult {
  if (!existsSync(path)) return { loaded: false };
  const raw = readFileSync(path, 'utf8');
  const text = raw.charCodeAt(0) === BOM ? raw.slice(1) : raw;
  for (const [key, value] of Object.entries(parseEnv(text))) if (env[key] === undefined) env[key] = value;
  return { loaded: true };
}
