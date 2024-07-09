export interface ValidateAdapter<T, K> {
  validate(validator: T, value: K): K | never
  validateAsync?(validator: T, value: K): Promise<K> | never
}
