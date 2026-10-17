import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { parse } from 'yaml';
import { DomainError } from '@flight-platform/shared';
import { ResponseValidator } from '../../application/post-sale-baggage';
import { findProtoRoot } from './server';

export function createResponseValidator(): ResponseValidator {
  const document = parse(readFileSync(join(findProtoRoot(), '..', 'openapi', 'vuelos-openapi.yaml'), 'utf8')) as { components: { schemas: Record<string, object> }; $id?: string };
  const ajv = new Ajv({ strict: false, formats: { 'date-time': /^\d{4}-\d{2}-\d{2}T.+Z$/, date: /^\d{4}-\d{2}-\d{2}$/, uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i } });
  const schemaId = 'urn:flight-platform:openapi:v1';
  ajv.addSchema({ ...document, $id: schemaId });
  const validators = Object.fromEntries(['BaggageOptionsResponse', 'BaggageAddedResponse', 'DateChangeSearchResponse', 'CancellationQuoteResponse', 'BookingDetail'].map((name) => [name, ajv.compile({ $ref: `${schemaId}#/components/schemas/${name}` })]));
  return (name, value) => { if (!validators[name](value)) throw new DomainError('VALIDATION_FAILED'); };
}
