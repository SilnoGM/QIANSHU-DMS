import { HttpStatus, Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import type { CurrentUserProfileDto } from './dto/current-user-profile.dto'
import { ProfileAvatarService } from './profile-avatar.service'
import {
  type NormalizedUserProfileUpdate,
  type NormalizeUserProfileUpdateOptions,
  normalizeUserProfileUpdate,
} from './user-profile.normalizer'

const CURRENT_USER_PROFILE_SELECT = {
  userId: true,
  email: true,
  mobileE164: true,
  avatarUrl: true,
  avatarMediaAssetId: true,
  issuerPrefix: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserProfileSelect

type CurrentUserProfileRow = Prisma.UserProfileGetPayload<{
  select: typeof CURRENT_USER_PROFILE_SELECT
}>

export interface CurrentUserProfileCommandContext {
  /** 来自 AuthenticationGuard 的可信 User id，也是本人资料的唯一目标。 */
  actorUserId: string
  requestId: string
}

export type UserProfileTransactionUpdateResult = Readonly<{
  profile: CurrentUserProfileDto
  changedFields: string
}>

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

const EMAIL_UNIQUE_TARGETS = new Set([
  'emailNormalized',
  'email_normalized',
  'user_profiles_email_normalized_key',
])
const MOBILE_UNIQUE_TARGETS = new Set([
  'mobileE164',
  'mobile_e164',
  'user_profiles_mobile_e164_key',
])
const AVATAR_UNIQUE_TARGETS = new Set([
  'avatarMediaAssetId',
  'avatar_media_asset_id',
  'user_profiles_avatar_media_asset_id_key',
])

export interface UserProfileTransactionUpdateOptions extends NormalizeUserProfileUpdateOptions {
  /**
   * 头像上传者。本人更新时等于目标用户；管理员代传时是管理员。
   * 只影响 UPLOADING 资产的所有权校验，不改变资料目标用户。
   */
  avatarActorUserId?: string
}

/**
 * 本人资料应用服务。查询始终使用受限 select；写入、Audit 与超时配置共享同一个
 * PostgreSQL 事务。管理员聚合可复用 updateInTransaction，但事务和 Audit 仍由
 * UsersService 统一持有，避免嵌套事务或重复事件。
 */
@Injectable()
export class UserProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly avatars: ProfileAvatarService,
  ) {}

  async getCurrent(userId: string): Promise<CurrentUserProfileDto> {
    try {
      const normalizedUserId = normalizeTrustedUserId(userId)
      const profile = await this.prisma.userProfile.findUnique({
        where: { userId: normalizedUserId },
        select: CURRENT_USER_PROFILE_SELECT,
      })
      if (profile === null) {
        throw internalError()
      }

      return toCurrentUserProfileDto(profile)
    }
    catch (error) {
      rethrowSafe(error)
    }
  }

  async updateCurrent(
    context: CurrentUserProfileCommandContext,
    input: unknown,
  ): Promise<CurrentUserProfileDto> {
    try {
      const userId = normalizeTrustedUserId(context.actorUserId)
      // 非法 PATCH 在打开数据库事务前失败，避免消耗连接或产生无意义锁等待。
      const normalized = normalizeUserProfileUpdate(input)

      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const profile = await this.writeNormalizedInTransaction(
          transaction,
          userId,
          normalized,
          { avatarActorUserId: userId },
        )

        await this.audit.record(transaction, {
          eventType: AuditEventType.USER_UPDATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: userId,
          targetType: 'User',
          targetId: userId,
          requestId: context.requestId,
          // 只记录字段名，不记录修改前后值、URL、手机号或 Email。
          metadata: { changedFields: normalized.changedFields },
        })

        return profile
      })
    }
    catch (error) {
      rethrowSafe(error)
    }
  }

  /**
   * 供管理员 User 聚合事务复用的无事务、无 Audit 写入原语。调用方必须已经设置
   * transaction-local timeout，并负责在聚合成功后只写一次 USER_UPDATED Audit。
   */
  async updateInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
    input: unknown,
    options: UserProfileTransactionUpdateOptions = {},
  ): Promise<UserProfileTransactionUpdateResult> {
    const normalizedUserId = normalizeTrustedUserId(userId)
    const normalized = normalizeUserProfileUpdate(input, options)
    const profile = await this.writeNormalizedInTransaction(
      transaction,
      normalizedUserId,
      normalized,
      options,
    )

    return { profile, changedFields: normalized.changedFields }
  }

  private async writeNormalizedInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
    normalized: NormalizedUserProfileUpdate,
    options: UserProfileTransactionUpdateOptions = {},
  ): Promise<CurrentUserProfileDto> {
    try {
      const avatarSubmitted = normalized.data.avatarUrl !== undefined
      let nextAvatarAssetId: string | null = null
      let previousAvatarAssetId: string | null = null

      if (avatarSubmitted) {
        const current = await transaction.userProfile.findUnique({
          where: { userId },
          select: { avatarMediaAssetId: true },
        })
        if (current === null) {
          throw internalError()
        }
        previousAvatarAssetId = current.avatarMediaAssetId
        const avatarUrl = normalized.data.avatarUrl
        nextAvatarAssetId = avatarUrl === null || avatarUrl === undefined
          ? null
          : await this.avatars.resolveUploadedAsset(transaction, {
              actorUserId: options.avatarActorUserId ?? userId,
              targetUserId: userId,
              avatarUrl,
            })
        normalized.data.avatarMediaAssetId = nextAvatarAssetId
      }

      const profile = await transaction.userProfile.update({
        where: { userId },
        data: normalized.data,
        select: CURRENT_USER_PROFILE_SELECT,
      })

      if (avatarSubmitted) {
        if (nextAvatarAssetId !== null) {
          await this.avatars.activate(transaction, nextAvatarAssetId)
        }
        if (
          previousAvatarAssetId !== null
          && previousAvatarAssetId !== nextAvatarAssetId
        ) {
          await this.avatars.reclaim(transaction, previousAvatarAssetId)
        }
      }

      return toCurrentUserProfileDto(profile)
    }
    catch (error) {
      throw mapProfileMutationError(error)
    }
  }
}

