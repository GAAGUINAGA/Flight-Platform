/* global __dirname, require */
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { openApiSpecPath } from './openapi-path';

describe('OpenAPI specification path', () => {
  it('resolves the same specification from another working directory', () => {
    const modulePath = resolve(__dirname, 'openapi-path.ts');
    const tsx = require.resolve('tsx/cjs');
    const output = execFileSync(process.execPath, ['--require', tsx, '-e', 'process.stdout.write(require(process.argv[1]).openApiSpecPath())', modulePath], {
      cwd: tmpdir(), env: { ...process.env, OPENAPI_SPEC_PATH: '' }, encoding: 'utf8'
    });
    expect(output).toBe(openApiSpecPath());
    expect(output).toMatch(/contracts[\\/]openapi[\\/]vuelos-openapi\.yaml$/);
  });
});
