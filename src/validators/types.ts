export interface ValidateAdapter {
  validate(validator, value): {success: boolean, error: Error}
}
