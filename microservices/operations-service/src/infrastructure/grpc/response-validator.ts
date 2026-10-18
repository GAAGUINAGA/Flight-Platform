import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { parse } from 'yaml';
import { findProtoRoot } from './server';

export function createResponseValidator(): (name: string, value: unknown) => void {
  const document = parse(readFileSync(join(findProtoRoot(), '..', 'openapi', 'vuelos-openapi.yaml'), 'utf8')) as Record<string, unknown>;
  const id = 'urn:flight-platform:operations-openapi';
  const ajv = new Ajv({ strict: false, formats: { 'date-time': /^\d{4}-\d{2}-\d{2}T.+Z$/, date: /^\d{4}-\d{2}-\d{2}$/, uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i } });
  ajv.addSchema({ ...document, $id: id });
  const validators = Object.fromEntries(['CheckInResponse', 'BoardingPassListResponse', 'FlightStatus'].map((name) => [name, ajv.compile({ $ref: `${id}#/components/schemas/${name}` })]));
  return (name, value) => { if (!validators[name] || !validators[name](value)) throw new Error('invalid public response'); };
}
