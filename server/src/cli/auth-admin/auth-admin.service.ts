import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { SYSTEM_ADMIN_ROLE_CODE } from '../../modules/access-control/permission.constants'
import { AuditService } from '../../modules/audit/audit.service'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  Prisma,
  SessionRevokedReason,
  UserStatus,
  type UserStatus as UserStatusValue,
} from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  AuthMetricLogger,
  NOOP_AUTH_METRIC_LOGGER,
} from '../../infrastructure/observability/auth-metric.logger'
import { PasswordPolicyProvider } from '../../modules/auth/providers/password-policy.provider'
import {
  AuthCapacityUnavailableError,
  PasswordPolicyViolationError,
  PasswordProvider,
} from '../../modules/auth/providers/password.provider'
import { normalizeUsername } from '../../modules/auth/providers/username-normalizer'
import {
  lockSystemAdminRole,
  lockUsers,
  readDatabaseNow,
} from '../../modules/users/users.persistence'

export type AuthAdminOperationErrorCode =
  | 'AUTH_CAPACITY_UNAVAILABLE'
  | 'INTERACTIVE_TTY_REQUIRED'
  | 'PASSWORD_CONFIRMATION_MISMATCH'
  | 'PASSWORD_POLICY_VIOLATION'
  | 'SYSTEM_ADMIN_ALREADY_BOOTSTRAPPED'
  | 'SYSTEM_ADMIN_OPERATION_FAILED'
  | 'SYSTEM_ADMIN_RECOVERY_TARGET_INVALID'
  | 'USERNAME_ALREADY_EXISTS'
  | 'VALIDATION_FAILED'

/** CLI 边界只允许固定错误码和固定安全文案，底层驱动异常绝不向终端透传。 */
export class AuthAdminOperationError extends Error {
  constructor(
    readonly code: AuthAdminOperationErrorCode,
    safeMessage: string,
  ) {
    super(safeMessage)
    this.name = 'AuthAdminOperationError'
  }
}

export interface BootstrapAdminInput {
  username: string
  displayName: string
  password: string
}

export interface RecoverAdminInput {
  username: string
  password: string
  enableDisabled: boolean
}

export interface RecoveryTarget {
  userId: string
  status: UserStatusValue
}

interface RecoverySnapshot extends RecoveryTarget {
  username: string
  usernameNormalized: string
}

const BOOTSTRAP_LOCK_NAMESPACE = 1_901_070_611
const BOOTSTRAP_LOCK_OPERATION = 1
const MAX_IDENTITY_CODE_POINTS = 128

/**
 * system_admin 的本机初始化与离线恢复服务。
 *
 * Argon2 在事务外执行，避免慢 Hash 占用数据库锁；事务内再用 Role/User 锁复查授权
 * 关系，并把凭证写入、Session 吊销和 Audit 一次提交。
 */
