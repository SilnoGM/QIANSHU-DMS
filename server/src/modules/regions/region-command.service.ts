import { HttpStatus, Injectable } from '@nestjs/common'

import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  RegionLevel,
  type RegionLevel as RegionLevelValue,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import type {
  CreateRegionRequestDto,
  UpdateRegionRequestDto,
} from './dto/region-command.dto'
import type {
  RegionDto,
  RegionMutationResultDto,
} from './dto/region.dto'
import {
  assertRegionIdentityAvailable,
  createRegionRecord,
  lockRegionIdsInStableOrder,
  readRegionCommandDto,
  readRegionForCreate,
  readRegionForUpdate,
  readRegionStatusGraph,
  updateRegionRecord,
  type RegionStatusGraphRecord,
  type UpdateRegionRecordInput,
} from './region-command.persistence'
import {
  normalizeNullableRegionText,
  normalizeOptionalRegionText,
  normalizeRegionCode,
  normalizeRegionName,
} from './region.normalizer'
import { mapRegionPersistenceError } from './region.persistence-error.mapper'

export interface RegionsCommandContext {
  /** 只接受 AuthenticationGuard 写入的可信 Session User id。 */
  readonly actorUserId: string
  /** 由 request-id middleware 生成或校验，不从命令 DTO 接收。 */
  readonly requestId: string
}

type RegionStatusOperation = 'enable' | 'disable'

function regionException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
): ApiException {
  return new ApiException(status, code, publicMessage)
}

function normalizeCommandContext(
  context: RegionsCommandContext,
): RegionsCommandContext {
  return {
    actorUserId: context.actorUserId.toLowerCase(),
    requestId: context.requestId,
  }
}

function normalizeRegionId(regionId: string): string {
  return regionId.toLowerCase()
}

function nextRegionLevel(
  parentLevel: RegionLevelValue | null,
): RegionLevelValue {
  if (parentLevel === null) {
    return RegionLevel.COUNTRY_REGION
  }
  if (parentLevel === RegionLevel.COUNTRY_REGION) {
    return RegionLevel.PROVINCE_STATE
  }
  if (parentLevel === RegionLevel.PROVINCE_STATE) {
    return RegionLevel.CITY
  }

  throw regionException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'REGION_HIERARCHY_INVALID',
    '城市下不能继续创建地区',
  )
}

function requireRegionDto(region: RegionDto | null): RegionDto {
  if (!region) {
    // mutation 已持有目标锁，正常路径不可消失；不要把内部不变量误报为业务 404。
    throw new Error('Region mutation response invariant violated')
  }
  return region
}

function stableGraphIds(
  graph: readonly RegionStatusGraphRecord[],
): string[] {
  return [...new Set(graph.map(region => region.id.toLowerCase()))].sort()
}

function assertStableGraph(
  before: readonly RegionStatusGraphRecord[],
  after: readonly RegionStatusGraphRecord[],
): void {
  const beforeIds = stableGraphIds(before)
  const afterIds = stableGraphIds(after)
  if (
    beforeIds.length !== afterIds.length
    || beforeIds.some((id, index) => id !== afterIds[index])
  ) {
    throw regionException(
      HttpStatus.CONFLICT,
      'REGION_STATE_CHANGED',
      '地区状态已变化，请刷新后重试',
    )
  }
}

function isSubtreeNode(
  graphById: ReadonlyMap<string, RegionStatusGraphRecord>,
  candidate: RegionStatusGraphRecord,
  targetId: string,
): boolean {
  let current: RegionStatusGraphRecord | undefined = candidate
  const visited = new Set<string>()

  while (current) {
    const id = current.id.toLowerCase()
    if (id === targetId) {
      return true
    }
    if (visited.has(id) || current.parentId === null) {
      return false
    }
    visited.add(id)
    current = graphById.get(current.parentId.toLowerCase())
  }
  return false
}

function effectiveEnabled(
  graphById: ReadonlyMap<string, RegionStatusGraphRecord>,
  region: RegionStatusGraphRecord,
  targetId: string,
  targetEnabled: boolean,
): boolean {
  let current: RegionStatusGraphRecord | undefined = region
  const visited = new Set<string>()

  while (current) {
    const id = current.id.toLowerCase()
    const ownEnabled = id === targetId ? targetEnabled : current.enabled
    if (!ownEnabled) {
      return false
    }
    if (visited.has(id)) {
      throw new Error('Region status graph cycle invariant violated')
    }
    visited.add(id)
    current = current.parentId === null
      ? undefined
      : graphById.get(current.parentId.toLowerCase())
  }
  return true
}

