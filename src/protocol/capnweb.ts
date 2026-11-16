// Cap'n Web binding (server): JSON batch-of-paths wire, promise pipelining, capability passing.
// Reference: cloudflare/capnweb. The client (connect/RpcPromise) lives in the client layer.
// capability(Ctor) marks a return-by-reference object: hidden under Symbol.for, on the wire {$cap:id}.
// NOTE: capability registry never releases yet (leak); cap calls bypass fn validation — see PROGRESS.

import type { AnySchema, Core, Result } from '../types';

const CAP = Symbol.for('chord.capability');

/** Schema marker: "returns a remote object". The instance is hidden under CAP; the server
 * registers it and emits { $cap: id }. Type claims InstanceType<C>; the wrapper is server-local. */
export function capability<C extends new (...args: any[]) => any>(ctor: C): AnySchema<InstanceType<C>> {
  return {
    '~standard': {
      version: 1,
      vendor: 'chord',
      validate(value) {
        if (value && typeof value === 'object') {
          return { value: { [CAP]: value } as unknown as InstanceType<C> };
        }
        return { issues: [{ message: 'expected a capability object' }] };
      },
    },
  };
}

// --- wire: batch of paths (JSON, like capnweb) ---
export type Step = { get: string } | { call: string; args: unknown[] };
export interface Path {
  from: number | null;
  steps: Step[];
}
export type Batch = Path[];

export interface ServerSession {
  resolve(batch: Batch, ctx?: unknown): Promise<unknown[]>;
  lastBatch: Batch | undefined;
}

export function capnweb(core: Core<any>): ServerSession {
  const caps: object[] = [];
  const results: unknown[] = []; // live across batches: `from` references a global index
  const session: ServerSession = {
    lastBatch: undefined,
    async resolve(batch, ctx) {
      session.lastBatch = batch;
      const deref = (i: number): unknown => {
        const r = results[i];
        return r && typeof r === 'object' && '$cap' in r ? caps[(r as { $cap: number }).$cap] : r;
      };
      for (const path of batch) {
        let value: unknown;
        let steps = path.steps;
        if (path.from == null) {
          // Root: leading gets + first call = 'Service.method' → core.call (with validation).
          const names: string[] = [];
          let i = 0;
          while (i < steps.length && 'get' in steps[i]) {
            names.push((steps[i] as { get: string }).get);
            i++;
          }
          const first = steps[i] as { call: string; args: unknown[] } | undefined;
          if (!first) {
            results.push(undefined); // intermediate node (namespace/method without call) — placeholder
            continue;
          }
          const r: Result = await core.call([...names, first.call].join('.'), first.args[0], { ctx });
          if (!r.ok) throw new Error(r.error.message);
          value = r.value;
          steps = steps.slice(i + 1);
        } else {
          value = deref(path.from);
        }
        for (const step of steps) {
          // Intermediate capability unwrapped to its instance (step goes through its methods).
          if (value && typeof value === 'object' && CAP in value) {
            value = (value as Record<symbol, unknown>)[CAP];
          }
          if ('get' in step) {
            value = (value as Record<string, unknown>)[step.get];
          } else {
            value = await (value as Record<string, (...a: unknown[]) => unknown>)[step.call](...step.args);
          }
        }
        if (value && typeof value === 'object' && CAP in value) {
          const id = caps.length;
          caps.push((value as Record<symbol, unknown>)[CAP] as object);
          results.push({ $cap: id });
        } else {
          results.push(value);
        }
      }
      return results.slice(results.length - batch.length);
    },
  };
  return session;
}