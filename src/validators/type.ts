export interface ValidateAdapter<T, K> {
  validate<T, K>(validator: T, value: K): K | never
  validateAsync?<T, K>(validator: T, value: K): Promise<K> | never
}
