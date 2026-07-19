import { HttpStatus, Injectable } from '@nestjs/common'

import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  AuthRateLimitScope,
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
import { AuthSessionService } from './auth-session.service'
import type { LoginInput, LoginResult } from './auth.types'
import {
  type AuthRateLimitReservation,
  AuthRateLimitService,
} from './providers/auth-rate-limit.service'
import { AuthSubjectHasher } from './providers/auth-subject-hasher'
import {
  AuthCapacityUnavailableError,
  PasswordProvider,
} from './providers/password.provider'
import { normalizeUsername } from './providers/username-normalizer'

const INVALID_CREDENTIALS_CODE = 'INVALID_CREDENTIALS'
const AUTH_STATE_CHANGED_CODE = 'AUTH_STATE_CHANGED'
const AUTH_SERVICE_UNAVAILABLE_CODE = 'AUTH_SERVICE_UNAVAILABLE'

type UserCredentialSnapshot = Readonly<{
  id: string
  username: string
  usernameNormalized: string
  displayName: string
  passwordHash: string
  status: UserStatusValue
  mustChangePassword: boolean
  authVersion: number
}>

type LockedUserRow = Readonly<{
  id: string
  username: string
  displayName: string
  passwordHash: string
  status: UserStatusValue
  mustChangePassword: boolean
  authVersion: number
  databaseNow: Date
}>

