import type { ApiError as GeneratedApiError } from './generated/types.gen'

/**
 * ApiError 以 OpenAPI 生成类型为唯一编译期真相源，避免 Web 手写 DTO 与 Server 契约漂移。
 */
export type ApiError = GeneratedApiError

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

/**
 * 对不可信的 HTTP body 执行最小结构守卫。
 *
 * 守卫只校验当前契约必需字段，不限制额外字段，使 Server 以后增加非破坏性元数据时
 * 旧 Web 仍能安全识别基础 ApiError。
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
    return fieldErrors === undefined || isFieldErrors(fieldErrors)
  }
  catch {
    // HTTP body 可能是带 getter 或 Proxy trap 的不可信对象，守卫不得向上抛出其异常。
    return false
  }
}
