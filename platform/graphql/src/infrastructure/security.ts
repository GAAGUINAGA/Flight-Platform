import { getNamedType, GraphQLError, isCompositeType, isListType, isNonNullType, Kind, type FragmentDefinitionNode, type GraphQLNamedType, type GraphQLSchema, type GraphQLType, type SelectionSetNode, type ValidationContext, type ValidationRule } from 'graphql';

/** Límites de profundidad, complejidad y alias (diseño §7). Reglas de validación estándar de graphql-js, sin dependencias nuevas. */
const fragmentsOf = (context: ValidationContext): Map<string, FragmentDefinitionNode> => new Map(context.getDocument().definitions.filter((definition): definition is FragmentDefinitionNode => definition.kind === Kind.FRAGMENT_DEFINITION).map((definition) => [definition.name.value, definition]));

function depthOf(selectionSet: SelectionSetNode, fragments: Map<string, FragmentDefinitionNode>, seen: Set<string>): number {
  let deepest = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      if (selection.name.value.startsWith('__')) continue; // la introspección (solo local/CI) no cuenta para el límite
      deepest = Math.max(deepest, 1 + (selection.selectionSet ? depthOf(selection.selectionSet, fragments, seen) : 0));
    } else if (selection.kind === Kind.INLINE_FRAGMENT) deepest = Math.max(deepest, depthOf(selection.selectionSet, fragments, seen));
    else if (!seen.has(selection.name.value)) {
      const fragment = fragments.get(selection.name.value);
      if (fragment) { seen.add(selection.name.value); deepest = Math.max(deepest, depthOf(fragment.selectionSet, fragments, seen)); seen.delete(selection.name.value); }
    }
  }
  return deepest;
}
export const maxDepthRule = (max: number): ValidationRule => (context) => ({
  OperationDefinition(node) {
    const depth = depthOf(node.selectionSet, fragmentsOf(context), new Set());
    if (depth > max) context.reportError(new GraphQLError(`La consulta supera la profundidad máxima (${max}).`));
  }
});

const LIST_MULTIPLIER = 3;
const VARIABLE_PAGE = 10;
function costOf(selectionSet: SelectionSetNode, parent: GraphQLNamedType, schema: GraphQLSchema, fragments: Map<string, FragmentDefinitionNode>, seen: Set<string>): number {
  let total = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      if (selection.name.value.startsWith('__') || !('getFields' in parent)) continue;
      const field = (parent as { getFields(): Record<string, { type: GraphQLType }> }).getFields()[selection.name.value]; if (!field) continue;
      const named = getNamedType(field.type); let type: GraphQLType = field.type; if (isNonNullType(type)) type = type.ofType;
      const first = selection.arguments?.find((argument) => argument.name.value === 'first');
      const page = first ? (first.value.kind === Kind.INT ? Math.min(Number(first.value.value), 200) : VARIABLE_PAGE) : 1;
      const multiplier = Math.max(page, isListType(type) ? LIST_MULTIPLIER : 1);
      total += 1 + (selection.selectionSet && isCompositeType(named) ? costOf(selection.selectionSet, named, schema, fragments, seen) * multiplier : 0);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const target = selection.typeCondition ? schema.getType(selection.typeCondition.name.value) ?? parent : parent; total += costOf(selection.selectionSet, target, schema, fragments, seen);
    } else if (!seen.has(selection.name.value)) {
      const fragment = fragments.get(selection.name.value);
      if (fragment) { seen.add(selection.name.value); total += costOf(fragment.selectionSet, schema.getType(fragment.typeCondition.name.value) ?? parent, schema, fragments, seen); seen.delete(selection.name.value); }
    }
  }
  return total;
}
/** Costo por campo; las listas multiplican por 3 y las conexiones por `first` (literal; con variable se asume 10). */
export const maxComplexityRule = (max: number): ValidationRule => (context) => ({
  OperationDefinition(node) {
    const root = node.operation === 'mutation' ? context.getSchema().getMutationType() : context.getSchema().getQueryType(); if (!root) return;
    const cost = costOf(node.selectionSet, root, context.getSchema(), fragmentsOf(context), new Set());
    if (cost > max) context.reportError(new GraphQLError('La consulta es demasiado compleja.'));
  }
});

export const maxAliasesRule = (max: number): ValidationRule => (context) => {
  let aliases = 0;
  return { Field(node) { if (node.alias) { aliases += 1; if (aliases === max + 1) context.reportError(new GraphQLError(`La consulta usa demasiados alias (máximo ${max}).`)); } } };
};

/** Costo calculado de una operación (para las pruebas de que toda operación conocida cabe en el límite). */
export function operationCost(schema: GraphQLSchema, document: import('graphql').DocumentNode): number {
  const fragments = new Map(document.definitions.filter((definition): definition is FragmentDefinitionNode => definition.kind === Kind.FRAGMENT_DEFINITION).map((definition) => [definition.name.value, definition]));
  const operation = document.definitions.find((definition) => definition.kind === Kind.OPERATION_DEFINITION); if (!operation || operation.kind !== Kind.OPERATION_DEFINITION) return 0;
  const root = operation.operation === 'mutation' ? schema.getMutationType() : schema.getQueryType(); return root ? costOf(operation.selectionSet, root, schema, fragments, new Set()) : 0;
}
export function operationDepth(document: import('graphql').DocumentNode): number {
  const fragments = new Map(document.definitions.filter((definition): definition is FragmentDefinitionNode => definition.kind === Kind.FRAGMENT_DEFINITION).map((definition) => [definition.name.value, definition]));
  const operation = document.definitions.find((definition) => definition.kind === Kind.OPERATION_DEFINITION); return operation && operation.kind === Kind.OPERATION_DEFINITION ? depthOf(operation.selectionSet, fragments, new Set()) : 0;
}
