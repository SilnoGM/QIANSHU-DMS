import { HttpException, HttpStatus } from '@nestjs/common'

import { ApiError, type ApiFieldErrors } from './api-error.dto'
import { ApiException } from './api.exception'

interface ErrorContract {
  code: string
  message: string
}

const contractByStatus = new Map<number, ErrorContract>([
  [
    HttpStatus.BAD_REQUEST,
    { code: 'BAD_REQUEST', message: '请求格式错误' },
  ],
  [
    HttpStatus.UNAUTHORIZED,
    { code: 'UNAUTHORIZED', message: '未登录或登录已失效' },
  ],
  [
    HttpStatus.FORBIDDEN,
    { code: 'FORBIDDEN', message: '没有权限执行此操作' },
  ],
  [
    HttpStatus.NOT_FOUND,
    { code: 'NOT_FOUND', message: '请求的资源不存在' },
  ],
  [
    HttpStatus.CONFLICT,
    { code: 'CONFLICT', message: '请求与当前资源状态冲突' },
  ],
  [
    HttpStatus.UNPROCESSABLE_ENTITY,
    { code: 'VALIDATION_FAILED', message: '请求参数校验失败' },
  ],
  [
    HttpStatus.INTERNAL_SERVER_ERROR,
    { code: 'INTERNAL_ERROR', message: '服务器内部错误' },
  ],
])

const rejectedContract: ErrorContract = {
  code: 'REQUEST_REJECTED',
  message: '请求无法处理',
}
const internalContract: ErrorContract = {
  code: 'INTERNAL_ERROR',
  message: '服务器内部错误',
}
const internalErrorStatus: number = HttpStatus.INTERNAL_SERVER_ERROR

function createBody(
  contract: ErrorContract,
  requestId: string,
  fieldErrors?: ApiFieldErrors,
): ApiError {
  const body = new ApiError()
  body.code = contract.code
  body.message = contract.message

  if (fieldErrors !== undefined) {
    body.fieldErrors = fieldErrors
  }

  body.requestId = requestId
  return body
}

function contractForHttpStatus(status: number): ErrorContract {
  const knownContract = contractByStatus.get(status)

  if (knownContract) {
    return knownContract
  }

  return status >= internalErrorStatus
    ? internalContract
    : rejectedContract
}

export function mapExceptionToApiError(
  exception: unknown,
  requestId: string,
): { status: number; body: ApiError; unexpected: boolean } {
  // ApiException 的文案由服务端显式声明为可公开内容，必须先于普通 HttpException 处理。
  if (exception instanceof ApiException) {
    const status = exception.getStatus()
    return {
      status,
      body: createBody(
        { code: exception.code, message: exception.publicMessage },
        requestId,
        exception.fieldErrors,
      ),
      unexpected: false,
    }
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus()
    return {
      status,
      // 普通 HttpException 可能携带框架、数据库或业务内部详情，只按 status 映射固定安全文案。
      body: createBody(contractForHttpStatus(status), requestId),
      unexpected: false,
    }
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: createBody(internalContract, requestId),
    unexpected: true,
  }
}