function toCurrentUserProfileDto(
  profile: CurrentUserProfileRow,
): CurrentUserProfileDto {
  return {
    userId: profile.userId,
    email: profile.email,
    mobileE164: profile.mobileE164,
    avatarUrl: profile.avatarUrl,
    issuerPrefix: profile.issuerPrefix,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  }
}

function normalizeTrustedUserId(userId: string): string {
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) {
    throw internalError()
  }

  return userId.toLowerCase()
}

function mapProfileMutationError(error: unknown): ApiException {
  if (error instanceof ApiException) {
    return error
  }

  if (hasErrorCode(error, 'P2002')) {
    const targets = readStructuredUniqueTargets(error)
    if (
      targets !== null
      && targets.length > 0
      && targets.every(target => EMAIL_UNIQUE_TARGETS.has(target))
    ) {
      return new ApiException(
        HttpStatus.CONFLICT,
        'EMAIL_ALREADY_EXISTS',
        'Email 已被使用',
      )
    }
    if (
      targets !== null
      && targets.length > 0
      && targets.every(target => MOBILE_UNIQUE_TARGETS.has(target))
    ) {
      return new ApiException(
        HttpStatus.CONFLICT,
        'MOBILE_ALREADY_EXISTS',
        '手机号已被使用',
      )
    }
    if (
      targets !== null
      && targets.length > 0
      && targets.every(target => AVATAR_UNIQUE_TARGETS.has(target))
    ) {
      return new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PROFILE_AVATAR_UNAVAILABLE',
        '头像已被使用，请重新上传',
      )
    }
  }

  // P2025 表示一对一 Profile 不变量已损坏；其他数据库错误同样不透传细节。
  return internalError()
}

/**
 * 只读取 Prisma 明确提供的结构化 constraint metadata。禁止扫描 message 或把未知
 * 字符串猜成字段，避免数据库错误文本中的值或连接信息影响公共错误映射。
 */
function readStructuredUniqueTargets(error: unknown): string[] | null {
  const errorRecord = asRecord(error)
  const meta = asRecord(errorRecord?.meta)
  const legacyTarget = meta?.target
  if (typeof legacyTarget === 'string') {
    return [legacyTarget]
  }
  if (
    Array.isArray(legacyTarget)
    && legacyTarget.every(value => typeof value === 'string')
  ) {
    return legacyTarget
  }

  const driverAdapterError = asRecord(meta?.driverAdapterError)
  const cause = asRecord(driverAdapterError?.cause)
  if (cause?.kind !== 'UniqueConstraintViolation') {
    return null
  }

  const constraint = asRecord(cause.constraint)
  const fields = constraint?.fields
  if (Array.isArray(fields) && fields.every(value => typeof value === 'string')) {
    return fields
  }
  if (typeof constraint?.index === 'string') {
    return [constraint.index]
  }

  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null
}

function hasErrorCode(error: unknown, code: string): boolean {
  return asRecord(error)?.code === code
}

function rethrowSafe(error: unknown): never {
  if (error instanceof ApiException) {
    throw error
  }

  throw internalError()
}

function internalError(): ApiException {
  return new ApiException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}
