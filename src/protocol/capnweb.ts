// Cap'n Web binding (server): JSON batch-of-paths wire, promise pipelining, capability passing.
// Reference: cloudflare/capnweb. The client (connect/RpcPromise) lives in the client layer.
// capability(Ctor) marks a return-by-reference object: hidden under Symbol.for, on the wire {$cap:id}.
// NOTE: capability registry never releases yet (leak); cap calls bypass fn validation — see PROGRESS.

import type { AnySchema, Core, Result } from '../types';

const CAP = Symbol.for('chord.capability');
const CAP_VENDOR = 'chord-capability';

/** Schema marker: "returns a remote object". Type claims InstanceType<C>. The CAP wrapping is done
 * by the capnweb binding (a wire transform, not validation) — independent of the validateOut flag. */
export function capability<C extends new (...args: any[]) => any>(ctor: C): AnySchema<InstanceType<C>> {
  return {
    '~standard': {
      version: 1,
      vendor: CAP_VENDOR,
      validate(value) {
        if (value && typeof value === 'object') {
          return { value: value as InstanceType<C> };
        }
        return { issues: [{ message: 'expected a capability object' }] };
      },
    },
  };
}

const isCapabilitySchema = (s: AnySchema | undefined): boolean =>
  !!s && (s as unknown as { '~standard': { vendor: string } })['~standard'].vendor === CAP_VENDOR;

// --- wire: batch of paths (JSON, like capnweb) ---
export type Step = { get: string } | { call: string; args: unknown[] };
export interface Path {
  from: number | null;
  steps: Step[];
}
export type Batch = Path[];

export interface ServerSession {
  resolve(batch: Batch, ctx?: unknown): Promise<unknown[]>;
  /** Free one capability (its id from {$cap:id}); further calls to it fail. */
  release(capId: number): void;
  /** End the session: free all capabilities + results. Automatic refcounting is a future step. */
  dispose(): void;
  lastBatch: Batch | undefined;
}

export function capnweb(core: Core<any>): ServerSession {
  const caps: (object | undefined)[] = [];
  const results: unknown[] = []; // live across batches: `from` references a global index
  const contracts = new Map(core.endpoints().map((e) => [`${e.service}.${e.method}`, e.contract]));
  let closed = false;
  const session: ServerSession = {
    lastBatch: undefined,
    release(capId) {
      caps[capId] = undefined;
    },
    dispose() {
      caps.length = 0;
      results.length = 0;
      closed = true;
    },
    async resolve(batch, ctx) {
      if (closed) throw new Error('capnweb session disposed');
      session.lastBatch = batch;
      const deref = (i: number): unknown => {
        const r = results[i];
        if (r && typeof r === 'object' && '$cap' in r) {
          const cap = caps[(r as { $cap: number }).$cap];
          if (!cap) throw new Error('capability released');
          return cap;
        }
        return r;
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
          const methodName = [...names, first.call].join('.');
          const r: Result = await core.call(methodName, first.args[0], { ctx });
          if (!r.ok) throw new Error(r.error.message);
          value = r.value;
          // capability — wire-обёртка в биндинге (не зависит от validateOut): инстанс под CAP.
          if (isCapabilitySchema(contracts.get(methodName)?.out as AnySchema | undefined)) {
            value = { [CAP]: value };
          }
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