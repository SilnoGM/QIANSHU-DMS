import type {
  ApiError as GeneratedApiError,
  ApiErrorIssue as GeneratedApiErrorIssue,
} from './generated/types.gen'

/**
 * ApiError 以 OpenAPI 生成类型为唯一编译期真相源，避免 Web 手写 DTO 与 Server 契约漂移。
 */
export type ApiError = GeneratedApiError
export type ApiErrorIssue = GeneratedApiErrorIssue

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isFieldErrors(value: unknown): value is Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return false
  }

  return Object.values(value).every(isStringArray)
}

function isApiErrorIssue(value: unknown): value is ApiErrorIssue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>
  if (typeof candidate.code !== 'string' || typeof candidate.message !== 'string') {
    return false
  }
  if (candidate.field !== undefined && typeof candidate.field !== 'string') {
    return false
  }
  if (candidate.channel !== undefined && typeof candidate.channel !== 'string') {
    return false
  }
  if (
    candidate.itemIndex !== undefined
    && (
      typeof candidate.itemIndex !== 'number'
      || !Number.isInteger(candidate.itemIndex)
      || candidate.itemIndex < 0
    )
  ) {
    return false
  }
  return true
}

function isApiErrorIssues(value: unknown): value is ApiErrorIssue[] {
  return Array.isArray(value) && value.every(isApiErrorIssue)
}

/**
 * 对不可信的 HTTP body 执行最小结构守卫。
 *
 * 守卫校验当前契约的必需字段与已声明可选结构（fieldErrors/issues），但不限制额外字段，
 * 使 Server 以后增加非破坏性元数据时旧 Web 仍能安全识别基础 ApiError。
 */
export function isApiError(value: unknown): value is ApiError {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false
    }

    const candidate = value as Record<string, unknown>
    if (
      typeof candidate.code !== 'string'
      || typeof candidate.message !== 'string'
      || typeof candidate.requestId !== 'string'
    ) {
      return false
    }

    const fieldErrors = candidate.fieldErrors
    if (fieldErrors !== undefined && !isFieldErrors(fieldErrors)) {
      return false
    }

    const issues = candidate.issues
    return issues === undefined || isApiErrorIssues(issues)
  }
  catch {
    // HTTP body 可能是带 getter 或 Proxy trap 的不可信对象，守卫不得向上抛出其异常。
    return false
  }
}
