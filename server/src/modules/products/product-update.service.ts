import { HttpStatus, Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  ProductStatus,
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
  CurrencyLookupError,
  CurrencyLookupService,
  type EffectiveCurrency,
} from '../currencies/currency-lookup.service'
import {
  DictionaryLookupService,
  DictionaryValueUnavailableError,
} from '../dictionaries/dictionary-lookup.service'
import {
  isCanonicalProductActorId,
  type NormalizedProductCreateCommand,
  type NormalizedProductCreateMoney,
} from './product-command.normalizer'
import {
  mapProductMedia,
  readActiveProductMedia,
} from './media/product-media-query.mapper'
import {
  mapProductListItem,
  type ProductListItem,
  type ProductQueryRow,
} from './product-query.mapper'
import {
  buildProductUpdateTarget,
  normalizeProductUpdatePatch,
  type ProductUpdateCurrent,
} from './product-update.normalizer'
import {
  readProductForUpdate,
  readProductUpdateResponse,
  updateProductRecord,
  type ProductUpdateLockRecord,
  type ProductUpdateRecordData,
} from './product-update.persistence'
import {
  ProductTaxonomyService,
  type ResolvedProductTaxonomyIds,
} from './product-taxonomy.service'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const REQUEST_ID_MAXIMUM_CODE_POINTS = 64
const PRODUCT_STATE_CHANGE_CODES = [
  'P2034',
  '40001',
  '40P01',
  '55P03',
  '57014',
] as const
const MONEY_FIELDS = [
  'twdSalePrice',
  'myrSalePrice',
  'purchaseCost',
] as const

export interface ProductUpdateContext {
  /** AuthenticationGuard 写入的可信、canonical lowercase Session User id。 */
  readonly actorUserId: string
  /** request-id middleware 已校验的请求标识。 */
  readonly requestId: string
}

function productException(
  status: HttpStatus,
  code: string,
  publicMessage: string,
  fieldErrors?: Record<string, string[]>,
): ApiException {
  return new ApiException(status, code, publicMessage, fieldErrors)
}

function internalProductError(): ApiException {
  return productException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    '服务器内部错误',
  )
}

function stateChangedError(): ApiException {
  return productException(
    HttpStatus.CONFLICT,
    'PRODUCT_STATE_CHANGED',
    '产品已变化，请刷新后重试',
  )
}

function hasProductStateChangeCode(error: unknown): boolean {
  const facts = readPersistenceErrorFacts(error)
  return PRODUCT_STATE_CHANGE_CODES.some(code => hasPersistenceCode(facts, code))
}

function hasRequestIdControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
  })
}

function validateTrustedContext(context: ProductUpdateContext): ProductUpdateContext {
  if (!isCanonicalProductActorId(context.actorUserId)) {
    throw internalProductError()
  }
  if (
    typeof context.requestId !== 'string'
    || context.requestId.length === 0
    || [...context.requestId].length > REQUEST_ID_MAXIMUM_CODE_POINTS
    || hasRequestIdControlCharacter(context.requestId)
  ) {
    throw internalProductError()
  }
  return Object.freeze({
    actorUserId: context.actorUserId,
    requestId: context.requestId,
  })
}

function precisionFailure(field: string): never {
  throw productException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    '请求参数校验失败',
    { [field]: ['小数位超过当前币种精度'] },
  )
}

function assertMoneyPrecision(
  money: NormalizedProductCreateMoney,
  field: string,
  currenciesByCode: ReadonlyMap<string, EffectiveCurrency>,
): void {
  const currency = currenciesByCode.get(money.currency)
  if (currency === undefined) throw internalProductError()
  if (money.amount !== null && money.inputFractionDigits > currency.minorUnit) {
    precisionFailure(field)
  }
}

