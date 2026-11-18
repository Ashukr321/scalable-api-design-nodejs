import { GraphQLError, Kind } from 'graphql';

// Validation rule: reject queries nested deeper than `max` before they run.
// Stops abusive queries like post { author { posts { edges { node { author { posts ... } } } } } }.
export const depthLimit = (max) => (context) => {
  const fragments = Object.fromEntries(
    context
      .getDocument()
      .definitions.filter((d) => d.kind === Kind.FRAGMENT_DEFINITION)
      .map((d) => [d.name.value, d]),
  );

  const depthOf = (selectionSet, seen) => {
    let deepest = 0;
    for (const sel of selectionSet?.selections ?? []) {
      if (sel.kind === Kind.FIELD) {
        deepest = Math.max(deepest, sel.selectionSet ? 1 + depthOf(sel.selectionSet, seen) : 1);
      } else if (sel.kind === Kind.INLINE_FRAGMENT) {
        deepest = Math.max(deepest, depthOf(sel.selectionSet, seen));
      } else if (sel.kind === Kind.FRAGMENT_SPREAD && !seen.has(sel.name.value)) {
        // `seen` guards fragment cycles (other rules report those; we just must not loop forever)
        deepest = Math.max(deepest, depthOf(fragments[sel.name.value]?.selectionSet, new Set(seen).add(sel.name.value)));
      }
    }
    return deepest;
  };

  return {
    OperationDefinition(node) {
      const depth = depthOf(node.selectionSet, new Set());
      if (depth > max) {
        context.reportError(
          new GraphQLError(`Query depth ${depth} exceeds the maximum of ${max}`, {
            nodes: [node],
            extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
          }),
        );
      }
    },
  };
};
