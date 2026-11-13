'use strict';
/* global __dirname */
/**
 * Contrato GraphQL del front: el SDL (`schema.graphql`) y las operaciones conocidas (`operations/operations.graphql`).
 * Solo APIs estándar (sin DOM, NestJS ni React Native). El servicio GraphQL ejecuta en producción únicamente estas operaciones (decisión Q6).
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { parse, print, Kind, visit } = require('graphql');

const schemaPath = join(__dirname, 'schema.graphql');
const operationsPath = join(__dirname, 'operations', 'operations.graphql');
const readSchemaSdl = () => readFileSync(schemaPath, 'utf8');

/** Documento normalizado: la operación primero y luego sus fragmentos (los que usa, transitivamente) ordenados por nombre. */
function normalizeDocument(document, operation) {
  const fragments = new Map(document.definitions.filter((definition) => definition.kind === Kind.FRAGMENT_DEFINITION).map((definition) => [definition.name.value, definition]));
  const used = new Set();
  const collect = (node) => visit(node, { FragmentSpread(spread) { const name = spread.name.value; if (!used.has(name) && fragments.has(name)) { used.add(name); collect(fragments.get(name)); } } });
  collect(operation);
  return { kind: Kind.DOCUMENT, definitions: [operation, ...[...used].sort().map((name) => fragments.get(name))] };
}

/** Texto canónico de un documento de una sola operación (o `undefined` si no tiene exactamente una). */
function canonicalText(document) {
  const operations = document.definitions.filter((definition) => definition.kind === Kind.OPERATION_DEFINITION);
  if (operations.length !== 1) return undefined;
  return print(normalizeDocument(document, operations[0]));
}

/** `Map<operationName, canonicalText>` de todas las operaciones publicadas. */
function knownOperations() {
  const document = parse(readFileSync(operationsPath, 'utf8'));
  const result = new Map();
  for (const operation of document.definitions.filter((definition) => definition.kind === Kind.OPERATION_DEFINITION)) {
    if (!operation.name) throw new Error('toda operación publicada debe tener nombre');
    result.set(operation.name.value, print(normalizeDocument(document, operation)));
  }
  return result;
}

module.exports = { schemaPath, operationsPath, readSchemaSdl, knownOperations, canonicalText };
