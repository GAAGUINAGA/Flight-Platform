/* global __dirname */
import process from 'node:process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function openApiSpecPath(): string {
  if (process.env.OPENAPI_SPEC_PATH) return resolve(process.env.OPENAPI_SPEC_PATH);
  let directory = __dirname;
  for (;;) {
    const candidate = join(directory, 'contracts', 'openapi', 'vuelos-openapi.yaml');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) throw new Error('OpenAPI specification not found');
    directory = parent;
  }
}
