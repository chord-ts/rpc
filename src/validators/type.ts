export interface ValidateAdapter<T, K> {
  validate(validator: T, value: K): {success: K, error: unknown}
}
