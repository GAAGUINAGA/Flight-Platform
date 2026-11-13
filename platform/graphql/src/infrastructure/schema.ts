import { buildSchema, GraphQLError, GraphQLScalarType, Kind, type GraphQLFieldResolver, type GraphQLObjectType, type GraphQLSchema } from 'graphql';
import { readSchemaSdl } from '@flight-platform/graphql-schema';
import { mutationResolvers, queryResolvers, typeResolvers } from '../application/resolvers';
import type { RequestContext } from '../application/ports';
import { forbidden, unauthenticated } from '../domain/errors';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Los escalares del SDL no traen comportamiento: validan la forma de entrada y dejan pasar lo que el Gateway ya validó. */
function configureScalar(schema: GraphQLSchema, name: string, accepts: (value: string) => boolean, serialize: (value: unknown) => unknown): void {
  const scalar = schema.getType(name) as GraphQLScalarType;
  scalar.serialize = serialize;
  scalar.parseValue = (value: unknown) => { if (typeof value !== 'string' || !accepts(value)) throw new GraphQLError(`${name} no válido`); return value; };
  scalar.parseLiteral = (ast) => { if (ast.kind !== Kind.STRING || !accepts(ast.value)) throw new GraphQLError(`${name} no válido`); return ast.value; };
}
const asText = (value: unknown): unknown => (typeof value === 'string' || typeof value === 'number' ? String(value) : value);

type Guard = 'authenticated' | 'admin';
const guards = (directives: ReadonlyArray<{ name: { value: string } }> | undefined): Guard[] => (directives ?? []).map((directive) => directive.name.value).filter((name): name is Guard => name === 'authenticated' || name === 'admin');

/** `@authenticated`: exige JWT válido; `@admin`: además `app_role = admin`. Ambos se resuelven ANTES de llamar al Gateway. */
function guard(resolver: GraphQLFieldResolver<unknown, RequestContext>, required: Guard[]): GraphQLFieldResolver<unknown, RequestContext> {
  return (source, args, ctx, info) => {
    if (required.length > 0 && !ctx.viewer) throw unauthenticated();
    if (required.includes('admin') && ctx.viewer?.role !== 'ADMIN') throw forbidden();
    return resolver(source, args, ctx, info);
  };
}

/** Construye el esquema ejecutable: SDL (única fuente) + resolutores + escalares + directivas. Falla si a una operación del SDL le falta su resolutor. */
export function buildServiceSchema(sdl: string = readSchemaSdl()): GraphQLSchema {
  const schema = buildSchema(sdl);
  configureScalar(schema, 'Date', (value) => DATE.test(value), asText);
  configureScalar(schema, 'DateTime', (value) => DATE_TIME.test(value) && !Number.isNaN(Date.parse(value)), asText);
  configureScalar(schema, 'Decimal', (value) => DECIMAL.test(value), asText);
  for (const [typeName, resolvers] of [['Query', queryResolvers], ['Mutation', mutationResolvers]] as const) {
    const type = schema.getType(typeName) as GraphQLObjectType;
    for (const [fieldName, field] of Object.entries(type.getFields())) {
      const resolver = (resolvers as Record<string, GraphQLFieldResolver<unknown, RequestContext>>)[fieldName];
      if (!resolver) throw new Error(`falta el resolutor de ${typeName}.${fieldName}`);
      field.resolve = guard(resolver, guards(field.astNode?.directives));
    }
  }
  for (const [typeName, fields] of Object.entries(typeResolvers)) {
    const type = schema.getType(typeName) as GraphQLObjectType;
    for (const [fieldName, resolver] of Object.entries(fields)) type.getFields()[fieldName].resolve = (parent) => resolver(parent as Record<string, unknown>);
  }
  return schema;
}
