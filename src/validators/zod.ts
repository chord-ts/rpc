import { ValidateAdapter } from "./type";
import type {ZodType} from 'zod'

export const ZodAdapter: ValidateAdapter<ZodType, unknown> = {
  validate(validator: ZodType, value) {
    if (!validator) return value
    return validator.parse(value)
  }
}