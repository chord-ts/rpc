import { ValidateAdapter } from "./types";
import type {ZodType} from 'zod'

export const ZodAdapter: ValidateAdapter<ZodType, any> = {
  validate(validator: ZodType, value: any) {
    if (!validator) return value
    return validator.safeParse(value)
  },
}
