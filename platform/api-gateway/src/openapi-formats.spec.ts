import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { openApiSpecPath } from './openapi-path';

describe('OpenAPI response formats', () => {
  it('GW-OPENAPI: rechaza FlightEndpoint.at con date-time mal formado', () => {
    const document = parse(readFileSync(openApiSpecPath(), 'utf8')) as { components: { schemas: Record<string, object> } };
    const ajv = new Ajv({ strict: false }); addFormats(ajv);
    const validate = ajv.compile({ ...document.components.schemas.FlightEndpoint, components: document.components });
    expect(validate({ iataCode: 'UIO', at: 'not-a-date' })).toBe(false);
    expect(validate({ iataCode: 'UIO', at: '2026-10-24T12:00:00.000Z' })).toBe(true);
  });
});
