import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import {
  AuthRateLimitScope as AuthRateLimitScopeValues,
  type AuthRateLimitScope,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { ApiException } from '../../../infrastructure/http/api.exception'

const SUBJECT_KEY_HASH_BYTE_LENGTH = 32

const RATE_LIMIT_ATTEMPT_LIMITS: Readonly<
  Record<AuthRateLimitScope, number>
> = Object.freeze({
  [AuthRateLimitScopeValues.LOGIN_USERNAME]: 5,
  [AuthRateLimitScopeValues.LOGIN_IP]: 30,
  [AuthRateLimitScopeValues.PASSWORD_CHANGE_USER]: 5,
  [AuthRateLimitScopeValues.PASSWORD_CHANGE_IP]: 30,
})

type AuthRateLimitStateRow = Readonly<{
  blockedUntil: Date | null
  dbNow: Date
}>

export class AuthRateLimitInputError extends Error {
  readonly code = 'AUTH_RATE_LIMIT_INPUT_INVALID'

  constructor() {
    super('Authentication rate-limit input is invalid')
    this.name = 'AuthRateLimitInputError'
  }
}

export class AuthRateLimitOperationFailedError extends Error {
  readonly code = 'AUTH_RATE_LIMIT_OPERATION_FAILED'

  constructor() {
    // 不设置 cause，防止数据库连接、SQL 或驱动参数通过上层异常序列化泄露。
    super('Authentication rate-limit operation failed')
    this.name = 'AuthRateLimitOperationFailedError'
  }
}

/**
 * PostgreSQL 固定窗口认证限流。
 *
 * Service 只接收 HMAC 后的 32-byte 主体，不持有 username、userId 或 IP 明文；
 * 所有时效判断都使用同一条 SQL 内的 clock_timestamp()，避免应用实例时钟漂移。
 */
@Injectable()
export class AuthRateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  /** 必须由调用方在进入昂贵 Argon2 操作前调用。 */
  async assertAllowed(
    scope: AuthRateLimitScope,
    subjectKeyHash: Buffer,
  ): Promise<void> {
    const { safeSubjectKeyHash } = this.validateInput(scope, subjectKeyHash)
    let rows: AuthRateLimitStateRow[]

    try {
      rows = await this.prisma.$queryRaw<AuthRateLimitStateRow[]>(
        Prisma.sql`
          SELECT
            "blocked_until" AS "blockedUntil",
            clock_timestamp() AS "dbNow"
          FROM "auth_rate_limits"
          WHERE "scope" = ${scope}::"auth_rate_limit_scope"
            AND "subject_key_hash" = ${safeSubjectKeyHash}
          LIMIT 1
        `,
      )
    }
    catch {
      throw new AuthRateLimitOperationFailedError()
    }

    const row = rows[0]
    if (row === undefined) {
      return
    }

    if (
      !this.isValidDatabaseDate(row.dbNow) ||
      (row.blockedUntil !== null &&
        !this.isValidDatabaseDate(row.blockedUntil))
    ) {
      throw new AuthRateLimitOperationFailedError()
    }

    // 等号边界必须放行；blocked_until > dbNow 才表示仍在封禁窗口内。
    if (
      row.blockedUntil !== null &&
      row.blockedUntil.getTime() > row.dbNow.getTime()
    ) {
      throw new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'AUTH_RATE_LIMITED',
        '操作过于频繁，请稍后重试',
      )
    }
  }

  async recordFailure(
    scope: AuthRateLimitScope,
    subjectKeyHash: Buffer,
  ): Promise<void> {
    const { attemptLimit, safeSubjectKeyHash } = this.validateInput(
      scope,
      subjectKeyHash,
    )

    try {
      /**
       * 单条 INSERT ... ON CONFLICT 完成并发线性化：
       * - database_time 只计算一次 clock_timestamp()，再借 EXCLUDED.updated_at 复用；
       * - 活跃封禁保持原值，避免并发中的迟到失败无限延长封禁；
       * - 15 分钟窗口在等号边界重置为第一次失败；
       * - 达到阈值后从当前数据库时间起封禁 15 分钟。
       */
      await this.prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO "auth_rate_limits" AS "current" (
            "scope",
            "subject_key_hash",
            "bucket_started_at",
            "attempt_count",
            "blocked_until",
            "updated_at"
          )
          SELECT
            ${scope}::"auth_rate_limit_scope",
            ${safeSubjectKeyHash},
            "database_time"."db_now",
            1,
            NULL,
            "database_time"."db_now"
          FROM (
            SELECT clock_timestamp() AS "db_now"
          ) AS "database_time"
          ON CONFLICT ("scope", "subject_key_hash")
          DO UPDATE SET
            "bucket_started_at" = CASE
              WHEN "current"."blocked_until" > EXCLUDED."updated_at"
                THEN "current"."bucket_started_at"
              WHEN "current"."bucket_started_at" + INTERVAL '15 minutes' <= EXCLUDED."updated_at"
                THEN EXCLUDED."updated_at"
              ELSE "current"."bucket_started_at"
            END,
            "attempt_count" = CASE
              WHEN "current"."blocked_until" > EXCLUDED."updated_at"
                THEN "current"."attempt_count"
              WHEN "current"."bucket_started_at" + INTERVAL '15 minutes' <= EXCLUDED."updated_at"
                THEN 1
              ELSE "current"."attempt_count" + 1
            END,
            "blocked_until" = CASE
              WHEN "current"."blocked_until" > EXCLUDED."updated_at"
                THEN "current"."blocked_until"
              WHEN "current"."bucket_started_at" + INTERVAL '15 minutes' <= EXCLUDED."updated_at"
                THEN NULL
              WHEN "current"."attempt_count" + 1 >= ${attemptLimit}
                THEN EXCLUDED."updated_at" + INTERVAL '15 minutes'
              ELSE NULL
            END,
            "updated_at" = EXCLUDED."updated_at"
        `,
      )
    }
    catch {
      throw new AuthRateLimitOperationFailedError()
    }
  }

  async clear(
    scope: AuthRateLimitScope,
    subjectKeyHash: Buffer,
  ): Promise<void> {
    const { safeSubjectKeyHash } = this.validateInput(scope, subjectKeyHash)

    try {
      await this.prisma.$executeRaw(
        Prisma.sql`
          DELETE FROM "auth_rate_limits"
          WHERE "scope" = ${scope}::"auth_rate_limit_scope"
            AND "subject_key_hash" = ${safeSubjectKeyHash}
        `,
      )
    }
    catch {
      throw new AuthRateLimitOperationFailedError()
    }
  }

  private validateInput(
    scope: AuthRateLimitScope,
    subjectKeyHash: Buffer,
  ): Readonly<{
    attemptLimit: number
    safeSubjectKeyHash: Buffer
  }> {
    const attemptLimit = RATE_LIMIT_ATTEMPT_LIMITS[scope]

    if (
      attemptLimit === undefined ||
      !Buffer.isBuffer(subjectKeyHash) ||
      subjectKeyHash.byteLength !== SUBJECT_KEY_HASH_BYTE_LENGTH
    ) {
      throw new AuthRateLimitInputError()
    }

    // 复制调用方 Buffer，避免异步 SQL 执行期间被外部修改查询参数。
    return {
      attemptLimit,
      safeSubjectKeyHash: Buffer.from(subjectKeyHash),
    }
  }

  private isValidDatabaseDate(value: unknown): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime())
  }
}
