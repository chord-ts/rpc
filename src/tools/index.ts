// Tools layer: agent tools for in-process reuse (LangChain etc.), no wire. Imports generate
// (mcpTools descriptors) + schemas (flatToolSchema/packToolArgs) + core gasket. Not a core method —
// agentTools(composer) is a standalone function, keeping core free of generation/tools.

import type { AgentTool, AnySchema, Core } from '../types';
import { mcpTools, type GenOptions } from '../generate';
import { defaultSchemas, flatToolSchema, packToolArgs } from '../schemas';

export function agentTools(core: Core<any>, opts: GenOptions = {}): AgentTool[] {
  const schemas = core.schemas ?? defaultSchemas;
  const toJson = opts.jsonSchema ?? schemas.jsonSchema;
  const descriptors = mcpTools(core, opts).tools as Array<Omit<AgentTool, 'schema' | 'invoke' | 'func'>>;
  const endpoints = core.endpoints().filter((e) => e.contract);

  return endpoints.map((e, i) => {
    const c = e.contract!;
    const name = `${e.service}.${e.method}`;
    // Same packing seam as the mcp binding: REST → slices, fn scalar → { value }.
    // Ошибки — нативный throw (CoreError / ошибка обработчика), фреймворк решает сам.
    const invoke = (args: unknown, ctx?: unknown): Promise<unknown> =>
      core.call(name, packToolArgs(c, args, toJson), { ctx });
    return {
      ...descriptors[i],
      schema: flatToolSchema(c, schemas),
      invoke,
      func: async (args: unknown) => JSON.stringify(await invoke(args)),
    };
  });
}