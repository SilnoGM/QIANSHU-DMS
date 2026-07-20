import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  AUDIT_PAGE_SIZE_MAXIMUM,
  AuditEventListQueryDto,
} from './dto/audit-event-list-query.dto'
import {
  AuditEventDto,
  AuditEventPageDto,
  type AuditPublicMetadata,
} from './dto/audit-event-page.dto'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const UNPROCESSABLE_ENTITY_STATUS = 422
const INTERNAL_ERROR_STATUS = 500

/**
 * 查询只选择公共响应字段。特别不选择 `sourceIpHash`，使该不可逆标识即使在后续
 * 映射代码变化时也不会离开数据库边界。
 */
const AUDIT_EVENT_PUBLIC_SELECT = {
  id: true,
  eventType: true,
  outcome: true,
  occurredAt: true,
  actorType: true,
  actorUserId: true,
  actorUser: {
    select: {
      displayName: true,
    },
  },
  targetType: true,
  targetId: true,
  requestId: true,
  correlationId: true,
  reasonCode: true,
  metadata: true,
} satisfies Prisma.AuditEventSelect

type AuditEventPublicRow = Prisma.AuditEventGetPayload<{
  select: typeof AUDIT_EVENT_PUBLIC_SELECT
}>

interface NormalizedAuditEventQuery {
  page: number
  pageSize: number
  skip: number
}

/**
 * 审计分页读取的唯一数据库入口。
 *
 * 服务不保存页结果或权限相关状态，每次调用都重新访问 PostgreSQL。`count` 与当前页
 * 读取通过同一个 Prisma interactive transaction 串行执行，避免应用层在两次独立
 * 数据库往返之间插入其他工作；HTTP `private, no-store` 由全局响应拦截器统一负责。
 */
@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditEventListQueryDto): Promise<AuditEventPageDto> {
    const normalized = normalizeQuery(query)
    const where: Prisma.AuditEventWhereInput = {}

    try {
      const { total, rows } = await this.prisma.$transaction(
        async (transaction) => {
          // 必须先设置事务级超时，再发出分页 SQL；count 与 findMany 串行执行，
          // 避免在同一连接上并发调度查询造成不可预期的驱动行为。
          await applyTransactionTimeouts(transaction)
          const total = await transaction.auditEvent.count({ where })
          const rows = await transaction.auditEvent.findMany({
            where,
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            skip: normalized.skip,
            take: normalized.pageSize,
            select: AUDIT_EVENT_PUBLIC_SELECT,
          })

          return { total, rows }
        },
      )

      return {
        items: rows.map(mapAuditEvent),
        page: normalized.page,
        pageSize: normalized.pageSize,
        total,
      }
    }
    catch {
      // Prisma/驱动异常可能包含 SQL、连接信息或参数内容；公共边界只暴露固定错误。
      throw new ApiException(
        INTERNAL_ERROR_STATUS,
        'INTERNAL_ERROR',
        '服务器内部错误',
      )
    }
  }
}

function normalizeQuery(query: AuditEventListQueryDto): NormalizedAuditEventQuery {
  if (!query || typeof query !== 'object') {
    throwValidationError()
  }

  const page = query.page ?? DEFAULT_PAGE
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE

  if (
    !Number.isSafeInteger(page)
    || page < 1
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > AUDIT_PAGE_SIZE_MAXIMUM
  ) {
    throwValidationError()
  }

  const skip = (page - 1) * pageSize
  if (!Number.isSafeInteger(skip)) {
    throwValidationError()
  }

  return {
    page,
    pageSize,
    skip,
  }
}

function throwValidationError(): never {
  throw new ApiException(
    UNPROCESSABLE_ENTITY_STATUS,
    'VALIDATION_FAILED',
    '请求参数校验失败',
  )
}

function mapAuditEvent(row: AuditEventPublicRow): AuditEventDto {
  return {
    id: row.id,
    eventType: row.eventType,
    outcome: row.outcome,
    occurredAt: row.occurredAt.toISOString(),
    actorType: row.actorType,
    actorUserId: row.actorUserId,
    actorDisplayName: row.actorUser?.displayName ?? null,
    targetType: row.targetType,
    targetId: row.targetId,
    requestId: row.requestId,
    correlationId: row.correlationId,
    reasonCode: row.reasonCode,
    metadata: sanitizeMetadata(row.metadata),
  }
}

function sanitizeMetadata(value: unknown): AuditPublicMetadata {
  if (!isPlainObject(value)) {
    return {}
  }

  const safeEntries: Array<[string, string | number | boolean | null]> = []

  for (const [key, entryValue] of Object.entries(value)) {
    if (isMetadataScalar(entryValue)) {
      safeEntries.push([key, entryValue])
    }
  }

  // `Object.fromEntries` 能安全创建名为 `__proto__` 的普通自有属性，不触发 setter。
  return Object.fromEntries(safeEntries)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

function isMetadataScalar(
  value: unknown,
): value is string | number | boolean | null {
  return (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  )
}
