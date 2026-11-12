/**
 * cora/require-permission — every POST/PUT/PATCH/DELETE handler in a
 * @Controller must carry @RequirePermission(...) or @Public() (method or class
 * level). Reads are left to the runtime scan; writes are a build error
 * (INVARIANTS.md rule 5, P03-A4).
 *
 * No dependency: a plain ESLint rule object registered as an inline plugin in
 * the root flat config. Lives outside `*.config.mjs` so the root ignore
 * pattern does not swallow it.
 */
const WRITE_DECORATORS = new Set(['Post', 'Put', 'Patch', 'Delete']);
const ALLOW = new Set(['RequirePermission', 'Public']);

function decoratorName(d) {
  const e = d.expression;
  if (e.type === 'CallExpression' && e.callee.type === 'Identifier') return e.callee.name;
  return e.type === 'Identifier' ? e.name : null;
}

function hasAllowed(decorators = []) {
  return decorators.some((d) => ALLOW.has(decoratorName(d)));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Yazma uçları (@Post/@Put/@Patch/@Delete) @RequirePermission(...) veya @Public() taşımak zorunda',
    },
    schema: [],
    messages: {
      missing:
        '"{{name}}" bir yazma ucu ama @RequirePermission(...) yok. Yetki kodu ekleyin ya da bilerek açıksa @Public() ile işaretleyin.',
    },
  },
  create(context) {
    return {
      ClassDeclaration(node) {
        const classDecorators = node.decorators ?? [];
        const isController = classDecorators.some((d) => decoratorName(d) === 'Controller');
        if (!isController) return;
        const classAllowed = hasAllowed(classDecorators);

        for (const member of node.body.body) {
          if (member.type !== 'MethodDefinition') continue;
          const decorators = member.decorators ?? [];
          const isWrite = decorators.some((d) => WRITE_DECORATORS.has(decoratorName(d)));
          if (!isWrite) continue;
          if (classAllowed || hasAllowed(decorators)) continue;
          const name =
            member.key.type === 'Identifier' ? member.key.name : context.sourceCode.getText(member.key);
          context.report({ node: member.key, messageId: 'missing', data: { name } });
        }
      },
    };
  },
};
