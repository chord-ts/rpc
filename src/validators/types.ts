export interface ValidateAdapter<T, K> {
  validate(validator?: T, value?: K): {success: boolean, error: Error}
}