/**
 * 登录应用服务。
 *
 * 该边界只对外暴露稳定错误码；原始 SQL、PHC、username、IP 和密码
 * 都不会进入错误或 Audit metadata。成功登录的 User 更新、Session、限流
 * 预占释放和 Audit 位于同一 PostgreSQL 事务，任一步失败均不会留下
 * 未交付的 Session。
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionService,
    private readonly rateLimits: AuthRateLimitService,
    private readonly subjectHasher: AuthSubjectHasher,
    private readonly passwords: PasswordProvider,
    private readonly audit: AuditService,
    private readonly accessControl: AccessControlService,
    private readonly metrics: AuthMetricLogger = NOOP_AUTH_METRIC_LOGGER,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    let rateLimitReservation: AuthRateLimitReservation | undefined

    try {
      await this.assertBrowserIsAnonymous(input.existingSessionToken)

      const { usernameNormalized } = normalizeUsername(input.username)
      const usernameHash = this.subjectHasher.hashUsername(usernameNormalized)
      const sourceIpHash = this.subjectHasher.hashIp(input.sourceIp)

      // 两个桶在同一短事务中预占：任一桶已封禁时，另一桶的写入随事务回滚。
      // 预占提交后才进入 User 查询和 Argon2，事务不会跨昂贵计算持锁。
      rateLimitReservation = await this.rateLimits.reserveAttempts([
        {
          scope: AuthRateLimitScope.LOGIN_USERNAME,
          subjectKeyHash: usernameHash,
        },
        {
          scope: AuthRateLimitScope.LOGIN_IP,
          subjectKeyHash: sourceIpHash,
        },
      ])

      const user = await this.loadCredentialSnapshot(usernameNormalized)
      const passwordMatches = await this.verifyPassword(input.password, user)

      if (
        user === null
        || !passwordMatches
        || user.status !== UserStatus.ACTIVE
      ) {
        // 凭证失败保留预占计数；先清空本地引用，避免 catch 将其误释放。
        rateLimitReservation = undefined
        await this.recordInvalidCredentials(sourceIpHash, input.requestId)
        throw this.createInvalidCredentialsException()
      }

      const result = await this.createSuccessfulLogin(
        user,
        sourceIpHash,
        input.requestId,
        rateLimitReservation,
      )
      // 成功事务已经释放本次预占；后续指标异常也不得二次递减。
      rateLimitReservation = undefined
      // 事务提交后才记录登录与 Session 创建，避免 Audit/COMMIT 失败产生虚假成功指标。
      this.metrics.recordLogin('success')
      this.metrics.recordSession('created')
      return result
    }
    catch (caughtError) {
      let error = caughtError
      if (rateLimitReservation !== undefined) {
        try {
          // Argon2 capacity、Prisma、权限读取或状态竞争都不是凭证失败。
          await this.rateLimits.releaseReservation(rateLimitReservation)
        } catch (releaseError) {
          error = releaseError
        }
      }

      this.metrics.recordLogin(
        error instanceof ApiException && error.code === 'AUTH_RATE_LIMITED'
          ? 'rate_limited'
          : 'failure',
      )

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

      // 所有 provider/Prisma/Audit 原始错误都在这个边界终止。
      throw this.createServiceUnavailableException()
    }
  }

  private async assertBrowserIsAnonymous(
    existingSessionToken: string | undefined,
  ): Promise<void> {
    if (existingSessionToken === undefined || existingSessionToken.length === 0) {
      return
    }

    const existingSession = await this.sessions.validateWithoutTouch(
      existingSessionToken,
    )
    if (existingSession !== null) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'ALREADY_AUTHENTICATED',
        '当前浏览器已登录，请先退出当前账号',
      )
    }
  }

  private loadCredentialSnapshot(
    usernameNormalized: string,
  ): Promise<UserCredentialSnapshot | null> {
    return this.prisma.user.findUnique({
      where: { usernameNormalized },
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

  private verifyPassword(
    password: string,
    user: UserCredentialSnapshot | null,
  ): Promise<boolean> {
    if (user === null) {
      return this.passwords.verifyWithDummyHash(password)
    }

    // DISABLED 用户也走真实 Hash verify，避免从工作量区分账号状态。
    return this.passwords.verify(password, user.passwordHash)
  }

  private async recordInvalidCredentials(
    sourceIpHash: Buffer,
    requestId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      // 必须是 callback 内第一项数据库操作，约束失败审计的锁等待和语句耗时。
      await applyTransactionTimeouts(transaction)
      await this.audit.record(transaction, {
        eventType: AuditEventType.AUTH_LOGIN_FAILED,
        outcome: AuditOutcome.FAILURE,
        actorType: AuditActorType.ANONYMOUS,
        requestId,
        reasonCode: INVALID_CREDENTIALS_CODE,
        sourceIpHash,
      })
    })
  }

  private async createSuccessfulLogin(
    snapshot: UserCredentialSnapshot,
    sourceIpHash: Buffer,
    requestId: string,
    rateLimitReservation: AuthRateLimitReservation,
  ): Promise<LoginResult> {
    return this.prisma.$transaction(async (transaction) => {
      // 必须先设置 transaction-local 超时，再读取或锁定任何业务数据。
      await applyTransactionTimeouts(transaction)
      const rows = await transaction.$queryRaw<LockedUserRow[]>(Prisma.sql`
        SELECT
          "id",
          "username",
          "display_name" AS "displayName",
          "password_hash" AS "passwordHash",
          "status",
          "must_change_password" AS "mustChangePassword",
          "auth_version" AS "authVersion",
          clock_timestamp() AS "databaseNow"
        FROM "users"
        WHERE "id" = CAST(${snapshot.id} AS uuid)
        FOR UPDATE
      `)
      const lockedUser = rows[0]

      if (!this.matchesVerifiedSnapshot(snapshot, lockedUser)) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          AUTH_STATE_CHANGED_CODE,
          '认证状态已变化，请重试',
        )
      }

      if (!this.isValidDatabaseDate(lockedUser.databaseNow)) {
        throw new Error('Invalid database clock result')
      }

      // 权限与 User/Session 写入共享事务；读取失败会回滚整次登录，不留下客户端
      // 无法取得 Cookie 的孤立 Session，响应也与该次数据库状态保持一致。
      const permissions = await this.readPermissionsInTransaction(
        transaction,
        lockedUser.id,
      )

      await transaction.user.update({
        where: { id: lockedUser.id },
        data: { lastLoginAt: lockedUser.databaseNow },
      })

      const issuedSession = await this.sessions.createInTransaction(
        transaction,
        {
          id: lockedUser.id,
          authVersion: lockedUser.authVersion,
          username: lockedUser.username,
          displayName: lockedUser.displayName,
          mustChangePassword: lockedUser.mustChangePassword,
        },
      )

      // 只释放当前成功请求自己的预占，不清除并发请求已经形成的真实失败计数。
      await this.rateLimits.releaseReservationInTransaction(
        transaction,
        rateLimitReservation,
      )

      await this.audit.record(transaction, {
        eventType: AuditEventType.AUTH_LOGIN_SUCCEEDED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: lockedUser.id,
        targetType: 'User',
        targetId: lockedUser.id,
        requestId,
        sourceIpHash,
      })

      return { issuedSession, permissions }
    })
  }

  private matchesVerifiedSnapshot(
    snapshot: UserCredentialSnapshot,
    lockedUser: LockedUserRow | undefined,
  ): lockedUser is LockedUserRow {
    return (
      lockedUser !== undefined
      && lockedUser.passwordHash === snapshot.passwordHash
      && lockedUser.authVersion === snapshot.authVersion
      && lockedUser.status === snapshot.status
      && lockedUser.status === UserStatus.ACTIVE
    )
  }

  private async readPermissionsInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<string[]> {
    try {
      return await this.accessControl.getPermissionCodesInTransaction(
        transaction,
        userId,
      )
    } catch {
      // AccessControl 的内部错误统一收口为认证链路的暂时不可用契约。
      throw this.createServiceUnavailableException()
    }
  }

  private isValidDatabaseDate(value: unknown): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime())
  }

  private createInvalidCredentialsException(): ApiException {
    return new ApiException(
      HttpStatus.UNAUTHORIZED,
      INVALID_CREDENTIALS_CODE,
      '用户名或密码错误',
    )
  }

  private createServiceUnavailableException(): ApiException {
    return new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      AUTH_SERVICE_UNAVAILABLE_CODE,
      '认证服务暂时不可用',
    )
  }
}
