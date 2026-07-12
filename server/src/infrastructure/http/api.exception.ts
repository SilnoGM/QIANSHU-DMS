import { HttpException } from '@nestjs/common'

import type { ApiFieldErrors } from './api-error.dto'

export class ApiException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    readonly publicMessage: string,
    readonly fieldErrors?: ApiFieldErrors,
  ) {
    super(publicMessage, status)
  }
}
