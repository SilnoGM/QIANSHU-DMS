import { HttpStatus, Injectable } from '@nestjs/common'

import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  AuthRateLimitScope,
  SessionRevokedReason,
  UserStatus,
  type UserStatus as UserStatusValue,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  AuthMetricLogger,
  NOOP_AUTH_METRIC_LOGGER,
} from '../../infrastructure/observability/auth-metric.logger'
import type { RequestAuthContext } from './auth-context'
import { AuthSessionService } from './auth-session.service'
import type { LoginResult } from './auth.types'
import {
  type AuthRateLimitReservation,
  AuthRateLimitService,
} from './providers/auth-rate-limit.service'
import { AuthSubjectHasher } from './providers/auth-subject-hasher'
import { PasswordPolicyProvider } from './providers/password-policy.provider'
import {
  AuthCapacityUnavailableError,
  PasswordProvider,
} from './providers/password.provider'

type UserPasswordSnapshot = Readonly<{
  authVersion: number
  displayName: string
  id: string
  mustChangePassword: boolean
  passwordHash: string
  status: UserStatusValue
  username: string
  usernameNormalized: string
}>

type LockedSessionRow = Readonly<{
  absoluteExpiresAt: Date
  authVersion: number
  idleExpiresAt: Date
  revokedAt: Date | null
  userId: string
}>

type DatabaseClockRow = Readonly<{ now: Date }>

type PasswordRotationResult = Readonly<{
  loginResult: LoginResult
  revokedSessionCount: number
}>

export interface PasswordChangeInput {
  auth: RequestAuthContext
  currentPassword?: string
  newPassword: string
  requestId: string
  sourceIp: string
}

/**
 * 用户主动改密流程。
 *
 * 正常模式验证当前密码；强制改密模式只依赖已经通过 Guard 的受限 Session。
 * 正确凭证的限流预占先由独立短事务单次释放，随后 User 更新、旧 Session 吊销、
 * 新 Session 创建和 Audit 同事务提交。
 */
