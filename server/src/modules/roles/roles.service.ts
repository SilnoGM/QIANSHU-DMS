import { HttpStatus, Injectable } from '@nestjs/common'

import { AuditService } from '../audit/audit.service'
import { SYSTEM_ADMIN_ROLE_CODE } from '../access-control/permission.constants'
import { Prisma, type Role } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  UserStatus,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  ROLE_CODE_PATTERN,
  ROLE_DESCRIPTION_MAX_CODE_POINTS,
  type CreateRoleRequestDto,
} from './dto/create-role-request.dto'
import type { ReplaceRolePermissionsRequestDto } from './dto/replace-role-permissions-request.dto'
import type { RoleDto } from './dto/role.dto'
import type { UpdateRoleRequestDto } from './dto/update-role-request.dto'

const ROLE_NAME_MAX_CODE_POINTS = 128

const ROLE_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  isSystem: true,
  permissions: {
    orderBy: { permissionId: 'asc' },
    select: { permissionId: true },
  },
} as const satisfies Prisma.RoleSelect

type RoleRecord = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>

type LockedRoleRow = Pick<
  Role,
  'id' | 'code' | 'name' | 'description' | 'isSystem'
>

type LockedPermissionRow = Readonly<{
  id: string
  systemOnly: boolean
}>

export interface RolesCommandContext {
  actorUserId: string
  requestId: string
}

