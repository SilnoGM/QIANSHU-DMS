export type ApiFieldErrors = Record<string, string[]>

export class ApiError {
  code!: string
  message!: string
  fieldErrors?: ApiFieldErrors
  requestId!: string
}
