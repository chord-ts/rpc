import { ValidateAdapter } from "./types";

export const ZodAdapter = {
  validate(validator: unknown, value: unknown) {
    if (!validator) return {success: true, error: null}
    // @ts-ignore
    return validator.safeParse(value)
  },
} satisfies ValidateAdapter
