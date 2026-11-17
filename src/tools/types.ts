// Tools layer contract: agent tool ready for agent frameworks (LangChain etc.), in-process, no wire.

import type { AnySchema } from '../types';

export interface AgentTool {
  name: string;
  description: string;
  /** Vendor flat schema — e.g. DynamicStructuredTool.schema in LangChain. */
  schema: AnySchema;
  inputSchema: unknown;
  annotations?: Record<string, boolean>;
  /** Returns the value; throws natively on failure (CoreError / handler error). */
  invoke(args: unknown, ctx?: unknown): Promise<unknown>;
  /** Ready framework call: string result (LangChain func). */
  func(args: unknown): Promise<string>;
}