function mapUpdateError(error: unknown): never {
  if (error instanceof ApiException) throw error
  if (error instanceof DictionaryValueUnavailableError) {
    throw productException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'PRODUCT_SUPPLIER_UNAVAILABLE',
      '供应商当前不可用',
      { supplierValue: ['供应商当前不可用'] },
    )
  }
  if (
    error instanceof CurrencyLookupError
    && error.reason !== 'PERSISTENCE_ERROR'
    && error.reason !== 'INPUT_INVALID'
  ) {
    throw productException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'PRODUCT_CURRENCY_UNAVAILABLE',
      '产品币种当前不可用',
    )
  }
  if (hasProductStateChangeCode(error)) throw stateChangedError()
  throw internalProductError()
}

function toCurrentProduct(row: ProductUpdateLockRecord): ProductUpdateCurrent {
  return {
    name: row.name,
    categoryName: row.categoryName,
    productHeadName: row.productHeadName,
    status: row.status,
    supplierValue: row.supplierValue,
    twdSalePrice: {
      amount: row.twdSalePriceAmount,
      currency: row.twdSalePriceCurrency,
    },
    myrSalePrice: {
      amount: row.myrSalePriceAmount,
      currency: row.myrSalePriceCurrency,
    },
    purchaseCost: {
      amount: row.purchaseCostAmount,
      currency: row.purchaseCostCurrency,
    },
    attributes: row.attributes,
  }
}

function buildUpdateData(
  command: NormalizedProductCreateCommand,
  changedFields: readonly string[],
  taxonomy: ResolvedProductTaxonomyIds | undefined,
): ProductUpdateRecordData {
  const changed = new Set(changedFields)
  const data: {
    -readonly [Key in keyof ProductUpdateRecordData]?: ProductUpdateRecordData[Key]
  } = {}

  if (changed.has('name')) data.name = command.name
  if (taxonomy !== undefined) {
    data.categoryId = taxonomy.categoryId
    data.productHeadId = taxonomy.productHeadId
  }
  if (changed.has('status')) data.status = command.status
  if (changed.has('supplierValue')) data.supplierValue = command.supplierValue
  if (changed.has('twdSalePrice')) {
    data.twdSalePriceAmount = command.twdSalePrice.amount
    data.twdSalePriceCurrency = command.twdSalePrice.currency
  }
  if (changed.has('myrSalePrice')) {
    data.myrSalePriceAmount = command.myrSalePrice.amount
    data.myrSalePriceCurrency = command.myrSalePrice.currency
  }
  if (changed.has('purchaseCost')) {
    data.purchaseCostAmount = command.purchaseCost.amount
    data.purchaseCostCurrency = command.purchaseCost.currency
  }
  if (changed.has('attributes')) data.attributes = command.attributes

  return data
}

/**
 * Product 编辑独立于创建幂等发号流程：不自动重试、不消费编号。所有变更均在
 * Product 行锁后规范化成完整目标，随后按目标状态校验依赖并原子写业务与审计。
 */