/**
 * Role 管理的 PostgreSQL 事务边界。
 *
 * 普通读请求不缓存角色关系；写请求在关系替换前按 UUID 锁定完整 Role 与
 * Permission 集合。`system_admin` 判断只依赖稳定 code，不依赖可修改的显示名称。
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<RoleDto[]> {
    try {
      const roles = await this.prisma.role.findMany({
        orderBy: [{ code: 'asc' }, { id: 'asc' }],
        select: ROLE_SELECT,
      })

      return roles.map(roleToDto)
    } catch {
      throw internalError()
    }
  }

  async getById(roleId: string): Promise<RoleDto> {
    const normalizedRoleId = normalizeUuid(roleId)
    let role: RoleRecord | null

    try {
      role = await this.prisma.role.findUnique({
        where: { id: normalizedRoleId },
        select: ROLE_SELECT,
      })
    } catch {
      throw internalError()
    }

    if (role === null) {
      throw roleNotFound()
    }

    return roleToDto(role)
  }

  async create(
    context: RolesCommandContext,
    input: CreateRoleRequestDto,
  ): Promise<RoleDto> {
    const code = normalizeRoleCode(input.code)
    const name = normalizeRequiredText(
      input.name,
      ROLE_NAME_MAX_CODE_POINTS,
    )
    const description = normalizeOptionalDescription(input.description)

    return this.runMutation(
      async (transaction) => {
        const role = await transaction.role.create({
          data: {
            code,
            name,
            description,
            // 公共创建入口永远不能生成第二个内置角色。
            isSystem: false,
          },
          select: ROLE_SELECT,
        })

        await this.audit.record(transaction, {
          eventType: AuditEventType.ROLE_CREATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId,
          targetType: 'Role',
          targetId: role.id,
          requestId: context.requestId,
        })

        return roleToDto(role)
      },
      { mapsUniqueConflictToRoleCode: true },
    )
  }

  async update(
    context: RolesCommandContext,
    roleId: string,
    input: UpdateRoleRequestDto,
  ): Promise<RoleDto> {
    const normalizedRoleId = normalizeUuid(roleId)
    const data = normalizeRoleUpdate(input)

    return this.runMutation(async (transaction) => {
      const role = await this.lockRole(transaction, normalizedRoleId)
      this.assertOrdinaryRole(role)

      const updatedRole = await transaction.role.update({
        where: { id: role.id },
        data,
        select: ROLE_SELECT,
      })

      await this.audit.record(transaction, {
        eventType: AuditEventType.ROLE_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'Role',
        targetId: role.id,
        requestId: context.requestId,
      })

      return roleToDto(updatedRole)
    })
  }

  async replacePermissions(
    context: RolesCommandContext,
    roleId: string,
    input: ReplaceRolePermissionsRequestDto,
  ): Promise<RoleDto> {
    const normalizedRoleId = normalizeUuid(roleId)
    const actorUserId = normalizeUuid(context.actorUserId)
    const desiredPermissionIds = normalizePermissionIds(input.permissionIds)

    return this.runMutation(async (transaction) => {
      const { targetRole, systemAdminRole } =
        await this.lockPermissionMutationRoles(transaction, normalizedRoleId)
      this.assertOrdinaryRole(targetRole)
      await this.lockActorUser(transaction, actorUserId)
      await this.assertActiveSystemAdminActor(
        transaction,
        actorUserId,
        systemAdminRole.id,
      )

      const currentPermissionIds = await this.readCurrentPermissionIds(
        transaction,
        targetRole.id,
      )
      const completePermissionIds = sortedUniqueIds([
        ...currentPermissionIds,
        ...desiredPermissionIds,
      ])
      const lockedPermissions = await this.lockPermissions(
        transaction,
        completePermissionIds,
      )
      this.assertPermissionSnapshot(
        currentPermissionIds,
        desiredPermissionIds,
        lockedPermissions,
      )

      await transaction.rolePermission.deleteMany({
        where: { roleId: targetRole.id },
      })
      if (desiredPermissionIds.length > 0) {
        // createMany 不使用 skipDuplicates；在目标 Role 行锁约束下，任何意外并发
        // 快照冲突必须整笔失败，不能悄悄吞掉部分关系。
        await transaction.rolePermission.createMany({
          data: desiredPermissionIds.map(permissionId => ({
            roleId: targetRole.id,
            permissionId,
          })),
        })
      }

      await this.audit.record(transaction, {
        eventType: AuditEventType.ROLE_PERMISSIONS_CHANGED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId,
        targetType: 'Role',
        targetId: targetRole.id,
        requestId: context.requestId,
        metadata: { permissionCount: desiredPermissionIds.length },
      })

      return lockedRoleToDto(targetRole, desiredPermissionIds)
    })
  }

  private async runMutation<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options: { mapsUniqueConflictToRoleCode?: boolean } = {},
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        // 超时必须在任何 Role、User、Permission 读取或加锁之前设置，确保全部
        // 业务 SQL 都受同一 PostgreSQL transaction-local 边界约束。
        await applyTransactionTimeouts(transaction)
        return operation(transaction)
      })
    } catch (error) {
      if (error instanceof ApiException) {
        throw error
      }

      if (
        options.mapsUniqueConflictToRoleCode === true
        && hasErrorCode(error, 'P2002')
      ) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'ROLE_CODE_ALREADY_EXISTS',
          '角色标识已存在',
        )
      }

      if (
        hasErrorCode(error, 'P2002')
        || isConcurrentTransactionConflict(error)
      ) {
        throw authStateChanged()
      }

      // Audit、Prisma 与驱动异常统一收口，避免泄露 SQL、连接串或内部约束名称。
      throw internalError()
    }
  }

  private async lockRole(
    transaction: Prisma.TransactionClient,
    roleId: string,
  ): Promise<LockedRoleRow> {
    const rows = await transaction.$queryRaw<LockedRoleRow[]>(Prisma.sql`
      SELECT
        "id",
        "code",
        "name",
        "description",
        "is_system" AS "isSystem"
      FROM "roles"
      WHERE "id" = CAST(${roleId} AS uuid)
      FOR UPDATE
    `)
    const role = rows[0]

    if (role === undefined) {
      throw roleNotFound()
    }

    return role
  }

  private async lockPermissionMutationRoles(
    transaction: Prisma.TransactionClient,
    targetRoleId: string,
  ): Promise<{
    targetRole: LockedRoleRow
    systemAdminRole: LockedRoleRow
  }> {
    const roles = await transaction.$queryRaw<LockedRoleRow[]>(Prisma.sql`
      SELECT
        "id",
        "code",
        "name",
        "description",
        "is_system" AS "isSystem"
      FROM "roles"
      WHERE
        "id" = CAST(${targetRoleId} AS uuid)
        OR "code" = ${SYSTEM_ADMIN_ROLE_CODE}
      ORDER BY "id"
      FOR UPDATE
    `)
    const targetRole = roles.find(role => role.id === targetRoleId)
    const systemAdminRole = roles.find(
      role => role.code === SYSTEM_ADMIN_ROLE_CODE && role.isSystem,
    )

    if (targetRole === undefined) {
      throw roleNotFound()
    }
    if (systemAdminRole === undefined) {
      // seed 不变量在请求期间发生漂移时按并发授权状态变化处理，不继续降级写入。
      throw authStateChanged()
    }

    return { targetRole, systemAdminRole }
  }

  private async assertActiveSystemAdminActor(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    systemAdminRoleId: string,
  ): Promise<void> {
    const membership = await transaction.userRole.findUnique({
      where: {
        userId_roleId: {
          userId: actorUserId,
          roleId: systemAdminRoleId,
        },
      },
      select: { user: { select: { status: true } } },
    })

    // 查询发生在完整 Role 集合与 actor User 行锁之后；遵守同一锁序的
    // UserRole 写入无法在本次复查与关系替换之间移除管理员角色或禁用 actor。
    if (membership?.user.status !== UserStatus.ACTIVE) {
      throw forbidden()
    }
  }

  private async lockActorUser(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "users"
      WHERE "id" = CAST(${actorUserId} AS uuid)
      ORDER BY "id"
      FOR UPDATE
    `)

    if (rows[0]?.id !== actorUserId) {
      throw forbidden()
    }
  }

  private async readCurrentPermissionIds(
    transaction: Prisma.TransactionClient,
    roleId: string,
  ): Promise<string[]> {
    const relations = await transaction.rolePermission.findMany({
      where: { roleId },
      orderBy: { permissionId: 'asc' },
      select: { permissionId: true },
    })

    return sortedUniqueIds(relations.map(relation => relation.permissionId))
  }

  private async lockPermissions(
    transaction: Prisma.TransactionClient,
    permissionIds: readonly string[],
  ): Promise<LockedPermissionRow[]> {
    if (permissionIds.length === 0) {
      return []
    }

    const identifiers = permissionIds.map(permissionId =>
      Prisma.sql`CAST(${permissionId} AS uuid)`,
    )

    return transaction.$queryRaw<LockedPermissionRow[]>(Prisma.sql`
      SELECT "id", "system_only" AS "systemOnly"
      FROM "permissions"
      WHERE "id" IN (${Prisma.join(identifiers)})
      ORDER BY "id"
      FOR UPDATE
    `)
  }

  private assertPermissionSnapshot(
    currentPermissionIds: readonly string[],
    desiredPermissionIds: readonly string[],
    lockedPermissions: readonly LockedPermissionRow[],
  ): void {
    const lockedById = new Map(
      lockedPermissions.map(permission => [permission.id, permission]),
    )

    if (currentPermissionIds.some(id => !lockedById.has(id))) {
      throw authStateChanged()
    }
    if (desiredPermissionIds.some(id => !lockedById.has(id))) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'PERMISSION_NOT_FOUND',
        '权限不存在',
      )
    }
    if (
      desiredPermissionIds.some(id => lockedById.get(id)?.systemOnly === true)
    ) {
      throw forbidden()
    }
  }

  private assertOrdinaryRole(role: LockedRoleRow): void {
    if (role.isSystem || role.code === SYSTEM_ADMIN_ROLE_CODE) {
      throw forbidden()
    }
  }
}

function roleToDto(role: RoleRecord): RoleDto {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissionIds: sortedUniqueIds(
      role.permissions.map(permission => permission.permissionId),
    ),
  }
}

function lockedRoleToDto(
  role: LockedRoleRow,
  permissionIds: readonly string[],
): RoleDto {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissionIds: [...permissionIds],
  }
}

function normalizeRoleCode(value: string): string {
  if (
    typeof value !== 'string'
    || Array.from(value).length > 128
    || !ROLE_CODE_PATTERN.test(value)
  ) {
    throw validationFailed()
  }

  return value
}

function normalizeRequiredText(value: string, maxCodePoints: number): string {
  if (typeof value !== 'string') {
    throw validationFailed()
  }

  const normalized = value.normalize('NFC').trim()
  const length = Array.from(normalized).length
  if (length === 0 || length > maxCodePoints) {
    throw validationFailed()
  }

  return normalized
}

function normalizeOptionalDescription(
  value: string | undefined,
): string | null {
  return value === undefined
    ? null
    : normalizeRequiredText(value, ROLE_DESCRIPTION_MAX_CODE_POINTS)
}

function normalizeRoleUpdate(
  input: UpdateRoleRequestDto,
): Prisma.RoleUpdateInput {
  const data: Prisma.RoleUpdateInput = {}

  if (input.name !== undefined) {
    data.name = normalizeRequiredText(input.name, ROLE_NAME_MAX_CODE_POINTS)
  }
  if (input.description !== undefined) {
    data.description =
      input.description === null
        ? null
        : normalizeRequiredText(
            input.description,
            ROLE_DESCRIPTION_MAX_CODE_POINTS,
          )
  }

  if (Object.keys(data).length === 0) {
    throw validationFailed()
  }

  return data
}

function normalizePermissionIds(values: readonly string[]): string[] {
  if (!Array.isArray(values)) {
    throw validationFailed()
  }

  return sortedUniqueIds(values.map(normalizeUuid))
}

function sortedUniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.toLowerCase()))].sort()
}

function normalizeUuid(value: string): string {
  if (
    typeof value !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  ) {
    throw validationFailed()
  }

  return value.toLowerCase()
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
  )
}

function isConcurrentTransactionConflict(error: unknown): boolean {
  if (hasErrorCode(error, 'P2034')) {
    return true
  }

  if (typeof error !== 'object' || error === null || !('meta' in error)) {
    return false
  }

  const databaseCode = (error.meta as { code?: unknown } | undefined)?.code
  return (
    databaseCode === '40001'
    || databaseCode === '40P01'
    || databaseCode === '55P03'
  )
}

function roleNotFound(): ApiException {
  return new ApiException(
    HttpStatus.NOT_FOUND,
    'ROLE_NOT_FOUND',
    '角色不存在',
  )
}

function forbidden(): ApiException {
  return new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', '权限不足')
}

function authStateChanged(): ApiException {
  return new ApiException(
    HttpStatus.CONFLICT,
    'AUTH_STATE_CHANGED',
    '授权状态已变化，请重试',
  )
}

function validationFailed(): ApiException {
  return new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
  )
}

function internalError(): ApiException {
  return new ApiException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}