@Injectable()
export class AuthAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordProvider,
    private readonly passwordPolicy: PasswordPolicyProvider,
    private readonly audit: AuditService,
    private readonly metrics: AuthMetricLogger = NOOP_AUTH_METRIC_LOGGER,
  ) {}

  async bootstrap(input: BootstrapAdminInput): Promise<{ userId: string }> {
    try {
      const identity = this.normalizeIdentity(input.username, input.displayName)
      const acceptedPassword = this.passwordPolicy.assertAcceptable({
        password: input.password,
        username: identity.username,
        usernameNormalized: identity.usernameNormalized,
      })
      const passwordHash = await this.passwords.hash(acceptedPassword)
      const requestId = this.createCliRequestId()

      const result = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)

        // 固定双 int4 advisory key 只串行化本操作，不阻塞其他无关事务。
        await transaction.$queryRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(
            CAST(${BOOTSTRAP_LOCK_NAMESPACE} AS integer),
            CAST(${BOOTSTRAP_LOCK_OPERATION} AS integer)
          )
        `)
        const systemAdminRole = await lockSystemAdminRole(transaction)
        const existingMembership = await transaction.userRole.findFirst({
          where: { roleId: systemAdminRole.id },
          select: { userId: true },
        })
        if (existingMembership !== null) {
          throw new AuthAdminOperationError(
            'SYSTEM_ADMIN_ALREADY_BOOTSTRAPPED',
            'system_admin 已完成初始化',
          )
        }

        const databaseNow = await readDatabaseNow(transaction)
        const user = await transaction.user.create({
          data: {
            username: identity.username,
            usernameNormalized: identity.usernameNormalized,
            displayName: identity.displayName,
            passwordHash,
            status: UserStatus.ACTIVE,
            mustChangePassword: false,
            passwordChangedAt: databaseNow,
            authVersion: 0,
            lastLoginAt: null,
            createdByUserId: null,
          },
          select: { id: true },
        })
        await transaction.userRole.create({
          data: { userId: user.id, roleId: systemAdminRole.id },
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.SYSTEM_BOOTSTRAP,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.SYSTEM,
          targetType: 'User',
          targetId: user.id,
          requestId,
        })

        return { userId: user.id }
      })
      this.metrics.recordPassword('create', 'success')
      return result
    }
    catch (error) {
      this.metrics.recordPassword('create', 'failure')
      throw this.toSafeOperationError(error)
    }
  }

  async inspectRecoveryTarget(username: string): Promise<RecoveryTarget> {
    try {
      const target = await this.loadRecoverySnapshot(username)
      return { userId: target.userId, status: target.status }
    }
    catch (error) {
      throw this.toSafeOperationError(error)
    }
  }

  async recover(
    input: RecoverAdminInput,
  ): Promise<{ userId: string; enabled: boolean }> {
    try {
      const snapshot = await this.loadRecoverySnapshot(input.username)
      const acceptedPassword = this.passwordPolicy.assertAcceptable({
        password: input.password,
        username: snapshot.username,
        usernameNormalized: snapshot.usernameNormalized,
      })
      const passwordHash = await this.passwords.hash(acceptedPassword)
      const requestId = this.createCliRequestId()

      let revokedSessionCount = 0
      const result = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)

        // 与在线 UserRole 写路径保持 Role -> User 顺序，防止关系移除与恢复交错提交。
        const systemAdminRole = await lockSystemAdminRole(transaction)
        const lockedUsers = await lockUsers(transaction, [snapshot.userId])
        const lockedUser = lockedUsers.get(snapshot.userId)
        const membership = await transaction.userRole.findUnique({
          where: {
            userId_roleId: {
              userId: snapshot.userId,
              roleId: systemAdminRole.id,
            },
          },
          select: { userId: true, roleId: true },
        })
        if (lockedUser === undefined || membership === null) {
          throw this.invalidRecoveryTarget()
        }

        const databaseNow = await readDatabaseNow(transaction)
        const enablesDisabledUser =
          lockedUser.status === UserStatus.DISABLED && input.enableDisabled
        await transaction.user.update({
          where: { id: lockedUser.id },
          data: {
            passwordHash,
            passwordChangedAt: databaseNow,
            mustChangePassword: false,
            authVersion: { increment: 1 },
            ...(enablesDisabledUser
              ? {
                  status: UserStatus.ACTIVE,
                  disabledAt: null,
                  disabledByUserId: null,
                }
              : {}),
          },
          select: { id: true },
        })
        const revoked = await transaction.authSession.updateMany({
          where: { userId: lockedUser.id, revokedAt: null },
          data: {
            revokedAt: databaseNow,
            revokedReason: SessionRevokedReason.ADMIN_RECOVERY,
          },
        })
        revokedSessionCount = revoked.count
        await this.audit.record(transaction, {
          eventType: AuditEventType.SYSTEM_ADMIN_RECOVERED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.SYSTEM,
          targetType: 'User',
          targetId: lockedUser.id,
          requestId,
          metadata: { enabledDisabledUser: enablesDisabledUser },
        })

        return { userId: lockedUser.id, enabled: enablesDisabledUser }
      })
      this.metrics.recordPassword('reset', 'success')
      this.metrics.recordSessionRevoked(revokedSessionCount)
      return result
    }
    catch (error) {
      this.metrics.recordPassword('reset', 'failure')
      throw this.toSafeOperationError(error)
    }
  }

  private async loadRecoverySnapshot(
    usernameInput: string,
  ): Promise<RecoverySnapshot> {
    const normalized = normalizeUsername(usernameInput)
    this.assertIdentityValue('username', normalized.username)

    const user = await this.prisma.user.findUnique({
      where: { usernameNormalized: normalized.usernameNormalized },
      select: {
        id: true,
        username: true,
        usernameNormalized: true,
        status: true,
        roles: {
          where: { role: { code: SYSTEM_ADMIN_ROLE_CODE } },
          select: { roleId: true },
          take: 1,
        },
      },
    })
    if (user === null || user.roles.length === 0) {
      throw this.invalidRecoveryTarget()
    }

    return {
      userId: user.id,
      username: user.username,
      usernameNormalized: user.usernameNormalized,
      status: user.status,
    }
  }

  private normalizeIdentity(
    usernameInput: string,
    displayNameInput: string,
  ): { username: string; usernameNormalized: string; displayName: string } {
    const username = normalizeUsername(usernameInput)
    const displayName = displayNameInput.normalize('NFC').trim()
    this.assertIdentityValue('username', username.username)
    this.assertIdentityValue('username', username.usernameNormalized)
    this.assertIdentityValue('displayName', displayName)

    return { ...username, displayName }
  }

  private assertIdentityValue(
    field: 'username' | 'displayName',
    value: string,
  ): void {
    const length = Array.from(value).length
    if (length < 1 || length > MAX_IDENTITY_CODE_POINTS) {
      throw new AuthAdminOperationError(
        'VALIDATION_FAILED',
        field === 'username'
          ? '用户名不能为空且不能超过 128 个字符'
          : '展示名称不能为空且不能超过 128 个字符',
      )
    }
  }

  private invalidRecoveryTarget(): AuthAdminOperationError {
    return new AuthAdminOperationError(
      'SYSTEM_ADMIN_RECOVERY_TARGET_INVALID',
      '恢复目标不是有效的 system_admin 用户',
    )
  }

  private createCliRequestId(): string {
    return `cli:${randomUUID()}`
  }

  private toSafeOperationError(error: unknown): AuthAdminOperationError {
    if (error instanceof AuthAdminOperationError) {
      return error
    }
    if (error instanceof AuthCapacityUnavailableError) {
      return new AuthAdminOperationError(
        'AUTH_CAPACITY_UNAVAILABLE',
        '认证服务繁忙，请稍后重试',
      )
    }
    if (
      error instanceof PasswordPolicyViolationError
      || (error instanceof ApiException
        && error.code === 'PASSWORD_POLICY_VIOLATION')
    ) {
      return new AuthAdminOperationError(
        'PASSWORD_POLICY_VIOLATION',
        '密码不符合要求',
      )
    }
    if (this.isPrismaError(error, 'P2002')) {
      return new AuthAdminOperationError(
        'USERNAME_ALREADY_EXISTS',
        '用户名已存在',
      )
    }

    return new AuthAdminOperationError(
      'SYSTEM_ADMIN_OPERATION_FAILED',
      '系统管理员操作失败',
    )
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === code
    )
  }
}
