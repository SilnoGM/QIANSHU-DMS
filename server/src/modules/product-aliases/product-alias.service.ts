import { HttpStatus, Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import { AuditEventType } from '../../generated/prisma/enums'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import type {
  ProductAliasDto,
  ProductAliasListDto,
  ProductAliasListQueryDto,
  UpsertProductAliasDto,
} from './product-alias.dto'
import {
  aliasLookupKey,
  isValidProductAlias,
  normalizeProductAlias,
  parseProductAliasProductIds,
  ProductAliasValidationError,
} from './product-alias.logic'

export interface ProductAliasCommandContext {
  readonly actorUserId: string
  readonly requestId: string
}

export interface ProductAliasResolveRequest {
  readonly userId: string
  readonly productId: string
}

type AliasReadClient = Pick<Prisma.TransactionClient, 'product' | 'userProductAlias'>

const emptyAliasMap: ReadonlyMap<string, string> = new Map()

/**
 * 仅用于不关心别名的旧测试/构造函数默认值；正式 Nest DI 必须注入真实服务。
 * 生产模块导入 ProductAliasesModule 后不会落到该空实现。
 */
export const noopProductAliasService = {
  resolveForIssuer: (): Promise<ReadonlyMap<string, string>> => Promise.resolve(emptyAliasMap),
  resolveAliases: (): Promise<ReadonlyMap<string, string>> => Promise.resolve(emptyAliasMap),
  resolveDefaults: (): Promise<ReadonlyMap<string, string>> => Promise.resolve(emptyAliasMap),
} as unknown as ProductAliasService

function validationFailure(message: string): never {
  throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_FAILED', message)
}

function normalizeAliasInput(value: string): string {
  // 控制字符和 × 必须在 normalize 前拒绝，否则换行会被折叠成空格而绕过校验。
  if (/[\p{Cc}×]/u.test(value)) {
    validationFailure('产品别名必须为 1–36 个字符，且不能包含换行、控制字符或 ×')
  }
  const normalized = normalizeProductAlias(value)
  if (!isValidProductAlias(normalized)) {
    validationFailure('产品别名必须为 1–36 个字符，且不能包含换行、控制字符或 ×')
  }
  return normalized
}

function toDto(row: { productId: string, alias: string, updatedAt: Date }): ProductAliasDto {
  return {
    productId: row.productId,
    alias: row.alias,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * 产品别名只属于当前登录用户。所有写入口都从可信登录上下文取 userId，
 * 不接受客户端传入用户标识；读取产品别名仅用于个人目录和出单人唛头。
 */
@Injectable()
export class ProductAliasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listMine(
    actorUserId: string,
    query: ProductAliasListQueryDto,
  ): Promise<ProductAliasListDto> {
    let productIds: readonly string[]
    try {
      productIds = parseProductAliasProductIds(query.productIds)
    }
    catch (error) {
      if (error instanceof ProductAliasValidationError) {
        validationFailure(error.message)
      }
      throw error
    }
    const rows = await this.prisma.userProductAlias.findMany({
      where: {
        userId: actorUserId,
        ...(productIds.length === 0 ? {} : { productId: { in: [...productIds] } }),
      },
      select: { productId: true, alias: true, updatedAt: true },
      orderBy: [{ productId: 'asc' }],
    })
    return { items: rows.map(toDto) }
  }

  async upsert(
    context: ProductAliasCommandContext,
    productId: string,
    input: UpsertProductAliasDto,
  ): Promise<ProductAliasDto> {
    const alias = normalizeAliasInput(input.alias)
    return this.prisma.$transaction(async (transaction) => {
      await applyTransactionTimeouts(transaction)
      const product = await transaction.product.findUnique({
        where: { id: productId },
        select: { id: true, productNo: true, name: true },
      })
      if (product === null) {
        throw new ApiException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', '产品不存在')
      }
      const existing = await transaction.userProductAlias.findUnique({
        where: {
          productId_userId: { productId, userId: context.actorUserId },
        },
        select: { productId: true, alias: true, updatedAt: true },
      })
      if (existing?.alias === alias) {
        return toDto(existing)
      }
      const saved = await transaction.userProductAlias.upsert({
        where: {
          productId_userId: { productId, userId: context.actorUserId },
        },
        create: {
          productId,
          userId: context.actorUserId,
          alias,
        },
        update: { alias },
        select: { productId: true, alias: true, updatedAt: true },
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.PRODUCT_ALIAS_UPDATED,
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'PRODUCT_ALIAS',
        targetId: productId,
        metadata: {
          productNo: product.productNo,
          productName: product.name,
          previousAlias: existing?.alias ?? null,
          alias,
        },
      })
      return toDto(saved)
    })
  }

  async clear(
    context: ProductAliasCommandContext,
    productId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await applyTransactionTimeouts(transaction)
      const product = await transaction.product.findUnique({
        where: { id: productId },
        select: { id: true, productNo: true, name: true },
      })
      if (product === null) {
        throw new ApiException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', '产品不存在')
      }
      const existing = await transaction.userProductAlias.findUnique({
        where: {
          productId_userId: { productId, userId: context.actorUserId },
        },
        select: { alias: true },
      })
      if (existing === null) {
        return
      }
      await transaction.userProductAlias.delete({
        where: {
          productId_userId: { productId, userId: context.actorUserId },
        },
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.PRODUCT_ALIAS_CLEARED,
        outcome: 'SUCCESS',
        actorType: 'USER',
        actorUserId: context.actorUserId,
        requestId: context.requestId,
        targetType: 'PRODUCT_ALIAS',
        targetId: productId,
        metadata: {
          productNo: product.productNo,
          productName: product.name,
          previousAlias: existing.alias,
        },
      })
    })
  }

  /** 单张采购单详情使用：按一个出单人批量读取产品别名。 */
  async resolveForIssuer(
    userId: string,
    productIds: readonly string[],
    client: AliasReadClient = this.prisma,
  ): Promise<ReadonlyMap<string, string>> {
    const uniqueProductIds = [...new Set(productIds)]
    const resolved = await this.resolveAliases(
      uniqueProductIds.map(productId => ({ userId, productId })),
      client,
    )
    return new Map(uniqueProductIds.flatMap((productId) => {
      const alias = resolved.get(aliasLookupKey(userId, productId))
      return alias === undefined ? [] : [[productId, alias] as const]
    }))
  }

  /**
   * 默认别名是产品级、全局生效的：SALES_LINKED 在个人别名缺失时使用，
   * STOCK 直接使用（不读个人别名）。空值不进入映射，调用方回退产品名。
   */
  async resolveDefaults(
    productIds: readonly string[],
    client: AliasReadClient = this.prisma,
  ): Promise<ReadonlyMap<string, string>> {
    const uniqueProductIds = [...new Set(productIds)]
    if (uniqueProductIds.length === 0) {
      return new Map()
    }
    const rows = await client.product.findMany({
      where: {
        id: { in: uniqueProductIds },
        defaultAlias: { not: null },
      },
      select: { id: true, defaultAlias: true },
    })
    return new Map(rows.flatMap((row) => {
      const alias = row.defaultAlias?.trim()
      return alias ? [[row.id, alias] as const] : []
    }))
  }

  /** 唛头解析使用：按出单人和产品批量读取，返回 `${userId}:${productId}` 映射。 */
  async resolveAliases(
    requests: readonly ProductAliasResolveRequest[],
    client: AliasReadClient = this.prisma,
  ): Promise<ReadonlyMap<string, string>> {
    const unique = new Map<string, ProductAliasResolveRequest>()
    for (const request of requests) {
      unique.set(aliasLookupKey(request.userId, request.productId), request)
    }
    if (unique.size === 0) {
      return new Map()
    }
    const rows = await client.userProductAlias.findMany({
      where: {
        OR: [...unique.values()].map(request => ({
          userId: request.userId,
          productId: request.productId,
        })),
      },
      select: { userId: true, productId: true, alias: true },
    })
    return new Map(rows.map(row => [
      aliasLookupKey(row.userId, row.productId),
      row.alias,
    ]))
  }
}
