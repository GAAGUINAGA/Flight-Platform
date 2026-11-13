import type { DocumentNode } from 'graphql';
export const schemaPath: string;
export const operationsPath: string;
export function readSchemaSdl(): string;
/** `Map<operationName, texto canónico>` de las operaciones publicadas. */
export function knownOperations(): Map<string, string>;
/** Texto canónico de un documento de una sola operación; `undefined` si no tiene exactamente una. */
export function canonicalText(document: DocumentNode): string | undefined;