function countEffectiveChanges(
  graph: readonly RegionStatusGraphRecord[],
  targetId: string,
  beforeEnabled: boolean,
  afterEnabled: boolean,
): number {
  const graphById = new Map(
    graph.map(region => [region.id.toLowerCase(), region]),
  )
  let affectedCount = 0

  for (const region of graph) {
    if (!isSubtreeNode(graphById, region, targetId)) {
      continue
    }
    if (
      effectiveEnabled(graphById, region, targetId, beforeEnabled)
      !== effectiveEnabled(graphById, region, targetId, afterEnabled)
    ) {
      affectedCount += 1
    }
  }
  return affectedCount
}

/**
 * 地区写服务统一持有事务、锁序和审计边界。
 *
 * 规范化在事务外完成；进入 interactive transaction 后的第一条数据库语句固定为
 * timeout 设置。所有 Region 写入和成功 Audit 共用同一 TransactionClient。
 */
@Injectable()
export class RegionCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    context: RegionsCommandContext,
    input: CreateRegionRequestDto,
  ): Promise<RegionDto> {
    const normalizedContext = normalizeCommandContext(context)
    const code = normalizeRegionCode(input.code)
    const { name, normalizedName } = normalizeRegionName(input.name)
    const englishName = normalizeNullableRegionText(
      input.englishName,
      'englishName',
    )
    const parentId = input.parentId === null
      ? null
      : normalizeRegionId(input.parentId)
    const changedFields = [
      'code',
      'enabled',
      ...(Object.hasOwn(input, 'englishName')
        && input.englishName !== undefined
        ? ['englishName']
        : []),
      'name',
      'parentId',
      'sortOrder',
    ].sort().join(',')

    return this.runMutation(async (transaction) => {
      let parentLevel: RegionLevelValue | null = null
      if (parentId !== null) {
        const parent = await readRegionForCreate(transaction, parentId)
        if (!parent) {
          throw regionException(
            HttpStatus.NOT_FOUND,
            'REGION_PARENT_NOT_FOUND',
            '上级地区不存在',
          )
        }
        parentLevel = parent.level
      }
      const level = nextRegionLevel(parentLevel)

      await assertRegionIdentityAvailable(transaction, {
        code,
        normalizedName,
        parentId,
      })
      const created = await createRegionRecord(transaction, {
        parentId,
        code,
        name,
        normalizedName,
        englishName,
        sourceName: null,
        sourceCode: null,
        administrativeType: level,
        level,
        enabled: input.enabled,
        sortOrder: input.sortOrder,
      })

      await this.audit.record(transaction, {
        eventType: AuditEventType.REGION_CREATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: normalizedContext.actorUserId,
        targetType: 'Region',
        targetId: created.id,
        requestId: normalizedContext.requestId,
        metadata: {
          changedFields,
          level,
          affectedCount: 1,
        },
      })

      return requireRegionDto(
        await readRegionCommandDto(transaction, created.id),
      )
    })
  }

  async update(
    context: RegionsCommandContext,
    regionId: string,
    input: UpdateRegionRequestDto,
  ): Promise<RegionDto> {
    const normalizedContext = normalizeCommandContext(context)
    const normalizedRegionId = normalizeRegionId(regionId)
    const updatesName = Object.hasOwn(input, 'name')
      && input.name !== undefined
    const updatesEnglishName = Object.hasOwn(input, 'englishName')
      && input.englishName !== undefined
    const updatesSortOrder = Object.hasOwn(input, 'sortOrder')
      && input.sortOrder !== undefined

    if (!updatesName && !updatesEnglishName && !updatesSortOrder) {
      throw regionException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        '请求参数校验失败',
      )
    }

    const normalizedName = updatesName
      ? normalizeRegionName(input.name)
      : undefined
    const englishName = updatesEnglishName
      ? normalizeOptionalRegionText(input.englishName, 'englishName')
      : undefined

    return this.runMutation(async (transaction) => {
      const current = await readRegionForUpdate(
        transaction,
        normalizedRegionId,
      )
      if (!current) {
        throw regionException(
          HttpStatus.NOT_FOUND,
          'REGION_NOT_FOUND',
          '地区不存在',
        )
      }

      const data: UpdateRegionRecordInput = {}
      const changedFields: string[] = []
      if (normalizedName) {
        if (normalizedName.name !== current.name) {
          data.name = normalizedName.name
          changedFields.push('name')
        }
        if (normalizedName.normalizedName !== current.normalizedName) {
          data.normalizedName = normalizedName.normalizedName
        }
      }
      if (updatesEnglishName && englishName !== current.englishName) {
        data.englishName = englishName
        changedFields.push('englishName')
      }
      if (updatesSortOrder && input.sortOrder !== current.sortOrder) {
        data.sortOrder = input.sortOrder
        changedFields.push('sortOrder')
      }

      if (changedFields.length === 0) {
        return requireRegionDto(
          await readRegionCommandDto(transaction, normalizedRegionId),
        )
      }

      if (data.normalizedName !== undefined) {
        await assertRegionIdentityAvailable(transaction, {
          code: current.code,
          normalizedName: data.normalizedName,
          parentId: current.parentId,
          excludeId: normalizedRegionId,
        })
      }
      await updateRegionRecord(
        transaction,
        normalizedRegionId,
        data,
      )
      changedFields.sort()

      await this.audit.record(transaction, {
        eventType: AuditEventType.REGION_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: normalizedContext.actorUserId,
        targetType: 'Region',
        targetId: normalizedRegionId,
        requestId: normalizedContext.requestId,
        metadata: {
          changedFields: changedFields.join(','),
          level: current.level,
          affectedCount: 1,
        },
      })

      return requireRegionDto(
        await readRegionCommandDto(transaction, normalizedRegionId),
      )
    })
  }

  enable(
    context: RegionsCommandContext,
    regionId: string,
  ): Promise<RegionMutationResultDto> {
    return this.setEnabled(context, regionId, 'enable')
  }

  disable(
    context: RegionsCommandContext,
    regionId: string,
  ): Promise<RegionMutationResultDto> {
    return this.setEnabled(context, regionId, 'disable')
  }

  private async setEnabled(
    context: RegionsCommandContext,
    regionId: string,
    operation: RegionStatusOperation,
  ): Promise<RegionMutationResultDto> {
    const normalizedContext = normalizeCommandContext(context)
    const normalizedRegionId = normalizeRegionId(regionId)
    const desiredEnabled = operation === 'enable'

    return this.runMutation(async (transaction) => {
      const beforeLock = await readRegionStatusGraph(
        transaction,
        normalizedRegionId,
      )
      if (beforeLock.length === 0) {
        throw regionException(
          HttpStatus.NOT_FOUND,
          'REGION_NOT_FOUND',
          '地区不存在',
        )
      }
      const stableIds = stableGraphIds(beforeLock)
      await lockRegionIdsInStableOrder(transaction, stableIds)

      const lockedGraph = await readRegionStatusGraph(
        transaction,
        normalizedRegionId,
      )
      assertStableGraph(beforeLock, lockedGraph)
      const target = lockedGraph.find(
        region => region.id.toLowerCase() === normalizedRegionId,
      )
      if (!target) {
        throw regionException(
          HttpStatus.CONFLICT,
          'REGION_STATE_CHANGED',
          '地区状态已变化，请刷新后重试',
        )
      }

      if (target.enabled === desiredEnabled) {
        return {
          region: requireRegionDto(
            await readRegionCommandDto(transaction, normalizedRegionId),
          ),
          affectedCount: 0,
        }
      }

      const affectedCount = countEffectiveChanges(
        lockedGraph,
        normalizedRegionId,
        target.enabled,
        desiredEnabled,
      )
      await updateRegionRecord(
        transaction,
        normalizedRegionId,
        { enabled: desiredEnabled },
      )
      await this.audit.record(transaction, {
        eventType: operation === 'enable'
          ? AuditEventType.REGION_ENABLED
          : AuditEventType.REGION_DISABLED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: normalizedContext.actorUserId,
        targetType: 'Region',
        targetId: normalizedRegionId,
        requestId: normalizedContext.requestId,
        metadata: {
          changedFields: 'enabled',
          level: target.level,
          affectedCount,
        },
      })

      return {
        region: requireRegionDto(
          await readRegionCommandDto(transaction, normalizedRegionId),
        ),
        affectedCount,
      }
    })
  }

  private async runMutation<T>(
    operation: (
      transaction: Parameters<
        Parameters<PrismaService['$transaction']>[0]
      >[0],
    ) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        // 该调用必须是事务内第一条 SQL，锁等待和语句时间不能由外部输入放宽。
        await applyTransactionTimeouts(transaction)
        return operation(transaction)
      })
    }
    catch (error) {
      throw mapRegionPersistenceError(error)
    }
  }
}
