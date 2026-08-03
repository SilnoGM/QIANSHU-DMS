import { Injectable } from '@nestjs/common'

import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { AuditService } from '../audit/audit.service'
import {
  createDictionaryTypeRecord,
  readDictionaryTypeCommandDto,
  readDictionaryTypeForMutation,
  runDictionaryCommandTransaction,
  updateDictionaryTypeRecord,
  type UpdateDictionaryTypeRecordInput,
} from './dictionary-command.persistence'
import {
  createDictionaryApiException,
  DICTIONARY_ERROR_CODES,
} from './dictionary.errors'
import {
  normalizeDictionaryDescription,
  normalizeDictionaryName,
  normalizeOptionalDictionaryDescription,
  normalizeDictionaryTypeCode,
} from './dictionary.normalizer'
import type {
  ChangeDictionaryStatusRequestDto,
  CreateDictionaryTypeRequestDto,
  UpdateDictionaryTypeRequestDto,
} from './dto/dictionary-command.dto'
import type { DictionaryTypeDto } from './dto/dictionary-response.dto'

export interface DictionaryCommandContext {
  /** 只接受 AuthenticationGuard 写入的可信 Session User id。 */
  readonly actorUserId: string
  /** 只接受 request-id middleware 生成或校验后的请求标识。 */
  readonly requestId: string
}

type DictionaryTypeStatusOperation = 'enable' | 'disable'

function requireDictionaryTypeDto(
  value: DictionaryTypeDto | null,
): DictionaryTypeDto {
  if (value === null) {
    /*
     * 写入或已持有行锁后，目标不应在同一事务中消失。这里故意抛普通错误，
     * 由统一 Persistence mapper 收敛为 INTERNAL_ERROR，不能伪装成业务 404。
     */
    throw new Error('Dictionary Type mutation response invariant violated')
  }

  return value
}

function assertExpectedVersion(
  currentVersion: number,
  expectedVersion: number,
): void {
  if (currentVersion !== expectedVersion) {
    throw createDictionaryApiException(
      DICTIONARY_ERROR_CODES.TYPE_STATE_CHANGED,
    )
  }
}

/**
 * 字典写服务只负责编排领域规则；timeout、事务、锁、逐字段持久化和数据库错误
 * 收敛均复用 Task 4 原语，避免 Command 层出现第二套并发或错误处理路径。
 */
