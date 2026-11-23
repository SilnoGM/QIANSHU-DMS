import { Prisma } from '../../generated/prisma/client'
import { signCheetahGoTokenRequest } from './cheetahgo-signature'

/**
 * 猎豹 CheetahGo Open API 客户端。
 *
 * 只实现本项目实际使用的两个只读接口：账户列表与日期范围日消耗。
 * 凭据（appid/secret）只在换取 token 的请求中出现；token 缓存到 JWT exp 前 5 分钟。
 * 签名算法与原因见 cheetahgo-signature.ts。
 */

export const CHEETAHGO_REQUEST_TIMEOUT_MS = 15_000

const ACCOUNT_PAGE_SIZE = 1000
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000
/** 上游无时区字符串统一按北京时间解释：update_date 是平台侧的墙上时间。 */
const PLATFORM_UTC_OFFSET = '+08:00'
const PLATFORM_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/
const SPEND_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const AUTH_BUSINESS_CODES = new Set([1006, 1007, 1011, 1099])

export type CheetahGoErrorKind =
  | 'DISABLED'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'VENDOR_REJECTED'

export class CheetahGoError extends Error {
  constructor(
    readonly kind: CheetahGoErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'CheetahGoError'
  }
}

export interface CheetahGoAccount {
  readonly accountId: string
  readonly accountName: string
  readonly companyCn: string | null
  readonly accountStatus: number
  readonly accountStatusText: string | null
  readonly freeze: number | null
  readonly disableReason: number
  readonly spendCap: string
  readonly amountSpent: string
  readonly dailySpendLimit: string | null
  readonly disabledTransferAmount: string
  readonly createdTime: Date
  readonly vendorUpdatedAt: Date
}

export interface CheetahGoDailySpend {
  readonly accountId: string
  readonly date: string
  readonly spend: string
}

export interface CheetahGoClientOptions {
  readonly appid: string
  readonly secret: string
  readonly baseUrl: string
  readonly fetchImpl?: typeof fetch
  readonly now?: () => Date
  readonly requestTimeoutMs?: number
}

interface CachedToken {
  readonly value: string
  readonly expiresAt: number
}

interface RequestOptions {
  readonly method: 'GET' | 'POST'
  readonly body?: unknown
  readonly token?: string
  readonly query?: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidPayload(detail: string): CheetahGoError {
  return new CheetahGoError('INVALID_RESPONSE', `cheetahgo payload invalid: ${detail}`)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidPayload(field)
  }

  return value
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }

  return value
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw invalidPayload(field)
  }

  return value
}

function optionalNumber(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null
  }

  return value
}

function decimalString(value: unknown, field: string, fallback = '0.00'): string {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw invalidPayload(field)
  }

  // 统一走 Decimal 归一，避免上游偶尔给 number 时丢精度。
  return new Prisma.Decimal(value).toFixed(2)
}

function optionalDecimalString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  return decimalString(value, 'amount')
}

/** 解析 `YYYY-MM-DD HH:mm:ss` 的无时区字符串，按平台时区解释。 */
function parsePlatformDateTime(value: unknown, field: string): Date {
  const raw = requireString(value, field)
  const match = raw.match(PLATFORM_DATE_TIME_PATTERN)

  if (match === null) {
    throw invalidPayload(field)
  }

  return new Date(`${match[1]}T${match[2]}${PLATFORM_UTC_OFFSET}`)
}

function parseUnixSeconds(value: unknown, field: string): Date {
  return new Date(requireNumber(value, field) * 1000)
}

function normalizeAccount(row: unknown): CheetahGoAccount {
  if (!isRecord(row)) {
    throw invalidPayload('account row')
  }

  return {
    accountId: requireString(row.account_id, 'account_id'),
    accountName: requireString(row.account_name, 'account_name'),
    companyCn: optionalString(row.company_cn),
    accountStatus: requireNumber(row.account_status, 'account_status'),
    accountStatusText: optionalString(row.account_status_text),
    freeze: optionalNumber(row.freeze),
    disableReason: optionalNumber(row.disable_reason) ?? 0,
    spendCap: decimalString(row.spend_cap, 'spend_cap'),
    amountSpent: decimalString(row.amount_spent, 'amount_spent'),
    dailySpendLimit: optionalDecimalString(row.daily_spend_limit),
    disabledTransferAmount: decimalString(row.disabled_transfer_amount, 'disabled_transfer_amount'),
    createdTime: parseUnixSeconds(row.created_time, 'created_time'),
    vendorUpdatedAt: parsePlatformDateTime(row.update_date, 'update_date'),
  }
}

function normalizeDailySpend(row: unknown): CheetahGoDailySpend {
  if (!isRecord(row)) {
    throw invalidPayload('spend row')
  }

  const date = requireString(row.date, 'date')

  if (!SPEND_DATE_PATTERN.test(date)) {
    throw invalidPayload('spend date')
  }

  return {
    accountId: requireString(row.account_id, 'account_id'),
    date,
    spend: decimalString(row.spend, 'spend'),
  }
}

/** JWT exp 解析失败时退回 30 天有效期的保守估计。 */
function resolveTokenExpiry(token: string, now: Date): number {
  const payload = token.split('.')[1]

  if (payload) {
    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown

      if (isRecord(decoded) && typeof decoded.exp === 'number') {
        return decoded.exp * 1000
      }
    } catch {
      // 落到下面的默认值
    }
  }

  return now.getTime() + 30 * 24 * 60 * 60 * 1000
}

