import { HttpStatus, Injectable } from '@nestjs/common'

import { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
} from '../../generated/prisma/enums'
import {
  hasPersistenceCode,
  readPersistenceErrorFacts,
} from '../../infrastructure/database/persistence-error-facts'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import { AuditService } from '../audit/audit.service'
import {
  DictionaryLookupService,
  DictionaryValueUnavailableError,
} from '../dictionaries/dictionary-lookup.service'
import { isCanonicalProductActorId } from './product-command.normalizer'
import type {
  ProductTaxonomyCategoryListItemDto,
  ProductTaxonomyCategoryListDto,
  ProductTaxonomyHeadListItemDto,
  ProductTaxonomyOptionsDto,
  ProductTaxonomyTreeCategoryDto,
  ProductTaxonomyTreeDto,
} from './dto/product-taxonomy.dto'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const REQUEST_ID_MAXIMUM_CODE_POINTS = 64

export interface ProductTaxonomyCommandContext {
  readonly actorUserId: string
  readonly requestId: string
}

export interface ResolvedProductTaxonomyIds {
  readonly categoryId: string | null
  readonly productHeadId: string | null
}

interface CategoryScope {
  readonly id: string
  readonly name: string
  readonly supplierValue: string
}

interface HeadScope {
  readonly id: string
  readonly name: string
  readonly categoryId: string
  readonly supplierValue: string
}

function taxonomyException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
  fieldErrors?: Record<string, string[]>,
): ApiException {
  return new ApiException(status, code, publicMessage, fieldErrors)
}

function internalError(): ApiException {
  return taxonomyException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}

function notFound(kind: 'category' | 'head'): ApiException {
  return kind === 'category'
    ? taxonomyException(
        HttpStatus.NOT_FOUND,
        'PRODUCT_CATEGORY_NOT_FOUND',
        '产品分类不存在',
      )
    : taxonomyException(
        HttpStatus.NOT_FOUND,
        'PRODUCT_HEAD_NOT_FOUND',
        '产品头不存在',
      )
}

function nameConflict(kind: 'category' | 'head'): ApiException {
  return kind === 'category'
    ? taxonomyException(
        HttpStatus.CONFLICT,
        'PRODUCT_CATEGORY_NAME_CONFLICT',
        '当前供应商下已存在同名分类',
        { name: ['当前供应商下已存在同名分类'] },
      )
    : taxonomyException(
        HttpStatus.CONFLICT,
        'PRODUCT_HEAD_NAME_CONFLICT',
        '当前分类下已存在同名产品头',
        { name: ['当前分类下已存在同名产品头'] },
      )
}

function isUniqueViolation(error: unknown): boolean {
  const facts = readPersistenceErrorFacts(error)
  return hasPersistenceCode(facts, 'P2002')
    || hasPersistenceCode(facts, '23505')
}

function controlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
  })
}

function validateContext(
  context: ProductTaxonomyCommandContext,
): ProductTaxonomyCommandContext {
  if (
    !isCanonicalProductActorId(context.actorUserId)
    || typeof context.requestId !== 'string'
    || context.requestId.length === 0
    || [...context.requestId].length > REQUEST_ID_MAXIMUM_CODE_POINTS
    || controlCharacter(context.requestId)
  ) {
    throw internalError()
  }
  return context
}

function mapHead(row: {
  readonly id: string
  readonly name: string
  readonly sortOrder: number
  readonly _count: { readonly products: number }
}): ProductTaxonomyHeadListItemDto {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    productCount: row._count.products,
  }
}

function mapCategory(row: {
  readonly id: string
  readonly name: string
  readonly sortOrder: number
  readonly supplierValue: string
  readonly _count: { readonly products: number }
  readonly productHeads: readonly {
    readonly id: string
    readonly name: string
    readonly sortOrder: number
    readonly _count: { readonly products: number }
  }[]
}): ProductTaxonomyCategoryListItemDto {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    supplierValue: row.supplierValue,
    productCount: row._count.products,
    productHeads: row.productHeads.map(mapHead),
  }
}