@Injectable()
export class DictionaryCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createType(
    context: DictionaryCommandContext,
    input: CreateDictionaryTypeRequestDto,
  ): Promise<DictionaryTypeDto> {
    // 规范化在事务外完成，避免无效输入占用数据库连接和行锁。
    const code = normalizeDictionaryTypeCode(input.code)
    const name = normalizeDictionaryName(input.name)
    const description = normalizeDictionaryDescription(input.description)
    const changedFields = [
      'code',
      'enabled',
      'name',
      'sortOrder',
      ...(Object.hasOwn(input, 'description') ? ['description'] : []),
    ].sort().join(',')

    return runDictionaryCommandTransaction(
      this.prisma,
      'TYPE',
      async (transaction) => {
        const created = await createDictionaryTypeRecord(transaction, {
          code,
          name,
          description,
          sortOrder: input.sortOrder,
        })

        await this.audit.record(transaction, {
          eventType: AuditEventType.DICTIONARY_TYPE_CREATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId.toLowerCase(),
          targetType: 'DictionaryType',
          targetId: created.id,
          requestId: context.requestId,
          metadata: {
            dictionaryCode: code,
            changedFields,
            version: 1,
          },
        })

        return requireDictionaryTypeDto(
          await readDictionaryTypeCommandDto(transaction, created.id),
        )
      },
    )
  }

  async updateType(
    context: DictionaryCommandContext,
    dictionaryTypeId: string,
    input: UpdateDictionaryTypeRequestDto,
  ): Promise<DictionaryTypeDto> {
    /*
     * DTO 会拒绝空 Patch，但 Service 仍以运行时 own-property 重新建立白名单，
     * 防止内部直接调用绕过 Controller validation 或把 undefined 当成显式更新。
     */
    const updatesName =
      Object.hasOwn(input, 'name') && input.name !== undefined
    const updatesDescription =
      Object.hasOwn(input, 'description') && input.description !== undefined
    const updatesSortOrder =
      Object.hasOwn(input, 'sortOrder') && input.sortOrder !== undefined

    if (!updatesName && !updatesDescription && !updatesSortOrder) {
      throw createDictionaryApiException(
        DICTIONARY_ERROR_CODES.VALIDATION_FAILED,
      )
    }

    const name = updatesName
      ? normalizeDictionaryName(input.name)
      : undefined
    const description = updatesDescription
      ? normalizeOptionalDictionaryDescription(input.description)
      : undefined
    const sortOrder = updatesSortOrder ? input.sortOrder : undefined
    const normalizedTypeId = dictionaryTypeId.toLowerCase()

    return runDictionaryCommandTransaction(
      this.prisma,
      'TYPE',
      async (transaction) => {
        const current = await readDictionaryTypeForMutation(
          transaction,
          normalizedTypeId,
        )
        if (current === null) {
          throw createDictionaryApiException(
            DICTIONARY_ERROR_CODES.TYPE_NOT_FOUND,
          )
        }

        // stale version 必须先于字段比较，不能被“值碰巧相同”的 no-op 吞掉。
        assertExpectedVersion(current.version, input.expectedVersion)

        const data: UpdateDictionaryTypeRecordInput = {}
        const changedFields: string[] = []
        if (name !== undefined && name !== current.name) {
          data.name = name
          changedFields.push('name')
        }
        if (
          description !== undefined
          && description !== current.description
        ) {
          data.description = description
          changedFields.push('description')
        }
        if (sortOrder !== undefined && sortOrder !== current.sortOrder) {
          data.sortOrder = sortOrder
          changedFields.push('sortOrder')
        }

        if (changedFields.length === 0) {
          return requireDictionaryTypeDto(
            await readDictionaryTypeCommandDto(
              transaction,
              normalizedTypeId,
            ),
          )
        }

        await updateDictionaryTypeRecord(
          transaction,
          normalizedTypeId,
          data,
        )
        changedFields.sort()
        await this.audit.record(transaction, {
          eventType: AuditEventType.DICTIONARY_TYPE_UPDATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId.toLowerCase(),
          targetType: 'DictionaryType',
          targetId: normalizedTypeId,
          requestId: context.requestId,
          metadata: {
            dictionaryCode: current.code,
            changedFields: changedFields.join(','),
            previousVersion: current.version,
            version: current.version + 1,
          },
        })

        return requireDictionaryTypeDto(
          await readDictionaryTypeCommandDto(
            transaction,
            normalizedTypeId,
          ),
        )
      },
    )
  }

  enableType(
    context: DictionaryCommandContext,
    dictionaryTypeId: string,
    input: ChangeDictionaryStatusRequestDto,
  ): Promise<DictionaryTypeDto> {
    return this.setTypeEnabled(
      context,
      dictionaryTypeId,
      input,
      'enable',
    )
  }

  disableType(
    context: DictionaryCommandContext,
    dictionaryTypeId: string,
    input: ChangeDictionaryStatusRequestDto,
  ): Promise<DictionaryTypeDto> {
    return this.setTypeEnabled(
      context,
      dictionaryTypeId,
      input,
      'disable',
    )
  }

  private setTypeEnabled(
    context: DictionaryCommandContext,
    dictionaryTypeId: string,
    input: ChangeDictionaryStatusRequestDto,
    operation: DictionaryTypeStatusOperation,
  ): Promise<DictionaryTypeDto> {
    const normalizedTypeId = dictionaryTypeId.toLowerCase()
    const desiredEnabled = operation === 'enable'

    return runDictionaryCommandTransaction(
      this.prisma,
      'TYPE',
      async (transaction) => {
        const current = await readDictionaryTypeForMutation(
          transaction,
          normalizedTypeId,
        )
        if (current === null) {
          throw createDictionaryApiException(
            DICTIONARY_ERROR_CODES.TYPE_NOT_FOUND,
          )
        }

        // 即使当前状态与目标相同，也必须先拒绝 stale expectedVersion。
        assertExpectedVersion(current.version, input.expectedVersion)
        if (current.enabled === desiredEnabled) {
          return requireDictionaryTypeDto(
            await readDictionaryTypeCommandDto(
              transaction,
              normalizedTypeId,
            ),
          )
        }

        if (desiredEnabled) {
          /*
           * 已持有 Type 行锁；所有 Item 状态写都必须先取得同一父锁，所以这里读取
           * enabledItemCount 不需要反向锁 Item。数据库 Trigger 仍保留最终防线。
           */
          const currentDto = requireDictionaryTypeDto(
            await readDictionaryTypeCommandDto(
              transaction,
              normalizedTypeId,
            ),
          )
          if (currentDto.enabledItemCount === 0) {
            throw createDictionaryApiException(
              DICTIONARY_ERROR_CODES.TYPE_ENABLED_ITEM_REQUIRED,
            )
          }
        }

        await updateDictionaryTypeRecord(
          transaction,
          normalizedTypeId,
          { enabled: desiredEnabled },
        )
        await this.audit.record(transaction, {
          eventType: desiredEnabled
            ? AuditEventType.DICTIONARY_TYPE_ENABLED
            : AuditEventType.DICTIONARY_TYPE_DISABLED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId.toLowerCase(),
          targetType: 'DictionaryType',
          targetId: normalizedTypeId,
          requestId: context.requestId,
          metadata: {
            dictionaryCode: current.code,
            changedFields: 'enabled',
            previousVersion: current.version,
            version: current.version + 1,
          },
        })

        return requireDictionaryTypeDto(
          await readDictionaryTypeCommandDto(
            transaction,
            normalizedTypeId,
          ),
        )
      },
    )
  }
}