function isRetryable(error: unknown): boolean {
  if (error instanceof CheetahGoError) {
    return error.kind === 'UNAVAILABLE'
  }

  // 网络错误与超时（AbortError）重试一次；业务错误不重试。
  return true
}

export class CheetahGoClient {
  private readonly appid: string
  private readonly secret: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly now: () => Date
  private readonly requestTimeoutMs: number
  private cachedToken: CachedToken | null = null

  constructor(options: CheetahGoClientOptions) {
    this.appid = options.appid
    this.secret = options.secret
    this.baseUrl = options.baseUrl
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? (() => new Date())
    this.requestTimeoutMs = options.requestTimeoutMs ?? CHEETAHGO_REQUEST_TIMEOUT_MS
  }

  async listAccounts(): Promise<CheetahGoAccount[]> {
    const accounts: CheetahGoAccount[] = []
    let page = 1

    for (;;) {
      const data = await this.authedRequest<unknown>('/v1/facebook-account-list', {
        page: String(page),
        page_size: String(ACCOUNT_PAGE_SIZE),
      })

      if (!isRecord(data) || !Array.isArray(data.list)) {
        throw invalidPayload('account list')
      }

      for (const row of data.list) {
        accounts.push(normalizeAccount(row))
      }

      const pager = isRecord(data.pager) ? data.pager : null
      const totalPage = pager && typeof pager.total_page === 'number' ? pager.total_page : 1

      if (page >= totalPage) {
        break
      }

      page += 1
    }

    return accounts
  }

  async listDailySpend(startDate: string, endDate: string): Promise<CheetahGoDailySpend[]> {
    const data = await this.authedRequest<unknown>('/v1/day-range-account-spend', {
      start_date: startDate,
      end_date: endDate,
    })

    if (!Array.isArray(data)) {
      throw invalidPayload('daily spend')
    }

    return data.map(normalizeDailySpend)
  }

  private async authedRequest<T>(path: string, query?: Record<string, string>): Promise<T> {
    const token = await this.getToken()

    try {
      return await this.request<T>(path, { method: 'GET', token, query })
    } catch (error) {
      if (error instanceof CheetahGoError && error.kind === 'UNAUTHORIZED') {
        // token 被对方判定无效（过期/轮换）：清缓存换新 token 重试一次。
        this.cachedToken = null
        const refreshed = await this.getToken(true)

        return await this.request<T>(path, { method: 'GET', token: refreshed, query })
      }

      throw error
    }
  }

  private async getToken(forceRefresh = false): Promise<string> {
    const now = this.now()

    if (!forceRefresh && this.cachedToken && this.cachedToken.expiresAt > now.getTime()) {
      return this.cachedToken.value
    }

    const timestamp = Math.floor(now.getTime() / 1000)
    const payload = await this.request<unknown>('/v1/access-token', {
      method: 'POST',
      body: {
        appid: this.appid,
        secret: this.secret,
        timestamp,
        signature: signCheetahGoTokenRequest(this.appid, this.secret, timestamp),
      },
    })

    if (!isRecord(payload) || typeof payload.access_token !== 'string') {
      throw invalidPayload('access token')
    }

    const token = payload.access_token
    this.cachedToken = {
      value: token,
      expiresAt: resolveTokenExpiry(token, now) - TOKEN_REFRESH_MARGIN_MS,
    }

    return token
  }

  private async request<T>(path: string, options: RequestOptions): Promise<T> {
    let lastError: unknown

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.requestOnce<T>(path, options)
      } catch (error) {
        lastError = error

        if (attempt > 0 || !isRetryable(error)) {
          throw error
        }
      }
    }

    throw lastError instanceof Error ? lastError : new CheetahGoError('UNAVAILABLE', 'cheetahgo request failed')
  }

  private async requestOnce<T>(path: string, options: RequestOptions): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs)

    try {
      const url = new URL(path, this.baseUrl)

      for (const [key, value] of Object.entries(options.query ?? {})) {
        url.searchParams.set(key, value)
      }

      const headers: Record<string, string> = { 'content-type': 'application/json' }

      if (options.token) {
        headers.Authorization = options.token
      }

      const response = await this.fetchImpl(url.toString(), {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      })

      if (response.status === 401 || response.status === 403) {
        throw new CheetahGoError('UNAUTHORIZED', 'cheetahgo rejected credentials')
      }

      if (response.status === 429) {
        throw new CheetahGoError('RATE_LIMITED', 'cheetahgo rate limited')
      }

      if (response.status >= 500) {
        throw new CheetahGoError('UNAVAILABLE', 'cheetahgo server error')
      }

      if (!response.ok) {
        throw new CheetahGoError('VENDOR_REJECTED', `cheetahgo http ${response.status}`)
      }

      const payload = (await response.json()) as unknown

      if (!isRecord(payload) || typeof payload.code !== 'number') {
        throw invalidPayload('response envelope')
      }

      if (payload.code !== 0) {
        if (AUTH_BUSINESS_CODES.has(payload.code)) {
          throw new CheetahGoError('UNAUTHORIZED', `cheetahgo auth error ${payload.code}`)
        }

        throw new CheetahGoError('VENDOR_REJECTED', `cheetahgo business error ${payload.code}`)
      }

      return payload.data as T
    } finally {
      clearTimeout(timer)
    }
  }
}
