import { HttpStatus, Injectable } from '@nestjs/common'

import { SYSTEM_ADMIN_ROLE_CODE } from '../access-control/permission.constants'
import { AccessControlService } from '../access-control/access-control.service'
import { AuditService } from '../audit/audit.service'
import type { Prisma, UserStatus as UserStatusValue } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  SessionRevokedReason,
  UserStatus,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  AuthMetricLogger,
  NOOP_AUTH_METRIC_LOGGER,
} from '../../infrastructure/observability/auth-metric.logger'
import { PasswordPolicyProvider } from '../auth/providers/password-policy.provider'
import {
  AuthCapacityUnavailableError,
  PasswordPolicyViolationError,
  PasswordProvider,
} from '../auth/providers/password.provider'
import { normalizeUsername } from '../auth/providers/username-normalizer'
import { normalizeFundShareRateInput } from '../fund-accounts/application/fund-input.normalizer'
import { createUserFundAccountInTransaction } from '../fund-accounts/application/fund-account-provisioning'
import { FundPostingError } from '../fund-accounts/application/fund-posting.errors'
import { mapFundHttpError } from '../fund-accounts/fund-http-error.mapper'
import { UserProfileService } from '../profile/user-profile.service'
import { createChangedFields } from '../profile/user-profile.normalizer'
import type {
  CreateUserFundAccountRequestDto,
  CreateUserRequestDto,
} from './dto/create-user-request.dto'
import type { PasswordResetRequestDto } from './dto/password-reset-request.dto'
import type { ReplaceUserRolesRequestDto } from './dto/replace-user-roles-request.dto'
import type { UpdateUserRequestDto } from './dto/update-user-request.dto'
import type { UserListQueryDto } from './dto/user-list-query.dto'
import type { UserDto, UserPageDto } from './dto/user-response.dto'
import {
  findUserResponse,
  lockRoles,
  lockSession,
  lockSystemAdminRole,
  lockUsers,
  normalizeUuid,
  readDatabaseNow,
  toUserDto,
  USER_RESPONSE_SELECT,
  type LockedSessionRow,
  type LockedUserRow,
} from './users.persistence'

const USER_NOT_FOUND_CODE = 'USER_NOT_FOUND'
const ROLE_NOT_FOUND_CODE = 'ROLE_NOT_FOUND'
const USERNAME_ALREADY_EXISTS_CODE = 'USERNAME_ALREADY_EXISTS'
const AUTH_STATE_CHANGED_CODE = 'AUTH_STATE_CHANGED'
const LAST_SYSTEM_ADMIN_REQUIRED_CODE = 'LAST_SYSTEM_ADMIN_REQUIRED'
const SELF_PASSWORD_RESET_NOT_ALLOWED_CODE =
  'SELF_PASSWORD_RESET_NOT_ALLOWED'
const INTERNAL_ERROR_CODE = 'INTERNAL_ERROR'
const FUND_ACCOUNT_CREATE_PERMISSION = 'fund-accounts:create'
const ADMIN_PROFILE_UPDATE_FIELDS = [
  'email',
  'mobileE164',
  'avatarUrl',
  'remark',
] as const

type PasswordResetSnapshot = Readonly<{
  authVersion: number
  id: string
  passwordHash: string
  status: UserStatusValue
  username: string
  usernameNormalized: string
}>

type RoleReplacementSnapshot = Readonly<{
  id: string
  roleIds: string[]
}>

export interface UsersCommandContext {
  /** 来自 AuthenticationGuard 的可信 User id。 */
  actorUserId: string
  /** 重置密码时必须在事务内重新验证的当前 Session id。 */
  actorSessionId: string
  requestId: string
}

function normalizeUsersCommandContext(
  context: UsersCommandContext,
): UsersCommandContext {
  return {
    ...context,
    actorUserId: normalizeUuid(context.actorUserId),
    actorSessionId: normalizeUuid(context.actorSessionId),
  }
}