@Injectable()
export class ProductUpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaryLookup: DictionaryLookupService,
    private readonly currencyLookup: CurrencyLookupService,
    private readonly audit: AuditService,
    private readonly taxonomies: ProductTaxonomyService,
  ) {}

  async update(
    context: ProductUpdateContext,
    productId: string,
    input: unknown,
  ): Promise<ProductListItem> {
    const trusted = validateTrustedContext(context)
    const patch = normalizeProductUpdatePatch(input)

    try {
      return await this.prisma.$transaction(async (transaction) => {
        // timeout 必须是事务内第一条 SQL，外部输入不能放宽锁等待或语句执行上限。
        await applyTransactionTimeouts(transaction)
        const current = await readProductForUpdate(transaction, productId)
        if (current === null) {
          throw productException(
            HttpStatus.NOT_FOUND,
            'PRODUCT_NOT_FOUND',
            '产品不存在',
          )
        }
        // 即使最终是 no-op，也先拒绝 stale version，防止覆盖用户未看到的变化。
        if (current.version !== patch.expectedVersion) throw stateChangedError()

        const target = buildProductUpdateTarget(toCurrentProduct(current), patch)
        if (target.changedFields.length === 0) {
          return this.readResponse(transaction, productId)
        }

        if (
          target.command.status === ProductStatus.ACTIVE
          && current.status !== ProductStatus.ACTIVE
          && (
            target.command.categoryName === null
            || target.command.productHeadName === null
          )
        ) {
          throw productException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'VALIDATION_FAILED',
            '启用产品前必须补全分类与产品头',
            {
              categoryName: ['启用产品前必须补全分类'],
              productHeadName: ['启用产品前必须补全产品头'],
            },
          )
        }

        await this.requireChangedDependencies(
          transaction,
          target.command,
          target.changedFields,
        )
        const taxonomyChanged = (
          target.changedFields.includes('categoryName')
          || target.changedFields.includes('productHeadName')
          || target.changedFields.includes('supplierValue')
        )
        const taxonomy = taxonomyChanged
          ? await this.taxonomies.resolveOrCreateInTransaction(
              transaction,
              {
                actorUserId: trusted.actorUserId,
                requestId: trusted.requestId,
              },
              {
                supplierValue: target.command.supplierValue,
                categoryName: target.command.categoryName,
                productHeadName: target.command.productHeadName,
              },
            )
          : undefined
        await updateProductRecord(transaction, {
          productId,
          actorUserId: trusted.actorUserId,
          data: buildUpdateData(
            target.command,
            target.changedFields,
            taxonomy,
          ),
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.PRODUCT_UPDATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: trusted.actorUserId,
          targetType: 'PRODUCT',
          targetId: productId,
          requestId: trusted.requestId,
          metadata: {
            productNo: current.productNo,
            changedFields: target.changedFields.join(','),
            previousVersion: current.version,
            version: current.version + 1,
            previousStatus: current.status,
            status: target.command.status,
          },
        })

        return this.readResponse(transaction, productId)
      })
    }
    catch (error) {
      return mapUpdateError(error)
    }
  }

  private async requireChangedDependencies(
    transaction: Prisma.TransactionClient,
    command: NormalizedProductCreateCommand,
    changedFields: readonly string[],
  ): Promise<void> {
    const changed = new Set(changedFields)
    const validatesAll = command.status === ProductStatus.ACTIVE

    // 全局锁序保持 Supplier Type/Item -> Currency codes，避免跨业务更新形成反向锁序。
    if (validatesAll || changed.has('supplierValue')) {
      await this.dictionaryLookup.requireEffectiveValue(transaction, {
        dictionaryCode: SUPPLIER_DICTIONARY_CODE,
        value: command.supplierValue,
      })
    }

    const moneyFields = validatesAll
      ? [...MONEY_FIELDS]
      : MONEY_FIELDS.filter(field => changed.has(field))
    if (moneyFields.length === 0) return

    const currencies = await this.currencyLookup.requireEnabledCodes(
      transaction,
      moneyFields.map(field => command[field].currency),
    )
    const currenciesByCode = new Map(currencies.map(currency => [
      currency.code,
      currency,
    ]))
    for (const field of moneyFields) {
      assertMoneyPrecision(
        command[field],
        `${field}.amount`,
        currenciesByCode,
      )
    }
  }

  private async readResponse(
    transaction: Prisma.TransactionClient,
    productId: string,
  ): Promise<ProductListItem> {
    const row = await readProductUpdateResponse(transaction, productId)
    if (row === null) {
      throw new Error('Product update response invariant violated')
    }

    const supplierResolution = await this.resolveResponseSupplier(
      transaction,
      row,
    )
    const mediaRows = await readActiveProductMedia(transaction, [productId])
    return mapProductListItem(
      row,
      supplierResolution,
      mapProductMedia(productId, mediaRows),
    )
  }

  private async resolveResponseSupplier(
    transaction: Prisma.TransactionClient,
    row: ProductQueryRow,
  ) {
    return this.dictionaryLookup.resolveStoredValueInTransaction(transaction, {
      dictionaryCode: SUPPLIER_DICTIONARY_CODE,
      value: row.supplierValue,
    })
  }
}
