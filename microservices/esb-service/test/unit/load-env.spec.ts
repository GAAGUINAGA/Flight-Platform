import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from '@jest/globals';
import { loadConfig } from '../../src/config';
import { loadEnvFileTolerant } from '../../src/load-env';

type Env = Record<string, string | undefined>;
const dir = mkdtempSync(join(tmpdir(), 'esb-env-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const write = (name: string, content: string) => { const path = join(dir, name); writeFileSync(path, content, 'utf8'); return path; };

describe('ESB-ENV: carga del .env', () => {
  it('ESB-ENV-01: un .env con BOM UTF-8 define la primera variable (INTERNAL_API_KEY)', () => {
    const env: Env = {};
    expect(loadEnvFileTolerant(write('bom.env', '﻿INTERNAL_API_KEY=abc\nPORT=3100\n'), env)).toEqual({ loaded: true });
    expect(env.INTERNAL_API_KEY).toBe('abc'); expect(env.PORT).toBe('3100');
    expect(loadConfig(env).internalApiKey).toBe('abc');
  });

  it('ESB-ENV-02: sin BOM funciona igual y no pisa variables ya definidas', () => {
    const env: Env = { PORT: '9999' };
    loadEnvFileTolerant(write('plain.env', 'INTERNAL_API_KEY=abc\nPORT=3100\n'), env);
    expect(env.INTERNAL_API_KEY).toBe('abc'); expect(env.PORT).toBe('9999');
  });

  it('ESB-ENV-03: sin archivo no carga nada', () => {
    const env: Env = {};
    expect(loadEnvFileTolerant(join(dir, 'no-existe.env'), env)).toEqual({ loaded: false }); expect(env).toEqual({});
  });

  it('ESB-ENV-04: si se cargó el archivo pero falta la variable, el error lo dice (sin revelar valores)', () => {
    const env: Env = {};
    const { loaded } = loadEnvFileTolerant(write('other.env', 'OTRA=secreto-que-no-debe-salir\n'), env);
    expect(() => loadConfig(env, { envFileLoaded: loaded })).toThrow(/INTERNAL_API_KEY is required \(the \.env file was loaded but does not define it/);
    try { loadConfig(env, { envFileLoaded: loaded }); } catch (error) { expect(String(error)).not.toContain('secreto'); }
    expect(() => loadConfig({})).toThrow('INTERNAL_API_KEY is required');
  });
});
