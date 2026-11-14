'use strict';
/* global __dirname, process */
/**
 * Codegen propio (ADR-F12c2a-01): del SDL y de las operaciones conocidas genera
 *   generated/types.ts       enumeraciones, entradas, fragmentos y, por operación, sus tipos de datos y de variables;
 *   generated/operations.ts  un documento tipado por operación con su TEXTO CANÓNICO (el mismo que acepta el servicio en producción).
 * Solo usa `graphql` (ya es dependencia del paquete). Uso: `node scripts/codegen.cjs` (escribe) o `--check` (falla si hay cambios pendientes).
 */
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { buildSchema, parse, Kind, isEnumType, isInputObjectType, isNonNullType, isListType, getNamedType, typeFromAST } = require('graphql');
const { readSchemaSdl, knownOperations, operationsPath } = require('../index.cjs');

const outDir = join(__dirname, '..', 'generated');
const SCALARS = { ID: 'string', String: 'string', Int: 'number', Float: 'number', Boolean: 'boolean', Date: 'string', DateTime: 'string', Decimal: 'string' };
const HEADER = '// GENERADO por packages/graphql-schema/scripts/codegen.cjs a partir de schema.graphql y operations/operations.graphql. No editar a mano.\n';

const namedTs = (type) => SCALARS[type.name] ?? type.name;
const wrapNonNull = (type, inner) => (isListType(type) ? `Array<${wrap(type.ofType, inner)}>` : inner);
/** Aplica listas y nulabilidad del tipo GraphQL al tipo TS `inner` del tipo nombrado. */
function wrap(type, inner) { return isNonNullType(type) ? wrapNonNull(type.ofType, inner) : `${wrapNonNull(type, inner)} | null`; }

function selectionType(parent, selectionSet) {
  const fields = []; const spreads = [];
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FRAGMENT_SPREAD) { spreads.push(`${selection.name.value}Fragment`); continue; }
    if (selection.kind !== Kind.FIELD) throw new Error('codegen: los fragmentos en línea no están soportados');
    const name = selection.name.value; const key = selection.alias ? selection.alias.value : name;
    const definition = parent.getFields()[name];
    if (!definition) throw new Error(`codegen: ${parent.name}.${name} no existe en el SDL`);
    const named = getNamedType(definition.type);
    const inner = selection.selectionSet ? selectionType(named, selection.selectionSet) : namedTs(named);
    fields.push(`${key}: ${wrap(definition.type, selection.selectionSet && inner.includes(' & ') ? `(${inner})` : inner)}`);
  }
  return [fields.length > 0 ? `{ ${fields.join('; ')} }` : '', ...spreads].filter(Boolean).join(' & ');
}

function generate() {
  const schema = buildSchema(readSchemaSdl());
  const document = parse(readFileSync(operationsPath, 'utf8'));
  const known = knownOperations();
  const lines = [HEADER];

  lines.push('// ───────── Enumeraciones ─────────');
  for (const type of Object.values(schema.getTypeMap())) {
    if (isEnumType(type) && !type.name.startsWith('__')) lines.push(`export type ${type.name} = ${type.getValues().map((value) => `'${value.name}'`).join(' | ')};`);
  }
  lines.push('', '// ───────── Entradas ─────────');
  for (const type of Object.values(schema.getTypeMap())) {
    if (!isInputObjectType(type)) continue;
    const fields = Object.values(type.getFields()).map((field) => `${field.name}${isNonNullType(field.type) && field.defaultValue === undefined ? '' : '?'}: ${wrap(field.type, namedTs(getNamedType(field.type)))}`);
    lines.push(`export interface ${type.name} { ${fields.join('; ')} }`);
  }
  lines.push('', '// ───────── Fragmentos ─────────');
  for (const definition of document.definitions) {
    if (definition.kind !== Kind.FRAGMENT_DEFINITION) continue;
    lines.push(`export type ${definition.name.value}Fragment = ${selectionType(schema.getType(definition.typeCondition.name.value), definition.selectionSet)};`);
  }
  lines.push('', '// ───────── Operaciones ─────────');
  const operations = [];
  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
    const name = definition.name.value; const kind = definition.operation; const suffix = kind === 'mutation' ? 'Mutation' : 'Query';
    const root = kind === 'mutation' ? schema.getMutationType() : schema.getQueryType();
    const variables = (definition.variableDefinitions ?? []).map((variable) => {
      const type = typeFromAST(schema, variable.type);
      return `${variable.variable.name.value}${isNonNullType(type) && !variable.defaultValue ? '' : '?'}: ${wrap(type, namedTs(getNamedType(type)))}`;
    });
    lines.push(`export type ${name}${suffix}Variables = ${variables.length > 0 ? `{ ${variables.join('; ')} }` : 'Record<string, never>'};`);
    lines.push(`export type ${name}${suffix} = ${selectionType(root, definition.selectionSet)};`);
    operations.push({ name, kind, suffix, text: known.get(name) });
  }

  const ops = [HEADER, "import type * as T from './types';", '',
    '/** Operación publicada: el `text` es el documento canónico de una sola operación con sus fragmentos. `__data` y `__variables` solo llevan los tipos. */',
    "export interface TypedOperation<TData, TVariables> { readonly name: string; readonly kind: 'query' | 'mutation'; readonly text: string; readonly __data?: TData; readonly __variables?: TVariables }", ''];
  for (const operation of operations) {
    ops.push(`export const ${operation.name}Operation: TypedOperation<T.${operation.name}${operation.suffix}, T.${operation.name}${operation.suffix}Variables> = { name: '${operation.name}', kind: '${operation.kind}', text: ${JSON.stringify(operation.text)} };`);
  }
  return { 'types.ts': `${lines.join('\n')}\n`, 'operations.ts': `${ops.join('\n')}\n` };
}

function main() {
  const files = generate(); const check = process.argv.includes('--check'); const pending = [];
  for (const [name, content] of Object.entries(files)) {
    const target = join(outDir, name);
    if (check) { let current = ''; try { current = readFileSync(target, 'utf8'); } catch { /* falta */ } if (current !== content) pending.push(name); }
    else { mkdirSync(outDir, { recursive: true }); writeFileSync(target, content); }
  }
  if (pending.length > 0) { process.stderr.write(`codegen: cambios pendientes en generated/${pending.join(', generated/')} (ejecuta npm run codegen -w @flight-platform/graphql-schema)\n`); process.exit(1); }
  process.stdout.write(check ? 'codegen: sin cambios pendientes\n' : `codegen: ${Object.keys(files).length} archivos escritos en generated/\n`);
}

if (require.main === module) main();
module.exports = { generate, outDir };
