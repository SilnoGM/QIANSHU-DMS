import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { ApiException } from '../../../infrastructure/http/api.exception'

const SAFE_METHODS = new Set(['GET', 'HEAD'])
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const RELEVANT_HEADER_NAMES = [
  'origin',
  'x-qianshu-csrf',
  'content-type',
  'sec-fetch-site',
] as const

type RelevantHeaderName = (typeof RELEVANT_HEADER_NAMES)[number]
type HeaderSnapshot = Readonly<Record<RelevantHeaderName, string | undefined>>

type SafeReadResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false }>

type HeaderReadResult =
  | Readonly<{ ok: true; headers: HeaderSnapshot }>
  | Readonly<{ ok: false }>

const MEDIA_TYPE_TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+"
const QUOTED_STRING =
  '"(?:[\\t\\x20\\x21\\x23-\\x5b\\x5d-\\x7e\\x80-\\xff]|\\\\[\\t\\x20-\\x7e\\x80-\\xff])*"'
const JSON_CONTENT_TYPE_PATTERN = new RegExp(
  `^[\\t ]*application/json[\\t ]*(?:;[\\t ]*${MEDIA_TYPE_TOKEN}[\\t ]*=[\\t ]*(?:${MEDIA_TYPE_TOKEN}|${QUOTED_STRING})[\\t ]*)*$`,
  'i',
)
const HTTP_TOKEN_PATTERN = new RegExp(`^${MEDIA_TYPE_TOKEN}$`)

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

/**
 * Request/headers 可能来自代理对象或测试 double。所有属性读取都在本边界捕获，
 * 防止异常 getter 绕过固定的 CSRF 拒绝契约，或把内部异常内容带到响应中。
 */
function safeRead(target: unknown, property: PropertyKey): SafeReadResult {
  if (!isObject(target)) {
    return { ok: false }
  }

  try {
    return { ok: true, value: Reflect.get(target, property) }
  } catch {
    return { ok: false }
  }
}

function safeOwnKeys(target: object): readonly string[] | undefined {
  try {
    return Object.keys(target)
  } catch {
    return undefined
  }
}

function readRawHeaderCounts(
  request: unknown,
): ReadonlyMap<RelevantHeaderName, number> | undefined {
  const rawHeadersRead = safeRead(request, 'rawHeaders')
  if (!rawHeadersRead.ok) {
    return undefined
  }

  const rawHeaders = rawHeadersRead.value
  const counts = new Map<RelevantHeaderName, number>(
    RELEVANT_HEADER_NAMES.map((name) => [name, 0]),
  )

  // 单元测试或非 Node HTTP adapter 可以没有 rawHeaders；有该字段时必须结构完整。
  if (rawHeaders === undefined) {
    return counts
  }
  if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 !== 0) {
    return undefined
  }

  const rawHeaderEntries: readonly unknown[] = rawHeaders
  for (let index = 0; index < rawHeaderEntries.length; index += 2) {
    const rawName: unknown = rawHeaderEntries[index]
    const rawValue: unknown = rawHeaderEntries[index + 1]
    if (typeof rawName !== 'string' || typeof rawValue !== 'string') {
      return undefined
    }

    const normalizedName = rawName.toLowerCase()
    if (
      RELEVANT_HEADER_NAMES.includes(
        normalizedName as RelevantHeaderName,
      )
    ) {
      const name = normalizedName as RelevantHeaderName
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }

  return counts
}

function readRelevantHeaders(request: unknown): HeaderReadResult {
  const headersRead = safeRead(request, 'headers')
  if (!headersRead.ok || !isObject(headersRead.value)) {
    return { ok: false }
  }

  const headerObject = headersRead.value
  const headerKeys = safeOwnKeys(headerObject)
  const rawHeaderCounts = readRawHeaderCounts(request)
  if (headerKeys === undefined || rawHeaderCounts === undefined) {
    return { ok: false }
  }

  const snapshot = {} as Record<RelevantHeaderName, string | undefined>
  for (const expectedName of RELEVANT_HEADER_NAMES) {
    const matchingKeys = headerKeys.filter(
      (headerKey) => headerKey.toLowerCase() === expectedName,
    )

    if (matchingKeys.length > 1 || (rawHeaderCounts.get(expectedName) ?? 0) > 1) {
      return { ok: false }
    }

    if (matchingKeys.length === 0) {
      snapshot[expectedName] = undefined
      continue
    }

    const valueRead = safeRead(headerObject, matchingKeys[0])
    if (
      !valueRead.ok ||
      (valueRead.value !== undefined && typeof valueRead.value !== 'string')
    ) {
      // Node 的 string[] 表示重复 Header；Guard 不接受自动拼接或任选其一。
      return { ok: false }
    }

    snapshot[expectedName] = valueRead.value
  }

  return { ok: true, headers: snapshot }
}

function isJsonContentType(value: string | undefined): boolean {
  return value !== undefined && JSON_CONTENT_TYPE_PATTERN.test(value)
}

function isCrossSiteOrMalformed(value: string | undefined): boolean {
  if (value === undefined) {
    return false
  }

  // Fetch Metadata 是单一 token；拒绝逗号拼接等重复值，但不依赖浏览器一定发送该 Header。
  if (!HTTP_TOKEN_PATTERN.test(value)) {
    return true
  }

  return value.toLowerCase() === 'cross-site'
}

/**
 * Cookie Session 的全局 CSRF 防线。它不读取 Public 等路由元数据，因此 login、
 * logout 及其他匿名/可选 Session 写操作也会执行完全相同的来源校验。
 */
@Injectable()
export class CsrfProtectionGuard implements CanActivate {
  private readonly appOrigin: string

  constructor(configService: ConfigService) {
    this.appOrigin = configService.getOrThrow<string>('auth.appOrigin')
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<unknown>()
    const methodRead = safeRead(request, 'method')
    if (!methodRead.ok || typeof methodRead.value !== 'string') {
      return this.reject()
    }

    const method = methodRead.value.toUpperCase()
    if (SAFE_METHODS.has(method)) {
      return true
    }
    if (!UNSAFE_METHODS.has(method)) {
      return this.reject()
    }

    const headerRead = readRelevantHeaders(request)
    if (!headerRead.ok) {
      return this.reject()
    }

    const headers = headerRead.headers
    if (
      headers.origin === undefined ||
      headers.origin === 'null' ||
      headers.origin !== this.appOrigin ||
      headers['x-qianshu-csrf'] !== '1' ||
      !isJsonContentType(headers['content-type']) ||
      isCrossSiteOrMalformed(headers['sec-fetch-site'])
    ) {
      return this.reject()
    }

    return true
  }

  private reject(): never {
    // 只返回固定文案；任何请求 Header、Origin 或解析异常都不进入错误对象。
    throw new ApiException(403, 'CSRF_REJECTED', '请求来源校验失败')
  }
}
