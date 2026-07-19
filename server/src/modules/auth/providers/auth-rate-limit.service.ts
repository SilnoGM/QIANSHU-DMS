import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../../generated/prisma/client'
import {
  AuthRateLimitScope as AuthRateLimitScopeValues,
  type AuthRateLimitScope,
} from '../../../generated/prisma/enums'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../../infrastructure/database/transaction-timeouts'
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

export type AuthRateLimitAttempt = Readonly<{
  scope: AuthRateLimitScope
  subjectKeyHash: Buffer
}>

type AuthRateLimitReservationEntry = Readonly<{
  bucketStartedAtKey: string
  scope: AuthRateLimitScope
  subjectKeyHash: Buffer
}>

/**
 * 一次凭证校验占用的全部限流桶。
 *
 * 调用方只应在凭证错误时保留该预占；成功或基础设施错误必须释放。精确的
 * bucket key 让迟到释放不会误减已经滚动到下一固定窗口的计数。
 */
export type AuthRateLimitReservation = Readonly<{
  entries: readonly AuthRateLimitReservationEntry[]
}>

type ReservationRow = Readonly<{
  bucketStartedAtKey: string
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
 * 在 Argon2 之前原子预占全部相关桶，消除“先检查、后计数”允许并发突发穿透
 * 阈值的竞态。短事务只负责预占，不跨 Argon2 持锁；同一批桶按稳定顺序加锁，
 * 防止不同请求以相反顺序互相等待。
 */
@Injectable()
export class AuthRateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async reserveAttempts(
    attempts: readonly AuthRateLimitAttempt[],
  ): Promise<AuthRateLimitReservation> {
    const safeAttempts = this.validateAndSortAttempts(attempts)

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const entries: AuthRateLimitReservationEntry[] = []

        for (const attempt of safeAttempts) {
          const rows = await transaction.$queryRaw<ReservationRow[]>(Prisma.sql`
            INSERT INTO "auth_rate_limits" AS "current" (
              "scope",
              "subject_key_hash",
              "bucket_started_at",
              "attempt_count",
              "blocked_until",
              "updated_at"
            )
            SELECT
              ${attempt.scope}::"auth_rate_limit_scope",
              ${attempt.subjectKeyHash},
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
                WHEN "current"."bucket_started_at" + INTERVAL '15 minutes' <= EXCLUDED."updated_at"
                  THEN EXCLUDED."updated_at"
                ELSE "current"."bucket_started_at"
              END,
              "attempt_count" = CASE
                WHEN "current"."bucket_started_at" + INTERVAL '15 minutes' <= EXCLUDED."updated_at"
                  THEN 1
                ELSE "current"."attempt_count" + 1
              END,
              "blocked_until" = CASE
                WHEN "current"."bucket_started_at" + INTERVAL '15 minutes' <= EXCLUDED."updated_at"
                  THEN NULL
                WHEN "current"."attempt_count" + 1 >= ${attempt.attemptLimit}
                  THEN EXCLUDED."updated_at" + INTERVAL '15 minutes'
                ELSE NULL
              END,
              "updated_at" = EXCLUDED."updated_at"
            WHERE
              (
                "current"."blocked_until" IS NULL
                OR "current"."blocked_until" <= EXCLUDED."updated_at"
              )
              AND (
                "current"."bucket_started_at" + INTERVAL '15 minutes' <= EXCLUDED."updated_at"
                OR "current"."attempt_count" < ${attempt.attemptLimit}
              )
            RETURNING
              "current"."bucket_started_at"::text AS "bucketStartedAtKey"
          `)
          const row = rows[0]

          if (row === undefined) {
            // 在 callback 内抛出可确保此前已预占的桶随事务一起回滚。
            throw this.createRateLimitedException()
          }
          if (!this.isValidBucketStartedAtKey(row.bucketStartedAtKey)) {
            throw new AuthRateLimitOperationFailedError()
          }

          entries.push(Object.freeze({
            bucketStartedAtKey: row.bucketStartedAtKey,
            scope: attempt.scope,
            subjectKeyHash: Buffer.from(attempt.subjectKeyHash),
          }))
        }

        return Object.freeze({ entries: Object.freeze(entries) })
      })
    } catch (error) {
      if (
        error instanceof ApiException
        && error.code === 'AUTH_RATE_LIMITED'
      ) {
        throw error
      }
      throw new AuthRateLimitOperationFailedError()
    }
  }

  /** 成功或非凭证错误在独立短事务中原子释放全部预占桶。 */
  async releaseReservation(
    reservation: AuthRateLimitReservation,
  ): Promise<void> {
    const entries = this.validateAndSortReservation(reservation)

    try {
      await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        await this.releaseEntriesInTransaction(transaction, entries)
      })
    } catch {
      throw new AuthRateLimitOperationFailedError()
    }
  }

  private async releaseEntriesInTransaction(
    transaction: Prisma.TransactionClient,
    entries: readonly AuthRateLimitReservationEntry[],
  ): Promise<void> {
    for (const entry of entries) {
      const attemptLimit = RATE_LIMIT_ATTEMPT_LIMITS[entry.scope]

      await transaction.$executeRaw(Prisma.sql`
        UPDATE "auth_rate_limits" AS "current"
        SET
          "attempt_count" = "current"."attempt_count" - 1,
          "blocked_until" = CASE
            WHEN "current"."attempt_count" - 1 < ${attemptLimit}
              THEN NULL
            ELSE "current"."blocked_until"
          END,
          "updated_at" = clock_timestamp()
        WHERE "current"."scope" = ${entry.scope}::"auth_rate_limit_scope"
          AND "current"."subject_key_hash" = ${entry.subjectKeyHash}
          AND "current"."bucket_started_at" = ${entry.bucketStartedAtKey}::timestamptz
          AND "current"."attempt_count" > 0
      `)
    }
  }

  private validateAndSortAttempts(
    attempts: readonly AuthRateLimitAttempt[],
  ): ReadonlyArray<AuthRateLimitAttempt & { attemptLimit: number }> {
    if (!Array.isArray(attempts) || attempts.length === 0) {
      throw new AuthRateLimitInputError()
    }

    const safeAttempts = attempts.map((attempt) => {
      const validated = this.validateAttempt(attempt)
      return {
        ...validated,
        attemptLimit: RATE_LIMIT_ATTEMPT_LIMITS[validated.scope],
      }
    })
    safeAttempts.sort((left, right) => this.compareSubjects(left, right))
    this.assertNoDuplicateSubjects(safeAttempts)
    return safeAttempts
  }

  private validateAndSortReservation(
    reservation: AuthRateLimitReservation,
  ): readonly AuthRateLimitReservationEntry[] {
    const reservationValue: unknown = reservation
    if (
      typeof reservationValue !== 'object'
      || reservationValue === null
    ) {
      throw new AuthRateLimitInputError()
    }
    const entriesValue = (reservationValue as { entries?: unknown }).entries
    if (!Array.isArray(entriesValue) || entriesValue.length === 0) {
      throw new AuthRateLimitInputError()
    }

    const entries = entriesValue.map((entry: unknown) => {
      const subject = this.validateAttempt(entry)
      const bucketStartedAtKey = (
        entry as { bucketStartedAtKey?: unknown }
      ).bucketStartedAtKey
      if (!this.isValidBucketStartedAtKey(bucketStartedAtKey)) {
        throw new AuthRateLimitInputError()
      }
      return {
        bucketStartedAtKey,
        scope: subject.scope,
        subjectKeyHash: subject.subjectKeyHash,
      }
    })
    entries.sort((left, right) => this.compareSubjects(left, right))
    this.assertNoDuplicateSubjects(entries)
    return entries
  }

  private validateAttempt(attempt: unknown): AuthRateLimitAttempt {
    if (typeof attempt !== 'object' || attempt === null) {
      throw new AuthRateLimitInputError()
    }
    const candidate = attempt as Partial<AuthRateLimitAttempt>
    const scope = candidate.scope
    const subjectKeyHash = candidate.subjectKeyHash
    if (
      !this.isValidScope(scope)
      || !Buffer.isBuffer(subjectKeyHash)
      || subjectKeyHash.byteLength !== SUBJECT_KEY_HASH_BYTE_LENGTH
    ) {
      throw new AuthRateLimitInputError()
    }

    // 复制调用方 Buffer，避免异步 SQL 执行期间被外部修改查询参数。
    return {
      scope,
      subjectKeyHash: Buffer.from(subjectKeyHash),
    }
  }

  private isValidScope(value: unknown): value is AuthRateLimitScope {
    return (
      typeof value === 'string'
      && Object.prototype.hasOwnProperty.call(RATE_LIMIT_ATTEMPT_LIMITS, value)
    )
  }

  private assertNoDuplicateSubjects(
    subjects: readonly AuthRateLimitAttempt[],
  ): void {
    for (let index = 1; index < subjects.length; index += 1) {
      const previous = subjects[index - 1]
      const current = subjects[index]
      if (
        previous !== undefined
        && current !== undefined
        && previous.scope === current.scope
        && previous.subjectKeyHash.equals(current.subjectKeyHash)
      ) {
        throw new AuthRateLimitInputError()
      }
    }
  }

  private compareSubjects(
    left: AuthRateLimitAttempt,
    right: AuthRateLimitAttempt,
  ): number {
    if (left.scope !== right.scope) {
      // 直接使用 ASCII/code-unit 顺序，不依赖实例的 ICU locale 配置。
      return left.scope < right.scope ? -1 : 1
    }
    return Buffer.compare(left.subjectKeyHash, right.subjectKeyHash)
  }

  private isValidBucketStartedAtKey(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 64
  }

  private createRateLimitedException(): ApiException {
    return new ApiException(
      HttpStatus.TOO_MANY_REQUESTS,
      'AUTH_RATE_LIMITED',
      '操作过于频繁，请稍后重试',
    )
  }
}
