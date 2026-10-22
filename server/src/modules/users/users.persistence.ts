import { SYSTEM_ADMIN_ROLE_CODE } from '../access-control/permission.constants'
import { Prisma, type UserStatus } from '../../generated/prisma/client'
import type { UserDto } from './dto/user-response.dto'

export const USER_RESPONSE_SELECT = {
  id: true,
  username: true,
  displayName: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  roles: {
    select: { roleId: true },
    orderBy: { roleId: 'asc' },
  },
  profile: {
    select: {
      email: true,
      mobileE164: true,
      avatarUrl: true,
      issuerPrefix: true,
      remark: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.UserSelect

export type UserResponseRow = Prisma.UserGetPayload<{
  select: typeof USER_RESPONSE_SELECT
}>

export type LockedRoleRow = Readonly<{
  id: string
  code: string
}>

export type LockedUserRow = Readonly<{
  authVersion: number
  id: string
  passwordHash: string
  status: UserStatus
}>

export type LockedSessionRow = Readonly<{
  absoluteExpiresAt: Date
  authVersion: number
  id: string
  idleExpiresAt: Date
  revokedAt: Date | null
  userId: string
}>

type DatabaseClockRow = Readonly<{ now: Date }>

/**
 * PostgreSQL 的 uuid 类型不区分十六进制字母大小写，并会以小写文本返回。
 * 所有进入 User 管理边界的 UUID 都先采用同一规范形式，避免原始大写输入与
 * 数据库返回的小写主键在 Set 去重或 Map 查找时被误判为不同实体。
 */
export function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase()
}

/**
 * 统一 User 管理响应投影。内部密码、authVersion 与禁用操作人等字段不会进入该
 * mapper；角色 ID 在最后一道响应边界再次去重排序，避免关系读取顺序漂移。
 */
export function toUserDto(user: UserResponseRow): UserDto {
  if (user.profile === null) {
    throw new Error('User profile invariant violated')
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    roleIds: [...new Set(user.roles.map(({ roleId }) => roleId))].sort(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    profile: {
      email: user.profile.email,
      mobileE164: user.profile.mobileE164,
      avatarUrl: user.profile.avatarUrl,
      issuerPrefix: user.profile.issuerPrefix,
      remark: user.profile.remark,
      createdAt: user.profile.createdAt.toISOString(),
      updatedAt: user.profile.updatedAt.toISOString(),
    },
  }
}

export async function lockSystemAdminRole(
  transaction: Prisma.TransactionClient,
): Promise<LockedRoleRow> {
  const rows = await transaction.$queryRaw<LockedRoleRow[]>(Prisma.sql`
    SELECT "id", "code"
    FROM "roles"
    WHERE "code" = ${SYSTEM_ADMIN_ROLE_CODE}
    FOR UPDATE
  `)
  const role = rows[0]
  if (!role) {
    throw new Error('System administrator role is unavailable')
  }

  return role
}

/** 授权图写入必须一次按 UUID 顺序取得完整 Role 锁集合。 */
export async function lockRoles(
  transaction: Prisma.TransactionClient,
  roleIds: readonly string[],
): Promise<Map<string, LockedRoleRow>> {
  const sortedRoleIds = [...new Set(roleIds.map(normalizeUuid))].sort()
  const rows = await transaction.$queryRaw<LockedRoleRow[]>(Prisma.sql`
    SELECT "id", "code"
    FROM "roles"
    WHERE "id" IN (${Prisma.join(
      sortedRoleIds.map((roleId) => Prisma.sql`CAST(${roleId} AS uuid)`),
    )})
    ORDER BY "id" ASC
    FOR UPDATE
  `)

  return new Map(rows.map((role) => [normalizeUuid(role.id), role]))
}

/** 多 User 修改统一按 UUID 排序；调用方若还锁 Role，必须先调用 lockRoles。 */
export async function lockUsers(
  transaction: Prisma.TransactionClient,
  userIds: readonly string[],
): Promise<Map<string, LockedUserRow>> {
  const sortedUserIds = [...new Set(userIds.map(normalizeUuid))].sort()
  const rows = await transaction.$queryRaw<LockedUserRow[]>(Prisma.sql`
    SELECT
      "id",
      "status",
      "auth_version" AS "authVersion",
      "password_hash" AS "passwordHash"
    FROM "users"
    WHERE "id" IN (${Prisma.join(
      sortedUserIds.map((userId) => Prisma.sql`CAST(${userId} AS uuid)`),
    )})
    ORDER BY "id" ASC
    FOR UPDATE
  `)

  return new Map(rows.map((user) => [normalizeUuid(user.id), user]))
}

export async function lockSession(
  transaction: Prisma.TransactionClient,
  sessionId: string,
): Promise<LockedSessionRow | undefined> {
  const normalizedSessionId = normalizeUuid(sessionId)
  const rows = await transaction.$queryRaw<LockedSessionRow[]>(Prisma.sql`
    SELECT
      "id",
      "user_id" AS "userId",
      "auth_version" AS "authVersion",
      "revoked_at" AS "revokedAt",
      "idle_expires_at" AS "idleExpiresAt",
      "absolute_expires_at" AS "absoluteExpiresAt"
    FROM "auth_sessions"
    WHERE "id" = CAST(${normalizedSessionId} AS uuid)
    FOR UPDATE
  `)

  return rows[0]
}

export function findUserResponse(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<UserResponseRow | null> {
  return transaction.user.findUnique({
    where: { id: normalizeUuid(userId) },
    select: USER_RESPONSE_SELECT,
  })
}

export async function readDatabaseNow(
  transaction: Prisma.TransactionClient,
): Promise<Date> {
  const rows = await transaction.$queryRaw<DatabaseClockRow[]>(Prisma.sql`
    SELECT clock_timestamp() AS "now"
  `)
  const databaseNow = rows[0]?.now
  if (!(databaseNow instanceof Date) || !Number.isFinite(databaseNow.getTime())) {
    throw new Error('Invalid database clock result')
  }

  return databaseNow
}
