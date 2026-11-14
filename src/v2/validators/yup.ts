import type * as Yup from 'yup';
import type { AnySchema } from '../index';

/**
 * yup shim: wraps a yup schema into the vendor `AnySchema` (~standard) contract.
 * yup has no native `~standard`, so validation uses `validateSync` (throws on error).
 */
export function yup<S extends Yup.AnySchema>(schema: S): AnySchema<Yup.InferType<S>> {
  return {
    '~standard': {
      version: 1,
      vendor: 'yup',
      validate: (value: unknown) => {
        try {
          return { value: schema.validateSync(value) };
        } catch (cause) {
          const inner = (cause as { inner?: unknown[] }).inner;
          const list = Array.isArray(inner) && inner.length ? inner : [cause];
          return { issues: list.map((e) => ({ message: (e as { message?: unknown }).message ?? String(e) })) };
        }
      },
    },
  };
}