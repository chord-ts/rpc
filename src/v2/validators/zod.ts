import type { z } from 'zod';
import type { AnySchema } from '../index';

/**
 * zod 3 adapter: wraps a zod schema into the vendor `AnySchema` (~standard) contract.
 * zod 4 implements `~standard` natively and is accepted by `fn` directly.
 */
export function zod<T extends z.ZodType<any>>(schema: T): AnySchema<z.infer<T>> {
  return {
    '~standard': {
      version: 1,
      vendor: 'zod',
      validate: (value: unknown) => {
        const result = schema.safeParse(value);
        return result.success ? { value: result.data } : { issues: result.error.issues };
      },
    },
  };
}