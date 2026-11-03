import { Inject, Injectable } from '@nestjs/common'

export const IPFOXY_CONFIG = Symbol('qianshu.ipfoxy.config')
export const IPFOXY_FETCH = Symbol('qianshu.ipfoxy.fetch')

const PROXY_PAGE_SIZE = 50
const MAX_PAGES = 100
const REQUEST_TIMEOUT_MS = 10_000
const SUCCESS_CODE = 0
const UNAUTHORIZED_CODE = 60401
const RATE_LIMITED_CODE = 50000

export interface IpfoxyCredentials {
  readonly apiId: string | null
  readonly apiToken: string | null
  readonly baseUrl: string
}

export type IpfoxyFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>

/**
 * 供应商原始记录只声明为 unknown 字段，由 mapper 统一校验。
 * 这样接口新增字段不会破坏类型，而非法值会在同步阶段被明确跳过并计数。
 */
export interface RawIpfoxyProxyRecord {
  readonly id?: unknown
  readonly host?: unknown
  readonly public_ip?: unknown
  readonly port?: unknown
  readonly type?: unknown
  readonly area_id?: unknown
  readonly user?: unknown
  readonly password?: unknown
  readonly auto_extend?: unknown
  readonly expire_time?: unknown
  readonly buy_time?: unknown
  readonly country_code?: unknown
  readonly ip_type?: unknown
  readonly ip_version?: unknown
  readonly renewal_time?: unknown
}

export interface RawIpfoxyAreaRecord {
  readonly id?: unknown
  readonly country?: unknown
  readonly country_code?: unknown
  readonly ip_type?: unknown
  readonly ip_version?: unknown
  readonly status?: unknown
}

export type IpfoxyErrorKind =
  | 'NOT_CONFIGURED'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INVALID_RESPONSE'

export class IpfoxyClientError extends Error {
  constructor(
    readonly kind: IpfoxyErrorKind,
    readonly vendorCode?: number,
  ) {
    super(`IPFoxy request failed: ${kind}`)
    this.name = 'IpfoxyClientError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * IPFoxy 只读客户端。
 *
 * 安全边界：
 * - 出站主机固定为配置里的 `https://apis.ipfoxy.com`，不接受用户可控 URL；
 * - 请求头才携带 api-id/api-token，绝不拼进 URL；
 * - 不记录请求头、响应体或代理凭据，异常只保留固定 kind 与业务码。
 */
@Injectable()
export class IpfoxyClient {
  constructor(
    @Inject(IPFOXY_CONFIG) private readonly config: IpfoxyCredentials,
    @Inject(IPFOXY_FETCH) private readonly fetchImpl: IpfoxyFetch,
  ) {}

  get configured(): boolean {
    return Boolean(this.config.apiId && this.config.apiToken)
  }

  async listProxies(): Promise<RawIpfoxyProxyRecord[]> {
    const records: RawIpfoxyProxyRecord[] = []
    const seen = new Set<string>()
    let page = 1
    let total = 0

    do {
      const data = await this.request('/ip/open-api/proxy-list', {
        page: String(page),
        page_size: String(PROXY_PAGE_SIZE),
      })

      if (!isRecord(data) || !Array.isArray(data.list)) {
        throw new IpfoxyClientError('INVALID_RESPONSE')
      }

      const pageTotal = Number(data.total)
      if (!Number.isFinite(pageTotal) || pageTotal < 0) {
        throw new IpfoxyClientError('INVALID_RESPONSE')
      }
      total = pageTotal

      for (const item of data.list) {
        if (!isRecord(item) || typeof item.id !== 'string' || item.id === '') {
          throw new IpfoxyClientError('INVALID_RESPONSE')
        }
        if (!seen.has(item.id)) {
          seen.add(item.id)
          records.push(item)
        }
      }

      // 空页说明分页提前结束；即使 total 仍大于已取条数，也不能无限请求。
      if (data.list.length === 0) {
        break
      }
      page += 1
    } while (records.length < total && page <= MAX_PAGES)

    if (total > 0 && records.length === 0) {
      throw new IpfoxyClientError('INVALID_RESPONSE')
    }

    return records
  }

  async listAreas(): Promise<RawIpfoxyAreaRecord[]> {
    const data = await this.request('/ip/open-api/area-list')
    if (!Array.isArray(data)) {
      throw new IpfoxyClientError('INVALID_RESPONSE')
    }
    return data.filter(isRecord)
  }

  private async request(
    path: string,
    query: Record<string, string> = {},
  ): Promise<unknown> {
    if (!this.config.apiId || !this.config.apiToken) {
      throw new IpfoxyClientError('NOT_CONFIGURED')
    }

    const base = new URL(this.config.baseUrl)
    const url = new URL(path, base)
    // path 是代码内固定常量；这里仍然校验 origin，防止未来误改成绝对 URL。
    if (url.origin !== base.origin) {
      throw new IpfoxyClientError('INVALID_RESPONSE')
    }
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: {
            accept: 'application/json',
            'api-id': this.config.apiId,
            'api-token': this.config.apiToken,
          },
          signal: controller.signal,
        })

        if (response.status === 401 || response.status === 403) {
          throw new IpfoxyClientError('UNAUTHORIZED')
        }
        if (response.status === 429) {
          throw new IpfoxyClientError('RATE_LIMITED')
        }
        if (response.status >= 500) {
          if (attempt === 0) {
            continue
          }
          throw new IpfoxyClientError('UNAVAILABLE')
        }
        if (!response.ok) {
          throw new IpfoxyClientError('UNAVAILABLE')
        }

        let body: unknown
        try {
          body = await response.json()
        }
        catch {
          throw new IpfoxyClientError('INVALID_RESPONSE')
        }

        if (!isRecord(body)) {
          throw new IpfoxyClientError('INVALID_RESPONSE')
        }

        const code = Number(body.code)
        if (!Number.isFinite(code)) {
          throw new IpfoxyClientError('INVALID_RESPONSE')
        }
        if (code === SUCCESS_CODE) {
          return body.data
        }
        if (code === UNAUTHORIZED_CODE) {
          throw new IpfoxyClientError('UNAUTHORIZED', code)
        }
        if (code === RATE_LIMITED_CODE) {
          throw new IpfoxyClientError('RATE_LIMITED', code)
        }
        throw new IpfoxyClientError('UNAVAILABLE', code)
      }
      catch (error) {
        if (error instanceof IpfoxyClientError) {
          throw error
        }
        // 网络错误、超时与中止只重试一次；第二次仍失败则统一为不可用。
        if (attempt === 0) {
          continue
        }
        throw new IpfoxyClientError('UNAVAILABLE')
      }
      finally {
        clearTimeout(timer)
      }
    }

    throw new IpfoxyClientError('UNAVAILABLE')
  }
}
