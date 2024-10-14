import { ValidateAdapter } from "./type";
import type {ZodType} from 'zod'

export const ZodAdapter: ValidateAdapter<ZodType | undefined, unknown> = {
  validate(validator: ZodType | undefined, value: unknown): unknown {
    if (!validator) return value
    return validator.safeParse(value)
  },
}