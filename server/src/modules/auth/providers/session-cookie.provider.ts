import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { SESSION_ABSOLUTE_TIMEOUT_MS } from '../../../config/auth.config'

const PRODUCTION_COOKIE_NAME = '__Host-qianshu_session'
const DEVELOPMENT_COOKIE_NAME = 'qianshu_session_dev'
const EXPIRED_COOKIE_DATE = new Date(0)
const INVALID_COOKIE_EXPIRY_MESSAGE =
  'Session cookie expiry must be in the future'
const INVALID_NODE_ENVIRONMENT_MESSAGE = 'Unsupported session cookie environment'

type NodeEnvironment = 'development' | 'test' | 'production'

export type SessionCookieOptions = Readonly<{
  expires: Date
  httpOnly: true
  maxAge: number
  path: '/'
  sameSite: 'strict'
  secure: boolean
}>

export type SessionCookie = Readonly<{
  name: string
  options: SessionCookieOptions
  value: string
}>

/**
 * 集中构造 Session Cookie，确保设置与清理使用完全相同的名称、路径和安全属性。
 * `maxAge` 使用 Express CookieOptions 约定的毫秒单位。
 */
@Injectable()
export class SessionCookieProvider {
  private readonly cookieName: string
  private readonly secure: boolean

  constructor(configService: ConfigService) {
    const nodeEnvironment =
      configService.getOrThrow<NodeEnvironment>('app.nodeEnv')

    if (
      nodeEnvironment !== 'development' &&
      nodeEnvironment !== 'test' &&
      nodeEnvironment !== 'production'
    ) {
      throw new Error(INVALID_NODE_ENVIRONMENT_MESSAGE)
    }

    this.cookieName =
      nodeEnvironment === 'production'
        ? PRODUCTION_COOKIE_NAME
        : DEVELOPMENT_COOKIE_NAME
    this.secure = nodeEnvironment === 'production'
  }

  /**
   * 从原始 Cookie Header 中提取当前环境唯一 Session 值。
   *
   * Session Token 只包含 UUID、点号和 base64url 字符，不需要 URL decode；重复同名
   * Cookie 会造成代理与框架取值歧义，因此统一视为无效而不是任选一个。
   */
  readValue(cookieHeader: unknown): string | null {
    if (typeof cookieHeader !== 'string') {
      return null
    }

    let matchedValue: string | null = null
    for (const segment of cookieHeader.split(';')) {
      const separator = segment.indexOf('=')
      if (separator < 0) {
        continue
      }

      const name = segment.slice(0, separator).trim()
      if (name !== this.cookieName) {
        continue
      }

      const value = segment.slice(separator + 1).trim()
      if (value.length === 0 || matchedValue !== null) {
        return null
      }

      matchedValue = value
    }

    return matchedValue
  }

  create(
    value: string,
    absoluteExpiresAt: Date,
    currentTime = new Date(),
  ): SessionCookie {
    const absoluteExpiresAtMs = absoluteExpiresAt.getTime()
    const currentTimeMs = currentTime.getTime()
    const remainingLifetimeMs = absoluteExpiresAtMs - currentTimeMs

    if (
      !Number.isFinite(absoluteExpiresAtMs) ||
      !Number.isFinite(currentTimeMs) ||
      remainingLifetimeMs <= 0
    ) {
      throw new Error(INVALID_COOKIE_EXPIRY_MESSAGE)
    }

    // Max-Age 只有整秒语义；向下取整避免 Cookie 比服务端 absoluteExpiresAt 活得更久。
    const effectiveLifetimeMs = Math.min(
      remainingLifetimeMs,
      SESSION_ABSOLUTE_TIMEOUT_MS,
    )
    const maxAge = Math.floor(effectiveLifetimeMs / 1_000) * 1_000

    if (maxAge <= 0) {
      throw new Error(INVALID_COOKIE_EXPIRY_MESSAGE)
    }

    const effectiveExpiresAt = new Date(currentTimeMs + effectiveLifetimeMs)

    return {
      name: this.cookieName,
      value,
      options: this.createOptions(maxAge, effectiveExpiresAt),
    }
  }

  clear(): SessionCookie {
    return {
      name: this.cookieName,
      value: '',
      options: this.createOptions(0, new Date(EXPIRED_COOKIE_DATE)),
    }
  }

  private createOptions(maxAge: number, expires: Date): SessionCookieOptions {
    return {
      expires,
      httpOnly: true,
      maxAge,
      path: '/',
      sameSite: 'strict',
      secure: this.secure,
    }
  }
}
