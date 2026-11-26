import { HttpException } from '@nestjs/common'

import type { ApiErrorIssue, ApiFieldErrors } from './api-error.dto'

export class ApiException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    readonly publicMessage: string,
    readonly fieldErrors?: ApiFieldErrors,
    readonly issues?: ApiErrorIssue[],
  ) {
    super(publicMessage, status)
  }
}