/**
 * 分类/产品头既服务独立管理页，也在产品保存事务内承担 resolve-or-create。
 * 所有创建路径都写入独立审计；删除只允许没有产品引用的条目。
 */
@Injectable()
export class ProductTaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaryLookup: DictionaryLookupService,
    private readonly audit: AuditService,
  ) {}

  async list(supplierValue: string): Promise<ProductTaxonomyCategoryListDto> {
    try {
      const rows = await this.prisma.productCategory.findMany({
        where: { supplierValue },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          sortOrder: true,
          supplierValue: true,
          _count: { select: { products: true } },
          productHeads: {
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              name: true,
              sortOrder: true,
              _count: { select: { products: true } },
            },
          },
        },
      })
      return { items: rows.map(mapCategory) }
    }
    catch {
      throw internalError()
    }
  }

  async options(supplierValue?: string): Promise<ProductTaxonomyOptionsDto> {
    try {
      const rows = await this.prisma.productCategory.findMany({
        where: supplierValue === undefined ? {} : { supplierValue },
        orderBy: [
          { supplierValue: 'asc' },
          { sortOrder: 'asc' },
          { name: 'asc' },
          { id: 'asc' },
        ],
        select: {
          id: true,
          name: true,
          sortOrder: true,
          supplierValue: true,
          productHeads: {
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
            select: { id: true, name: true, sortOrder: true },
          },
        },
      })
      return {
        categories: rows.map(row => ({
          id: row.id,
          name: row.name,
          sortOrder: row.sortOrder,
          supplierValue: row.supplierValue,
          productHeads: row.productHeads.map(head => ({
            id: head.id,
            name: head.name,
            sortOrder: head.sortOrder,
          })),
        })),
      }
    }
    catch {
      throw internalError()
    }
  }

  async tree(): Promise<ProductTaxonomyTreeDto> {
    try {
      const [categories, unclassifiedRows, totalProducts] = await Promise.all([
        this.prisma.productCategory.findMany({
          orderBy: [
            { supplierValue: 'asc' },
            { sortOrder: 'asc' },
            { name: 'asc' },
            { id: 'asc' },
          ],
          select: {
            id: true,
            name: true,
            sortOrder: true,
            supplierValue: true,
            _count: { select: { products: true } },
            productHeads: {
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                name: true,
                sortOrder: true,
                _count: { select: { products: true } },
              },
            },
          },
        }),
        this.prisma.product.groupBy({
          by: ['supplierValue'],
          where: { categoryId: null },
          _count: { _all: true },
        }),
        this.prisma.product.count(),
      ])

      const unclassifiedBySupplier = new Map(
        unclassifiedRows.map(row => [row.supplierValue, row._count._all]),
      )
      const supplierMap = new Map<string, {
        readonly categories: ProductTaxonomyTreeCategoryDto[]
        readonly unclassifiedCount: number
      }>()
      for (const category of categories) {
        const entry = supplierMap.get(category.supplierValue) ?? {
          categories: [],
          unclassifiedCount: unclassifiedBySupplier.get(category.supplierValue) ?? 0,
        }
        entry.categories.push({
          id: category.id,
          name: category.name,
          sortOrder: category.sortOrder,
          productCount: category._count.products,
          productHeads: category.productHeads.map(head => ({
            id: head.id,
            name: head.name,
            sortOrder: head.sortOrder,
            productCount: head._count.products,
          })),
        })
        supplierMap.set(category.supplierValue, entry)
      }
      for (const [supplierValue, count] of unclassifiedBySupplier) {
        if (!supplierMap.has(supplierValue)) {
          supplierMap.set(supplierValue, {
            categories: [],
            unclassifiedCount: count,
          })
        }
      }

      return {
        suppliers: [...supplierMap.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([supplierValue, entry]) => ({
            supplierValue,
            productCount: entry.categories.reduce(
              (sum, category) => sum + category.productCount,
              entry.unclassifiedCount,
            ),
            unclassifiedCount: entry.unclassifiedCount,
            categories: entry.categories,
          })),
        totalProducts,
        unclassifiedCount: unclassifiedRows.reduce(
          (sum, row) => sum + row._count._all,
          0,
        ),
      }
    }
    catch {
      throw internalError()
    }
  }

  async createCategory(
    rawContext: ProductTaxonomyCommandContext,
    input: { readonly supplierValue: string; readonly name: string },
  ): Promise<ProductTaxonomyCategoryListItemDto> {
    const context = validateContext(rawContext)
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        await this.dictionaryLookup.requireEffectiveValue(transaction, {
          dictionaryCode: SUPPLIER_DICTIONARY_CODE,
          value: input.supplierValue,
        })
        const category = await this.createCategoryInTransaction(
          transaction,
          context,
          input,
          true,
        )
        return this.readCategoryInTransaction(transaction, category.id)
      })
    }
    catch (error) {
      throw this.mapCommandError(error, 'category')
    }
  }

  async renameCategory(
    rawContext: ProductTaxonomyCommandContext,
    categoryId: string,
    input: { readonly name: string },
  ): Promise<ProductTaxonomyCategoryListItemDto> {
    const context = validateContext(rawContext)
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const current = await transaction.productCategory.findUnique({
          where: { id: categoryId },
          select: { id: true, name: true, supplierValue: true },
        })
        if (current === null) throw notFound('category')
        if (current.name === input.name) {
          return this.readCategoryInTransaction(transaction, categoryId)
        }
        try {
          await transaction.productCategory.update({
            where: { id: categoryId },
            data: { name: input.name },
            select: { id: true },
          })
        }
        catch (error) {
          if (isUniqueViolation(error)) throw nameConflict('category')
          throw error
        }
        await this.audit.record(transaction, {
          eventType: AuditEventType.PRODUCT_CATEGORY_RENAMED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId,
          targetType: 'PRODUCT_CATEGORY',
          targetId: categoryId,
          requestId: context.requestId,
          metadata: {
            categoryId,
            supplierValue: current.supplierValue,
            previousName: current.name,
            name: input.name,
          },
        })
        return this.readCategoryInTransaction(transaction, categoryId)
      })
    }
    catch (error) {
      throw this.mapCommandError(error, 'category')
    }
  }

  async deleteCategory(
    rawContext: ProductTaxonomyCommandContext,
    categoryId: string,
  ): Promise<void> {
    const context = validateContext(rawContext)
    try {
      await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        // 与产品插入时取得的分类 KEY SHARE 锁互斥；先锁再计数，避免检查后被并发挂上产品。
        await transaction.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "product_categories"
          WHERE "id" = CAST(${categoryId} AS uuid)
          FOR UPDATE
        `)
        const category = await transaction.productCategory.findUnique({
          where: { id: categoryId },
          select: {
            id: true,
            name: true,
            supplierValue: true,
            _count: { select: { products: true, productHeads: true } },
          },
        })
        if (category === null) throw notFound('category')
        if (category._count.products > 0) {
          throw taxonomyException(
            HttpStatus.CONFLICT,
            'PRODUCT_CATEGORY_IN_USE',
            '产品分类仍有产品引用，不能删除',
            { categoryId: [`仍有 ${category._count.products} 个产品引用`] },
          )
        }
        const headIds = await transaction.productHead.findMany({
          where: { categoryId },
          select: { id: true },
        })
        await transaction.productHead.deleteMany({ where: { categoryId } })
        await transaction.productCategory.delete({ where: { id: categoryId } })
        await this.audit.record(transaction, {
          eventType: AuditEventType.PRODUCT_CATEGORY_DELETED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId,
          targetType: 'PRODUCT_CATEGORY',
          targetId: categoryId,
          requestId: context.requestId,
          metadata: {
            categoryId,
            name: category.name,
            supplierValue: category.supplierValue,
            deletedHeadCount: headIds.length,
          },
        })
      })
    }
    catch (error) {
      throw this.mapCommandError(error, 'category')
    }
  }

  async createHead(
    rawContext: ProductTaxonomyCommandContext,
    input: { readonly categoryId: string; readonly name: string },
  ): Promise<ProductTaxonomyHeadListItemDto> {
    const context = validateContext(rawContext)
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const category = await this.readCategoryScope(transaction, input.categoryId)
        const head = await this.createHeadInTransaction(
          transaction,
          context,
          category,
          input.name,
          true,
        )
        return this.readHeadInTransaction(transaction, head.id)
      })
    }
    catch (error) {
      throw this.mapCommandError(error, 'head')
    }
  }

  async renameHead(
    rawContext: ProductTaxonomyCommandContext,
    productHeadId: string,
    input: { readonly name: string },
  ): Promise<ProductTaxonomyHeadListItemDto> {
    const context = validateContext(rawContext)
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const current = await transaction.productHead.findUnique({
          where: { id: productHeadId },
          select: {
            id: true,
            name: true,
            categoryId: true,
            category: { select: { supplierValue: true } },
          },
        })
        if (current === null) throw notFound('head')
        if (current.name === input.name) {
          return this.readHeadInTransaction(transaction, productHeadId)
        }
        try {
          await transaction.productHead.update({
            where: { id: productHeadId },
            data: { name: input.name },
            select: { id: true },
          })
        }
        catch (error) {
          if (isUniqueViolation(error)) throw nameConflict('head')
          throw error
        }
        await this.audit.record(transaction, {
          eventType: AuditEventType.PRODUCT_HEAD_RENAMED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId,
          targetType: 'PRODUCT_HEAD',
          targetId: productHeadId,
          requestId: context.requestId,
          metadata: {
            productHeadId,
            categoryId: current.categoryId,
            supplierValue: current.category.supplierValue,
            previousName: current.name,
            name: input.name,
          },
        })
        return this.readHeadInTransaction(transaction, productHeadId)
      })
    }
    catch (error) {
      throw this.mapCommandError(error, 'head')
    }
  }

  async deleteHead(
    rawContext: ProductTaxonomyCommandContext,
    productHeadId: string,
  ): Promise<void> {
    const context = validateContext(rawContext)
    try {
      await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        await transaction.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "product_heads"
          WHERE "id" = CAST(${productHeadId} AS uuid)
          FOR UPDATE
        `)
        const head = await transaction.productHead.findUnique({
          where: { id: productHeadId },
          select: {
            id: true,
            name: true,
            categoryId: true,
            category: { select: { supplierValue: true } },
            _count: { select: { products: true } },
          },
        })
        if (head === null) throw notFound('head')
        if (head._count.products > 0) {
          throw taxonomyException(
            HttpStatus.CONFLICT,
            'PRODUCT_HEAD_IN_USE',
            '产品头仍有产品引用，不能删除',
            { productHeadId: [`仍有 ${head._count.products} 个产品引用`] },
          )
        }
        await transaction.productHead.delete({ where: { id: productHeadId } })
        await this.audit.record(transaction, {
          eventType: AuditEventType.PRODUCT_HEAD_DELETED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId,
          targetType: 'PRODUCT_HEAD',
          targetId: productHeadId,
          requestId: context.requestId,
          metadata: {
            productHeadId,
            name: head.name,
            categoryId: head.categoryId,
            supplierValue: head.category.supplierValue,
          },
        })
      })
    }
    catch (error) {
      throw this.mapCommandError(error, 'head')
    }
  }

  async moveCategory(
    rawContext: ProductTaxonomyCommandContext,
    categoryId: string,
    direction: 'up' | 'down',
  ): Promise<void> {
    const context = validateContext(rawContext)
    try {
      await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const current = await transaction.productCategory.findUnique({
          where: { id: categoryId },
          select: { id: true, name: true, supplierValue: true },
        })
        if (current === null) throw notFound('category')
        await transaction.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "product_categories"
          WHERE "supplier_value" = ${current.supplierValue}
          ORDER BY "sort_order" ASC, "name" ASC, "id" ASC
          FOR UPDATE
        `)
        const rows = await transaction.productCategory.findMany({
          where: { supplierValue: current.supplierValue },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
          select: { id: true, sortOrder: true },
        })
        const movement = await this.moveWithinScope(
          rows,
          categoryId,
          direction,
          'PRODUCT_CATEGORY_ORDER_BOUNDARY',
          (id, sortOrder) => transaction.productCategory.update({
            where: { id },
            data: { sortOrder },
            select: { id: true },
          }),
        )
        await this.audit.record(transaction, {
          eventType: AuditEventType.PRODUCT_CATEGORY_REORDERED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId,
          targetType: 'PRODUCT_CATEGORY',
          targetId: categoryId,
          requestId: context.requestId,
          metadata: {
            categoryId,
            supplierValue: current.supplierValue,
            name: current.name,
            direction,
            ...movement,
          },
        })
      })
    }
    catch (error) {
      throw this.mapCommandError(error, 'category')
    }
  }

  async moveHead(
    rawContext: ProductTaxonomyCommandContext,
    productHeadId: string,
    direction: 'up' | 'down',
  ): Promise<void> {
    const context = validateContext(rawContext)
    try {
      await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const current = await transaction.productHead.findUnique({
          where: { id: productHeadId },
          select: {
            id: true,
            name: true,
            categoryId: true,
            category: { select: { supplierValue: true } },
          },
        })
        if (current === null) throw notFound('head')
        await transaction.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "product_heads"
          WHERE "category_id" = CAST(${current.categoryId} AS uuid)
          ORDER BY "sort_order" ASC, "name" ASC, "id" ASC
          FOR UPDATE
        `)
        const rows = await transaction.productHead.findMany({
          where: { categoryId: current.categoryId },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
          select: { id: true, sortOrder: true },
        })
        const movement = await this.moveWithinScope(
          rows,
          productHeadId,
          direction,
          'PRODUCT_HEAD_ORDER_BOUNDARY',
          (id, sortOrder) => transaction.productHead.update({
            where: { id },
            data: { sortOrder },
            select: { id: true },
          }),
        )
        await this.audit.record(transaction, {
          eventType: AuditEventType.PRODUCT_HEAD_REORDERED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: context.actorUserId,
          targetType: 'PRODUCT_HEAD',
          targetId: productHeadId,
          requestId: context.requestId,
          metadata: {
            productHeadId,
            categoryId: current.categoryId,
            supplierValue: current.category.supplierValue,
            name: current.name,
            direction,
            ...movement,
          },
        })
      })
    }
    catch (error) {
      throw this.mapCommandError(error, 'head')
    }
  }

  /**
   * 上下移动在当前作用域内交换相邻项，并把整组重写为 10 的倍数。
   * 调用方必须先锁定该作用域，避免并发移动读到过期邻居。
   */
  private async moveWithinScope(
    rows: readonly { readonly id: string; readonly sortOrder: number }[],
    currentId: string,
    direction: 'up' | 'down',
    boundaryCode: string,
    update: (id: string, sortOrder: number) => Promise<unknown>,
  ): Promise<{
    readonly previousSortOrder: number
    readonly nextSortOrder: number
    readonly previousNeighborId: string | null
    readonly nextNeighborId: string | null
  }> {
    const index = rows.findIndex(row => row.id === currentId)
    const current = rows[index]
    if (index < 0 || current === undefined) throw internalError()
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= rows.length) {
      throw taxonomyException(
        HttpStatus.CONFLICT,
        boundaryCode,
        direction === 'up' ? '已经是第一个，不能上移' : '已经是最后一个，不能下移',
      )
    }

    const ordered = [...rows]
    const [moved] = ordered.splice(index, 1)
    if (moved === undefined) throw internalError()
    ordered.splice(targetIndex, 0, moved)
    for (const [position, row] of ordered.entries()) {
      const nextSortOrder = (position + 1) * 10
      if (row.sortOrder !== nextSortOrder) {
        await update(row.id, nextSortOrder)
      }
    }

    return {
      previousSortOrder: current.sortOrder,
      nextSortOrder: (targetIndex + 1) * 10,
      previousNeighborId: rows[index - 1]?.id ?? null,
      nextNeighborId: rows[index + 1]?.id ?? null,
    }
  }

  /**
   * 产品保存时的 resolve-or-create。它只读/写当前产品事务，不另开事务，保证分类、
   * 产品头与产品、审计一起提交或一起回滚。
   */
  async resolveOrCreateInTransaction(
    transaction: Prisma.TransactionClient,
    context: ProductTaxonomyCommandContext,
    input: {
      readonly supplierValue: string
      readonly categoryName: string | null
      readonly productHeadName: string | null
    },
  ): Promise<ResolvedProductTaxonomyIds> {
    if (input.categoryName === null && input.productHeadName === null) {
      return { categoryId: null, productHeadId: null }
    }
    if (input.categoryName === null || input.productHeadName === null) {
      throw taxonomyException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        '请求参数校验失败',
        { productHeadName: ['分类与产品头必须同时填写'] },
      )
    }

    const trusted = validateContext(context)
    const category = await this.findOrCreateCategory(
      transaction,
      trusted,
      input.supplierValue,
      input.categoryName,
    )
    const head = await this.findOrCreateHead(
      transaction,
      trusted,
      category,
      input.productHeadName,
    )
    return { categoryId: category.id, productHeadId: head.id }
  }

  private async findOrCreateCategory(
    transaction: Prisma.TransactionClient,
    context: ProductTaxonomyCommandContext,
    supplierValue: string,
    name: string,
  ): Promise<CategoryScope> {
    const existing = await transaction.productCategory.findUnique({
      where: { supplierValue_name: { supplierValue, name } },
      select: { id: true, name: true, supplierValue: true },
    })
    if (existing !== null) return existing
    return this.createCategoryInTransaction(transaction, context, {
      supplierValue,
      name,
    }, false)
  }

  private async findOrCreateHead(
    transaction: Prisma.TransactionClient,
    context: ProductTaxonomyCommandContext,
    category: CategoryScope,
    name: string,
  ): Promise<HeadScope> {
    const existing = await transaction.productHead.findUnique({
      where: { categoryId_name: { categoryId: category.id, name } },
      select: { id: true, name: true, categoryId: true },
    })
    if (existing !== null) {
      return { ...existing, supplierValue: category.supplierValue }
    }
    return this.createHeadInTransaction(
      transaction,
      context,
      category,
      name,
      false,
    )
  }

  private async createCategoryInTransaction(
    transaction: Prisma.TransactionClient,
    context: ProductTaxonomyCommandContext,
    input: { readonly supplierValue: string; readonly name: string },
    conflictOnExisting: boolean,
  ): Promise<CategoryScope> {
    try {
      const maximum = await transaction.productCategory.aggregate({
        where: { supplierValue: input.supplierValue },
        _max: { sortOrder: true },
      })
      const created = await transaction.productCategory.create({
        data: {
          supplierValue: input.supplierValue,
          name: input.name,
          sortOrder: (maximum._max.sortOrder ?? 0) + 10,
        },
        select: { id: true, name: true, supplierValue: true },
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.PRODUCT_CATEGORY_CREATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'PRODUCT_CATEGORY',
        targetId: created.id,
        requestId: context.requestId,
        metadata: {
          categoryId: created.id,
          name: created.name,
          supplierValue: created.supplierValue,
        },
      })
      return created
    }
    catch (error) {
      if (!isUniqueViolation(error)) throw error
      if (conflictOnExisting) throw nameConflict('category')
      const existing = await transaction.productCategory.findUnique({
        where: {
          supplierValue_name: {
            supplierValue: input.supplierValue,
            name: input.name,
          },
        },
        select: { id: true, name: true, supplierValue: true },
      })
      if (existing === null) throw error
      return existing
    }
  }

  private async createHeadInTransaction(
    transaction: Prisma.TransactionClient,
    context: ProductTaxonomyCommandContext,
    category: CategoryScope,
    name: string,
    conflictOnExisting: boolean,
  ): Promise<HeadScope> {
    try {
      const maximum = await transaction.productHead.aggregate({
        where: { categoryId: category.id },
        _max: { sortOrder: true },
      })
      const created = await transaction.productHead.create({
        data: {
          categoryId: category.id,
          name,
          sortOrder: (maximum._max.sortOrder ?? 0) + 10,
        },
        select: { id: true, name: true, categoryId: true },
      })
      await this.audit.record(transaction, {
        eventType: AuditEventType.PRODUCT_HEAD_CREATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: context.actorUserId,
        targetType: 'PRODUCT_HEAD',
        targetId: created.id,
        requestId: context.requestId,
        metadata: {
          productHeadId: created.id,
          name: created.name,
          categoryId: created.categoryId,
          supplierValue: category.supplierValue,
        },
      })
      return { ...created, supplierValue: category.supplierValue }
    }
    catch (error) {
      if (!isUniqueViolation(error)) throw error
      if (conflictOnExisting) throw nameConflict('head')
      const existing = await transaction.productHead.findUnique({
        where: { categoryId_name: { categoryId: category.id, name } },
        select: { id: true, name: true, categoryId: true },
      })
      if (existing === null) throw error
      return { ...existing, supplierValue: category.supplierValue }
    }
  }

  private async readCategoryScope(
    transaction: Prisma.TransactionClient,
    categoryId: string,
  ): Promise<CategoryScope> {
    const category = await transaction.productCategory.findUnique({
      where: { id: categoryId },
      select: { id: true, name: true, supplierValue: true },
    })
    if (category === null) throw notFound('category')
    return category
  }

  private async readCategoryInTransaction(
    transaction: Prisma.TransactionClient,
    categoryId: string,
  ): Promise<ProductTaxonomyCategoryListItemDto> {
    const row = await transaction.productCategory.findUnique({
      where: { id: categoryId },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        supplierValue: true,
        _count: { select: { products: true } },
        productHeads: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            sortOrder: true,
            _count: { select: { products: true } },
          },
        },
      },
    })
    if (row === null) throw notFound('category')
    return mapCategory(row)
  }

  private async readHeadInTransaction(
    transaction: Prisma.TransactionClient,
    productHeadId: string,
  ): Promise<ProductTaxonomyHeadListItemDto> {
    const row = await transaction.productHead.findUnique({
      where: { id: productHeadId },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        _count: { select: { products: true } },
      },
    })
    if (row === null) throw notFound('head')
    return mapHead(row)
  }

  private mapCommandError(
    error: unknown,
    kind: 'category' | 'head',
  ): ApiException {
    if (error instanceof ApiException) return error
    if (error instanceof DictionaryValueUnavailableError) {
      return taxonomyException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PRODUCT_SUPPLIER_UNAVAILABLE',
        '供应商当前不可用',
        { supplierValue: ['供应商当前不可用'] },
      )
    }
    if (isUniqueViolation(error)) return nameConflict(kind)
    return internalError()
  }
}