@Injectable()
export class PasswordChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionService,
    private readonly rateLimits: AuthRateLimitService,
    private readonly subjectHasher: AuthSubjectHasher,
    private readonly passwords: PasswordProvider,
    private readonly passwordPolicy: PasswordPolicyProvider,
    private readonly audit: AuditService,
    private readonly accessControl: AccessControlService,
    private readonly metrics: AuthMetricLogger = NOOP_AUTH_METRIC_LOGGER,
  ) {}

  async change(input: PasswordChangeInput): Promise<LoginResult> {
    let rateLimitReservation: AuthRateLimitReservation | undefined

    try {
      const snapshot = await this.loadSnapshot(input.auth.userId)
      if (
        snapshot === null ||
        snapshot.status !== UserStatus.ACTIVE ||
        snapshot.mustChangePassword !== input.auth.mustChangePassword
      ) {
        throw this.createAuthStateChangedException()
      }

      const userHash = this.subjectHasher.hashUserId(snapshot.id)
      const sourceIpHash = this.subjectHasher.hashIp(input.sourceIp)

      if (!snapshot.mustChangePassword) {
        rateLimitReservation = await this.rateLimits.reserveAttempts([
          {
            scope: AuthRateLimitScope.PASSWORD_CHANGE_USER,
            subjectKeyHash: userHash,
          },
          {
            scope: AuthRateLimitScope.PASSWORD_CHANGE_IP,
            subjectKeyHash: sourceIpHash,
          },
        ])

        const currentPasswordMatches =
          input.currentPassword !== undefined
          && (await this.passwords.verify(
            input.currentPassword,
            snapshot.passwordHash,
          ))
        if (!currentPasswordMatches) {
          // 当前密码错误就是应保留的失败；不能由统一 catch 释放本次预占。
          rateLimitReservation = undefined
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'CURRENT_PASSWORD_INVALID',
            '当前密码错误',
            { currentPassword: ['当前密码错误'] },
          )
        }

        // 当前密码正确后不再占用失败额度。await 前先清空本地引用，确保释放事务
        // 的 COMMIT 结果未知时 fail-closed，绝不重试并误减其他失败计数。
        const verifiedReservation = rateLimitReservation
        rateLimitReservation = undefined
        await this.rateLimits.releaseReservation(verifiedReservation)
      }

      const normalizedNewPassword = this.passwordPolicy.assertAcceptable({
        password: input.newPassword,
        fieldName: 'newPassword',
      })
      const matchesCurrentPassword = await this.passwords.verify(
        normalizedNewPassword,
        snapshot.passwordHash,
      )
      if (matchesCurrentPassword) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'PASSWORD_MUST_DIFFER',
          '新密码必须与当前密码不同',
          { newPassword: ['新密码必须与当前密码不同'] },
        )
      }

      const newPasswordHash = await this.passwords.hash(normalizedNewPassword)

      const rotation = await this.rotatePasswordAndSession(
        input,
        snapshot,
        newPasswordHash,
        sourceIpHash,
      )
      // 事务提交后再记录业务成功、旧 Session 撤销和新 Session 创建。
      this.metrics.recordPassword('change', 'success')
      this.metrics.recordSessionRevoked(rotation.revokedSessionCount)
      this.metrics.recordSession('created')
      return rotation.loginResult
    } catch (caughtError) {
      let error = caughtError
      if (rateLimitReservation !== undefined) {
        try {
          // 新密码校验、Argon2 capacity、数据库或状态竞争均非当前凭证失败。
          await this.rateLimits.releaseReservation(rateLimitReservation)
        } catch (releaseError) {
          error = releaseError
        }
      }

      this.metrics.recordPassword('change', 'failure')

      if (error instanceof ApiException) {
        throw error
      }
      if (error instanceof AuthCapacityUnavailableError) {
        throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'AUTH_CAPACITY_UNAVAILABLE',
          '认证服务繁忙，请稍后重试',
        )
      }

      // 原始 Prisma、Argon2、审计或配置错误都不得穿透认证边界。
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AUTH_SERVICE_UNAVAILABLE',
        '认证服务暂时不可用',
      )
    }
  }

  private loadSnapshot(userId: string): Promise<UserPasswordSnapshot | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        usernameNormalized: true,
        displayName: true,
        passwordHash: true,
        status: true,
        mustChangePassword: true,
        authVersion: true,
      },
    })
  }

  private async rotatePasswordAndSession(
    input: PasswordChangeInput,
    snapshot: UserPasswordSnapshot,
    newPasswordHash: string,
    sourceIpHash: Buffer,
  ): Promise<PasswordRotationResult> {
    return this.prisma.$transaction(async (transaction) => {
      // 必须先设置 transaction-local 超时，再按 User -> Session 顺序取得行锁。
      await applyTransactionTimeouts(transaction)
      // 固定先锁 User，再锁当前 Session；login/password-reset 同样先竞争 User 锁。
      const lockedUsers = await transaction.$queryRaw<UserPasswordSnapshot[]>(
        Prisma.sql`
          SELECT
            "id",
            "username",
            "username_normalized" AS "usernameNormalized",
            "display_name" AS "displayName",
            "password_hash" AS "passwordHash",
            "status",
            "must_change_password" AS "mustChangePassword",
            "auth_version" AS "authVersion"
          FROM "users"
          WHERE "id" = CAST(${snapshot.id} AS uuid)
          FOR UPDATE
        `,
      )
      const lockedUser = lockedUsers[0]
      if (!this.matchesSnapshot(snapshot, lockedUser)) {
        throw this.createAuthStateChangedException()
      }

      const lockedSessions = await transaction.$queryRaw<LockedSessionRow[]>(
        Prisma.sql`
          SELECT
            "user_id" AS "userId",
            "auth_version" AS "authVersion",
            "idle_expires_at" AS "idleExpiresAt",
            "absolute_expires_at" AS "absoluteExpiresAt",
            "revoked_at" AS "revokedAt"
          FROM "auth_sessions"
          WHERE "id" = CAST(${input.auth.sessionId} AS uuid)
          FOR UPDATE
        `,
      )
      const clockRows = await transaction.$queryRaw<DatabaseClockRow[]>(
        Prisma.sql`SELECT clock_timestamp() AS "now"`,
      )
      const databaseNow = clockRows[0]?.now
      const lockedSession = lockedSessions[0]

      if (
        !this.isValidDatabaseDate(databaseNow) ||
        !this.isCurrentSessionValid(lockedSession, lockedUser, databaseNow)
      ) {
        throw this.createAuthStateChangedException()
      }

      let permissions: string[]
      try {
        permissions =
          await this.accessControl.getPermissionCodesInTransaction(
            transaction,
            lockedUser.id,
          )
      } catch {
        throw new Error('Permission read failed')
      }

      const updatedUser = await transaction.user.update({
        where: { id: lockedUser.id },
        data: {
          passwordHash: newPasswordHash,
          passwordChangedAt: databaseNow,
          mustChangePassword: false,
          authVersion: { increment: 1 },
        },
      })

      const revokedSessionCount = await this.sessions.revokeAllForUserInTransaction(
        transaction,
        lockedUser.id,
        SessionRevokedReason.PASSWORD_CHANGED,
      )
      const issuedSession = await this.sessions.createInTransaction(
        transaction,
        {
          id: updatedUser.id,
          username: updatedUser.username,
          displayName: updatedUser.displayName,
          mustChangePassword: false,
          authVersion: updatedUser.authVersion,
        },
      )

      await this.audit.record(transaction, {
        eventType: AuditEventType.USER_PASSWORD_CHANGED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: lockedUser.id,
        targetType: 'User',
        targetId: lockedUser.id,
        requestId: input.requestId,
        sourceIpHash,
      })

      return {
        loginResult: { issuedSession, permissions },
        revokedSessionCount,
      }
    })
  }

  private matchesSnapshot(
    snapshot: UserPasswordSnapshot,
    lockedUser: UserPasswordSnapshot | undefined,
  ): lockedUser is UserPasswordSnapshot {
    return (
      lockedUser !== undefined &&
      lockedUser.passwordHash === snapshot.passwordHash &&
      lockedUser.authVersion === snapshot.authVersion &&
      lockedUser.mustChangePassword === snapshot.mustChangePassword &&
      lockedUser.status === UserStatus.ACTIVE
    )
  }

  private isCurrentSessionValid(
    session: LockedSessionRow | undefined,
    user: UserPasswordSnapshot,
    databaseNow: Date,
  ): session is LockedSessionRow {
    return (
      session !== undefined &&
      session.userId === user.id &&
      session.authVersion === user.authVersion &&
      session.revokedAt === null &&
      this.isValidDatabaseDate(session.idleExpiresAt) &&
      this.isValidDatabaseDate(session.absoluteExpiresAt) &&
      databaseNow.getTime() < session.idleExpiresAt.getTime() &&
      databaseNow.getTime() < session.absoluteExpiresAt.getTime()
    )
  }

  private isValidDatabaseDate(value: unknown): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime())
  }

  private createAuthStateChangedException(): ApiException {
    return new ApiException(
      HttpStatus.CONFLICT,
      'AUTH_STATE_CHANGED',
      '认证状态已变化，请重试',
    )
  }
}