/**
 * User 管理应用服务。
 *
 * 密码 Hash 在事务外完成，进入事务后必须通过 User/AuthSession 快照复查避免覆盖
 * 并发认证状态；可能减少 active system_admin 的路径则先锁排序后的 Role，再锁
 * 排序后的 User。所有成功 Audit 与业务写入共享同一个 PostgreSQL 事务。
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordProvider,
    private readonly passwordPolicy: PasswordPolicyProvider,
    private readonly audit: AuditService,
    private readonly userProfiles: UserProfileService,
    private readonly access: AccessControlService,
    private readonly metrics: AuthMetricLogger = NOOP_AUTH_METRIC_LOGGER,
  ) {}

  async list(query: UserListQueryDto): Promise<UserPageDto> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    // count 与 findMany 必须复用同一个过滤对象，保证总数和当前页使用同一查询口径。
    const where: Prisma.UserWhereInput = {}
    if (query.username !== undefined) {
      where.usernameNormalized =
        normalizeUsername(query.username).usernameNormalized
    }
    if (query.status !== undefined) {
      where.status = query.status
    }

    try {
      const [total, users] = await Promise.all([
        this.prisma.user.count({ where }),
        this.prisma.user.findMany({
          where,
          select: USER_RESPONSE_SELECT,
          orderBy: [{ usernameNormalized: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ])

      return {
        items: users.map((user) => toUserDto(user)),
        page,
        pageSize,
        total,
      }
    }
    catch (error) {
      this.rethrowKnownError(error)
    }
  }

  async getById(userId: string): Promise<UserDto> {
    const normalizedUserId = normalizeUuid(userId)

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: normalizedUserId },
        select: USER_RESPONSE_SELECT,
      })

      if (!user) {
        throw this.userNotFound()
      }

      return toUserDto(user)
    }
    catch (error) {
      this.rethrowKnownError(error)
    }
  }

  async create(
    context: UsersCommandContext,
    input: CreateUserRequestDto,
  ): Promise<UserDto> {
    try {
      const normalizedContext = normalizeUsersCommandContext(context)
      const normalizedUsername = normalizeUsername(input.username)
      this.assertValidUsername(normalizedUsername)
      const displayName = this.normalizeDisplayName(input.displayName)
      // 比例规范化与权限检查放在密码哈希之前，非法开户请求不消耗 Argon2。
      const userShareRate = await this.resolveNewUserFundAccount(
        normalizedContext,
        input.fundAccount,
      )
      const acceptedPassword = this.passwordPolicy.assertAcceptable({
        password: input.password,
        fieldName: 'password',
      })
      const passwordHash = await this.passwords.hash(acceptedPassword)

      const createdUser = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const databaseNow = await readDatabaseNow(transaction)
        const created = await transaction.user.create({
          data: {
            username: normalizedUsername.username,
            usernameNormalized: normalizedUsername.usernameNormalized,
            displayName,
            passwordHash,
            status: UserStatus.ACTIVE,
            mustChangePassword: input.mustChangePassword,
            passwordChangedAt: databaseNow,
            authVersion: 0,
            lastLoginAt: null,
            createdByUserId: normalizedContext.actorUserId,
            profile: { create: {} },
          },
          select: USER_RESPONSE_SELECT,
        })

        await this.audit.record(transaction, {
          eventType: AuditEventType.USER_CREATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: normalizedContext.actorUserId,
          targetType: 'User',
          targetId: created.id,
          requestId: normalizedContext.requestId,
        })

        if (userShareRate !== undefined) {
          // 与用户创建共用同一个 transaction；账户或审计失败会连同 User 一起回滚。
          await createUserFundAccountInTransaction(transaction, this.audit, {
            userId: created.id,
            userShareRate,
            actorUserId: normalizedContext.actorUserId,
            requestId: normalizedContext.requestId,
          })
        }

        return toUserDto(created)
      })
      this.metrics.recordPassword('create', 'success')
      return createdUser
    }
    catch (error) {
      this.metrics.recordPassword('create', 'failure')
      // 资金域错误必须先于通用 P2002 分支处理，避免账户唯一冲突被误报成用户名重复。
      if (error instanceof FundPostingError) {
        throw mapFundHttpError(error)
      }
      if (this.isPrismaError(error, 'P2002')) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          USERNAME_ALREADY_EXISTS_CODE,
          '用户名已存在',
        )
      }
      this.rethrowKnownError(error)
    }
  }

  async update(
    context: UsersCommandContext,
    userId: string,
    input: UpdateUserRequestDto,
  ): Promise<UserDto> {
    const normalizedContext = normalizeUsersCommandContext(context)
    const normalizedUserId = normalizeUuid(userId)
    // ValidationPipe 开启 transform 后，class field 会把未提交字段也实例化为
    // 值为 undefined 的 own property；这里只把 own 且非 undefined 视为真实输入。
    // null 仍需保留给后续校验，以免吞掉客户端显式提交的非法值。
    const updatesDisplayName = Object.hasOwn(input, 'displayName')
      && input.displayName !== undefined
    const profileInput: Record<string, unknown> = {}
    for (const field of ADMIN_PROFILE_UPDATE_FIELDS) {
      if (Object.hasOwn(input, field) && input[field] !== undefined) {
        profileInput[field] = input[field]
      }
    }
    const profileFields = Object.keys(profileInput)

    if (!updatesDisplayName && profileFields.length === 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        '请求参数校验失败',
      )
    }

    const displayName = updatesDisplayName
      ? this.normalizeDisplayName(input.displayName)
      : undefined

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        // 先锁 User，既能稳定区分 USER_NOT_FOUND，也能防止 Profile-only 更新与
        // 并发 User 删除交错后被误判为 Profile 不变量损坏。
        const lockedUsers = await lockUsers(transaction, [normalizedUserId])
        if (!lockedUsers.has(normalizedUserId)) {
          throw this.userNotFound()
        }

        if (displayName !== undefined) {
          await transaction.user.update({
            where: { id: normalizedUserId },
            data: { displayName },
            select: { id: true },
          })
        }

        const changedFields = displayName === undefined
          ? []
          : ['displayName']
        if (profileFields.length > 0) {
          const profileUpdate = await this.userProfiles.updateInTransaction(
            transaction,
            normalizedUserId,
            profileInput,
            { allowRemark: true },
          )
          changedFields.push(
            ...profileUpdate.changedFields.split(',').filter(Boolean),
          )
        }

        const updated = await this.readUserInTransaction(
          transaction,
          normalizedUserId,
        )
        await this.audit.record(transaction, {
          eventType: AuditEventType.USER_UPDATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: normalizedContext.actorUserId,
          targetType: 'User',
          targetId: normalizedUserId,
          requestId: normalizedContext.requestId,
          // Audit 只能保留排序后的稳定字段名，不能包含任何资料值。
          metadata: { changedFields: createChangedFields(changedFields) },
        })

        return updated
      })
    }
    catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw this.userNotFound()
      }
      this.rethrowKnownError(error)
    }
  }

  async enable(
    context: UsersCommandContext,
    userId: string,
  ): Promise<UserDto> {
    const normalizedContext = normalizeUsersCommandContext(context)
    const normalizedUserId = normalizeUuid(userId)

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const lockedUsers = await lockUsers(transaction, [normalizedUserId])
        const target = lockedUsers.get(normalizedUserId)
        if (!target) {
          throw this.userNotFound()
        }

        if (target.status === UserStatus.ACTIVE) {
          return this.readUserInTransaction(transaction, normalizedUserId)
        }

        const enabled = await transaction.user.update({
          where: { id: normalizedUserId },
          data: {
            status: UserStatus.ACTIVE,
            disabledAt: null,
            disabledByUserId: null,
          },
          select: USER_RESPONSE_SELECT,
        })

        await this.recordUserAudit(
          transaction,
          normalizedContext,
          normalizedUserId,
          AuditEventType.USER_ENABLED,
        )

        return toUserDto(enabled)
      })
    }
    catch (error) {
      this.rethrowKnownError(error)
    }
  }

  async disable(
    context: UsersCommandContext,
    userId: string,
  ): Promise<UserDto> {
    const normalizedContext = normalizeUsersCommandContext(context)
    const normalizedUserId = normalizeUuid(userId)

    if (normalizedContext.actorUserId === normalizedUserId) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        '不能禁用当前登录用户',
      )
    }

    try {
      let revokedSessionCount = 0
      const disabledUser = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        // system_admin Role 是所有“最后管理员”修改的共同串行化锁。
        const systemRole = await lockSystemAdminRole(transaction)
        const lockedUsers = await lockUsers(transaction, [normalizedUserId])
        const target = lockedUsers.get(normalizedUserId)
        if (!target) {
          throw this.userNotFound()
        }

        if (target.status === UserStatus.DISABLED) {
          return this.readUserInTransaction(transaction, normalizedUserId)
        }

        const targetIsSystemAdmin = await transaction.userRole.findUnique({
          where: {
            userId_roleId: {
              userId: normalizedUserId,
              roleId: systemRole.id,
            },
          },
          select: { userId: true },
        })
        if (targetIsSystemAdmin) {
          await this.assertAnotherActiveSystemAdmin(
            transaction,
            systemRole.id,
          )
        }

        const databaseNow = await readDatabaseNow(transaction)
        const disabled = await transaction.user.update({
          where: { id: normalizedUserId },
          data: {
            status: UserStatus.DISABLED,
            disabledAt: databaseNow,
            disabledByUserId: normalizedContext.actorUserId,
            authVersion: { increment: 1 },
          },
          select: USER_RESPONSE_SELECT,
        })
        const revoked = await transaction.authSession.updateMany({
          where: { userId: normalizedUserId, revokedAt: null },
          data: {
            revokedAt: databaseNow,
            revokedReason: SessionRevokedReason.USER_DISABLED,
          },
        })
        revokedSessionCount = revoked.count

        await this.recordUserAudit(
          transaction,
          normalizedContext,
          normalizedUserId,
          AuditEventType.USER_DISABLED,
        )

        return toUserDto(disabled)
      })
      this.metrics.recordSessionRevoked(revokedSessionCount)
      return disabledUser
    }
    catch (error) {
      this.rethrowKnownError(error)
    }
  }

  async replaceRoles(
    context: UsersCommandContext,
    userId: string,
    input: ReplaceUserRolesRequestDto,
  ): Promise<UserDto> {
    const normalizedContext = normalizeUsersCommandContext(context)
    const normalizedUserId = normalizeUuid(userId)
    const requestedRoleIds = [
      ...new Set(input.roleIds.map(normalizeUuid)),
    ].sort()

    try {
      const snapshot = await this.readRoleReplacementSnapshot(normalizedUserId)
      const [systemRole, requestedRoles] = await Promise.all([
        this.prisma.role.findUnique({
          where: { code: SYSTEM_ADMIN_ROLE_CODE },
          select: { id: true, code: true },
        }),
        this.prisma.role.findMany({
          where: { id: { in: requestedRoleIds } },
          select: { id: true },
        }),
      ])

      if (!systemRole) {
        throw new Error('System administrator role is unavailable')
      }
      if (requestedRoles.length !== requestedRoleIds.length) {
        throw this.roleNotFound()
      }

      const roleIdsToLock = [
        ...new Set([
          systemRole.id,
          ...snapshot.roleIds,
          ...requestedRoleIds,
        ]),
      ].sort()

      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const lockedRoles = await lockRoles(transaction, roleIdsToLock)
        if (lockedRoles.size !== roleIdsToLock.length) {
          throw this.roleNotFound()
        }

        const lockedUsers = await lockUsers(transaction, [
          normalizedContext.actorUserId,
          normalizedUserId,
        ])
        const actor = lockedUsers.get(normalizedContext.actorUserId)
        const target = lockedUsers.get(normalizedUserId)
        if (!target) {
          throw this.userNotFound()
        }

        const currentTargetRoles = await transaction.userRole.findMany({
          where: { userId: normalizedUserId },
          select: { roleId: true },
          orderBy: { roleId: 'asc' },
        })
        const currentRoleIds = currentTargetRoles.map(({ roleId }) => roleId)
        if (!this.sameStringSet(currentRoleIds, snapshot.roleIds)) {
          throw this.authStateChanged()
        }

        const actorIsSystemAdmin = actor?.status === UserStatus.ACTIVE
          ? await transaction.userRole.findUnique({
              where: {
                userId_roleId: {
                  userId: normalizedContext.actorUserId,
                  roleId: systemRole.id,
                },
              },
              select: { userId: true },
            })
          : null
        if (!actorIsSystemAdmin) {
          throw new ApiException(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            '权限不足',
          )
        }

        const removesSystemAdmin =
          target.status === UserStatus.ACTIVE
          && currentRoleIds.includes(systemRole.id)
          && !requestedRoleIds.includes(systemRole.id)
        if (removesSystemAdmin) {
          await this.assertAnotherActiveSystemAdmin(
            transaction,
            systemRole.id,
          )
        }

        await transaction.userRole.deleteMany({
          where: { userId: normalizedUserId },
        })
        if (requestedRoleIds.length > 0) {
          await transaction.userRole.createMany({
            data: requestedRoleIds.map((roleId) => ({
              userId: normalizedUserId,
              roleId,
            })),
          })
        }

        const updated = await this.readUserInTransaction(
          transaction,
          normalizedUserId,
        )
        await this.audit.record(transaction, {
          eventType: AuditEventType.USER_ROLES_CHANGED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: normalizedContext.actorUserId,
          targetType: 'User',
          targetId: normalizedUserId,
          requestId: normalizedContext.requestId,
          metadata: { roleCount: requestedRoleIds.length },
        })

        return updated
      })
    }
    catch (error) {
      this.rethrowKnownError(error)
    }
  }

  async resetPassword(
    context: UsersCommandContext,
    userId: string,
    input: PasswordResetRequestDto,
  ): Promise<UserDto> {
    try {
      const normalizedContext = normalizeUsersCommandContext(context)
      const normalizedUserId = normalizeUuid(userId)

      if (normalizedContext.actorUserId === normalizedUserId) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          SELF_PASSWORD_RESET_NOT_ALLOWED_CODE,
          '不能通过管理接口重置本人密码',
        )
      }

      const snapshot = await this.readPasswordResetSnapshot(normalizedUserId)
      const acceptedPassword = this.passwordPolicy.assertAcceptable({
        password: input.newPassword,
        fieldName: 'newPassword',
      })
      const passwordHash = await this.passwords.hash(acceptedPassword)

      let revokedSessionCount = 0
      const updatedUser = await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const lockedUsers = await lockUsers(transaction, [
          normalizedContext.actorUserId,
          normalizedUserId,
        ])
        const actor = lockedUsers.get(normalizedContext.actorUserId)
        const target = lockedUsers.get(normalizedUserId)

        // User 锁后再锁当前 actor Session；不能遍历锁定 target 的全部 Session。
        const actorSession = await lockSession(
          transaction,
          normalizedContext.actorSessionId,
        )
        const databaseNow = await readDatabaseNow(transaction)

        if (!this.isCurrentActorState(
          actor,
          actorSession,
          normalizedContext,
          databaseNow,
        )) {
          throw this.authStateChanged()
        }
        if (!target || !this.matchesPasswordResetSnapshot(target, snapshot)) {
          throw this.authStateChanged()
        }

        const updated = await transaction.user.update({
          where: { id: normalizedUserId },
          data: {
            passwordHash,
            passwordChangedAt: databaseNow,
            mustChangePassword: input.mustChangePassword,
            authVersion: { increment: 1 },
          },
          select: USER_RESPONSE_SELECT,
        })
        const revoked = await transaction.authSession.updateMany({
          where: { userId: normalizedUserId, revokedAt: null },
          data: {
            revokedAt: databaseNow,
            revokedReason: SessionRevokedReason.PASSWORD_RESET,
          },
        })
        revokedSessionCount = revoked.count
        await this.audit.record(transaction, {
          eventType: AuditEventType.USER_PASSWORD_RESET,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: normalizedContext.actorUserId,
          targetType: 'User',
          targetId: normalizedUserId,
          requestId: normalizedContext.requestId,
          metadata: { mustChangePassword: input.mustChangePassword },
        })

        return toUserDto(updated)
      })
      this.metrics.recordPassword('reset', 'success')
      this.metrics.recordSessionRevoked(revokedSessionCount)
      return updatedUser
    }
    catch (error) {
      this.metrics.recordPassword('reset', 'failure')
      this.rethrowKnownError(error)
    }
  }

  private async readRoleReplacementSnapshot(
    userId: string,
  ): Promise<RoleReplacementSnapshot> {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        roles: {
          select: { roleId: true },
          orderBy: { roleId: 'asc' },
        },
      },
    })
    if (!target) {
      throw this.userNotFound()
    }

    return {
      id: target.id,
      roleIds: target.roles.map(({ roleId }) => roleId),
    }
  }

  private async readPasswordResetSnapshot(
    userId: string,
  ): Promise<PasswordResetSnapshot> {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        usernameNormalized: true,
        passwordHash: true,
        status: true,
        authVersion: true,
      },
    })
    if (!target) {
      throw this.userNotFound()
    }

    return target
  }

  private async assertAnotherActiveSystemAdmin(
    transaction: Prisma.TransactionClient,
    systemRoleId: string,
  ): Promise<void> {
    const activeSystemAdminCount = await transaction.userRole.count({
      where: {
        roleId: systemRoleId,
        user: { status: UserStatus.ACTIVE },
      },
    })
    if (activeSystemAdminCount <= 1) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        LAST_SYSTEM_ADMIN_REQUIRED_CODE,
        '必须至少保留一个启用的系统管理员',
      )
    }
  }

  private async readUserInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<UserDto> {
    const user = await findUserResponse(transaction, userId)
    if (!user) {
      throw this.userNotFound()
    }

    return toUserDto(user)
  }

  private isCurrentActorState(
    actor: LockedUserRow | undefined,
    session: LockedSessionRow | undefined,
    context: UsersCommandContext,
    databaseNow: Date,
  ): boolean {
    return (
      actor !== undefined
      && actor.status === UserStatus.ACTIVE
      && session !== undefined
      && session.userId === context.actorUserId
      && session.revokedAt === null
      && session.authVersion === actor.authVersion
      && databaseNow.getTime() < session.idleExpiresAt.getTime()
      && databaseNow.getTime() < session.absoluteExpiresAt.getTime()
    )
  }

  private matchesPasswordResetSnapshot(
    target: LockedUserRow,
    snapshot: PasswordResetSnapshot,
  ): boolean {
    return (
      target.id === snapshot.id
      && target.passwordHash === snapshot.passwordHash
      && target.authVersion === snapshot.authVersion
      && target.status === snapshot.status
    )
  }

  private recordUserAudit(
    transaction: Prisma.TransactionClient,
    context: UsersCommandContext,
    targetId: string,
    eventType: typeof AuditEventType.USER_UPDATED
      | typeof AuditEventType.USER_ENABLED
      | typeof AuditEventType.USER_DISABLED,
  ) {
    return this.audit.record(transaction, {
      eventType,
      outcome: AuditOutcome.SUCCESS,
      actorType: AuditActorType.USER,
      actorUserId: context.actorUserId,
      targetType: 'User',
      targetId,
      requestId: context.requestId,
    })
  }

  /**
   * 资金账户是可选能力：只有请求携带 fundAccount 时才额外检查 fund-accounts:create。
   * 静态 users:create 无法表达“仅部分调用者可以开户”，因此在这里做动态复核。
   */
  private async resolveNewUserFundAccount(
    context: UsersCommandContext,
    input: CreateUserFundAccountRequestDto | undefined,
  ): Promise<string | undefined> {
    if (input === undefined) {
      return undefined
    }

    let userShareRate: string
    try {
      userShareRate = normalizeFundShareRateInput(input.userShareRate)
    }
    catch (error) {
      // 资金域稳定错误直接翻译成 HTTP，避免被 rethrowKnownError 吞成 500。
      throw mapFundHttpError(error)
    }

    const granted = await this.access.getPermissionCodes(context.actorUserId)
    if (!this.access.hasAll(granted, [FUND_ACCOUNT_CREATE_PERMISSION])) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        '权限不足',
      )
    }

    return userShareRate
  }

  private normalizeDisplayName(displayName: unknown): string {
    if (typeof displayName !== 'string') {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        '请求参数校验失败',
        { displayName: ['展示名称不能为空且不能超过 128 个字符'] },
      )
    }

    const normalized = displayName.normalize('NFC').trim()
    const length = Array.from(normalized).length
    if (length < 1 || length > 128) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        '请求参数校验失败',
        { displayName: ['展示名称不能为空且不能超过 128 个字符'] },
      )
    }

    return normalized
  }

  private assertValidUsername(
    username: ReturnType<typeof normalizeUsername>,
  ): void {
    if (
      Array.from(username.username).length < 1
      || Array.from(username.username).length > 128
      || Array.from(username.usernameNormalized).length > 128
    ) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        '请求参数校验失败',
        { username: ['用户名不能为空且不能超过 128 个字符'] },
      )
    }
  }

  private sameStringSet(left: readonly string[], right: readonly string[]): boolean {
    const normalizedLeft = [...new Set(left.map(normalizeUuid))].sort()
    const normalizedRight = [...new Set(right.map(normalizeUuid))].sort()
    return (
      normalizedLeft.length === normalizedRight.length
      && normalizedLeft.every((value, index) => value === normalizedRight[index])
    )
  }

  private userNotFound(): ApiException {
    return new ApiException(
      HttpStatus.NOT_FOUND,
      USER_NOT_FOUND_CODE,
      '用户不存在',
    )
  }

  private roleNotFound(): ApiException {
    return new ApiException(
      HttpStatus.NOT_FOUND,
      ROLE_NOT_FOUND_CODE,
      'Role 不存在',
    )
  }

  private authStateChanged(): ApiException {
    return new ApiException(
      HttpStatus.CONFLICT,
      AUTH_STATE_CHANGED_CODE,
      '认证状态已变化，请重试',
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

  private rethrowKnownError(error: unknown): never {
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
    if (error instanceof PasswordPolicyViolationError) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PASSWORD_POLICY_VIOLATION',
        '密码不符合要求',
      )
    }

    throw new ApiException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      INTERNAL_ERROR_CODE,
      '服务器内部错误',
    )
  }
}
