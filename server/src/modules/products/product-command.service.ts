import { HttpStatus, Injectable } from '@nestjs/common'

import type { Prisma } from '../../generated/prisma/client'
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
  CurrencyLookupError,
  CurrencyLookupService,
  type EffectiveCurrency,
} from '../currencies/currency-lookup.service'
import {
  DictionaryLookupService,
  DictionaryValueUnavailableError,
  type EffectiveDictionaryValue,
  type StoredDictionaryValueResolution,
} from '../dictionaries/dictionary-lookup.service'
import { NumberingGeneratorService } from '../numbering/numbering-generator.service'
import {
  NUMBERING_ERROR_CODES,
  NumberingGenerationError,
} from '../numbering/numbering.errors'
import {
  createProductRecord,
  isProductNumberUniqueViolation,
  readNextProductSortOrder,
  readProductByNumber,
} from './product-command.persistence'
import {
  isCanonicalProductActorId,
  normalizeProductCreateCommand,
  parseProductIdempotencyKey,
  type NormalizedProductCreateCommand,
  type NormalizedProductCreateMoney,
} from './product-command.normalizer'
import {
  calculateProductCreateFingerprint,
  PRODUCT_NUMBERING_CONSUMER_CODE,
  PRODUCT_NUMBERING_RULE_CODE,
} from './product-create-fingerprint'
import {
  mapProductMedia,
  readActiveProductMedia,
  type ProductMediaQueryRow,
} from './media/product-media-query.mapper'
import {
  mapProductListItem,
  type DecimalStringSource,
  type ProductListItem,
  type ProductQueryRow,
} from './product-query.mapper'
import { ProductTaxonomyService } from './product-taxonomy.service'

const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const REQUEST_ID_MAXIMUM_CODE_POINTS = 64
const PRODUCT_STATE_CHANGE_CODES = [
  'P2034',
  '40001',
  '40P01',
  '55P03',
  '57014',
] as const

export interface ProductCommandContext {
  /** AuthenticationGuard 写入的可信、canonical lowercase Session User id。 */
  readonly actorUserId: string
  /** request-id middleware 已校验的请求标识。 */
  readonly requestId: string
  /** Controller 从必填 Header 读取的 canonical lowercase UUID v4。 */
  readonly idempotencyKey: string
}

interface EffectiveProductDependencies {
  readonly supplier: EffectiveDictionaryValue
}

interface IssuedProductSnapshot {
  readonly mediaRows: readonly ProductMediaQueryRow[]
  readonly row: ProductQueryRow
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
    '产品依赖状态已变化，请重试',
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

function validateTrustedContext(context: ProductCommandContext): {
  readonly actorUserId: string
  readonly requestId: string
  readonly idempotencyKey: string
} {
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

  return {
    actorUserId: context.actorUserId,
    requestId: context.requestId,
    idempotencyKey: parseProductIdempotencyKey(context.idempotencyKey),
  }
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

function mapDependencyError(error: unknown): never {
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

function mapNumberingError(error: unknown): never {
  if (!(error instanceof NumberingGenerationError)) {
    throw internalProductError()
  }

  if (error.code === NUMBERING_ERROR_CODES.IDEMPOTENCY_CONFLICT) {
    throw productException(
      HttpStatus.CONFLICT,
      'PRODUCT_CREATE_IDEMPOTENCY_CONFLICT',
      '幂等键已用于不同的产品创建请求',
    )
  }
  if (error.code === NUMBERING_ERROR_CODES.OUTPUT_CONFLICT) {
    throw productException(
      HttpStatus.CONFLICT,
      'PRODUCT_NUMBER_CONFLICT',
      '产品编号发生冲突',
    )
  }
  if (
    error.code === NUMBERING_ERROR_CODES.RULE_STATE_CHANGED
    || error.code === NUMBERING_ERROR_CODES.GENERATION_RETRY_EXHAUSTED
  ) {
    throw stateChangedError()
  }
  if (
    error.code === NUMBERING_ERROR_CODES.RULE_NOT_FOUND
    || error.code === NUMBERING_ERROR_CODES.RULE_UNAVAILABLE
    || error.code === NUMBERING_ERROR_CODES.CAPACITY_EXHAUSTED
    || error.code === NUMBERING_ERROR_CODES.RULE_CONFIG_INVALID
  ) {
    throw productException(
      HttpStatus.CONFLICT,
      'PRODUCT_NUMBERING_UNAVAILABLE',
      '产品编号规则当前不可用',
    )
  }
  throw internalProductError()
}

function effectiveSupplierResolution(
  supplier: EffectiveDictionaryValue,
): StoredDictionaryValueResolution {
  return {
    known: true,
    dictionaryCode: supplier.dictionaryCode,
    value: supplier.value,
    label: supplier.label,
    tone: supplier.tone,
    typeEnabled: true,
    itemEnabled: true,
    effectiveEnabled: true,
  }
}

function persistedDecimalToCanonical(
  value: DecimalStringSource | null,
): string | null | undefined {
  if (value === null) return null

  try {
    const maybeFixed = value as DecimalStringSource & {
      toFixed?: (decimalPlaces: number) => string
    }
    const raw = typeof maybeFixed.toFixed === 'function'
      ? maybeFixed.toFixed(4)
      : value.toString()
    const match = /^(0|[1-9]\d*)(?:\.(\d{1,4}))?$/u.exec(raw)
    if (match === null || match[1] === undefined) return undefined
    return `${match[1]}.${(match[2] ?? '').padEnd(4, '0')}`
  }
  catch {
    return undefined
  }
}

/** 重放比较包含全部固定媒体、操作者与规范化业务值，避免编号绑定到其他 Product。 */
function productMatchesCommand(
  row: ProductQueryRow,
  command: NormalizedProductCreateCommand,
  actorUserId: string,
): boolean {
  return row.name === command.name
    && row.status === command.status
    && row.supplierValue === command.supplierValue
    && row.category?.name === command.categoryName
    && row.productHead?.name === command.productHeadName
    && persistedDecimalToCanonical(row.twdSalePriceAmount)
      === command.twdSalePrice.amount
    && row.twdSalePriceCurrency === command.twdSalePrice.currency
    && persistedDecimalToCanonical(row.myrSalePriceAmount)
      === command.myrSalePrice.amount
    && row.myrSalePriceCurrency === command.myrSalePrice.currency
    && persistedDecimalToCanonical(row.purchaseCostAmount)
      === command.purchaseCost.amount
    && row.purchaseCostCurrency === command.purchaseCost.currency
    && JSON.stringify(row.attributes) === JSON.stringify(command.attributes)
    && row.remark === command.remark
    && row.createdBy?.id === actorUserId
    && row.updatedBy?.id === actorUserId
    && row.version === 1
}

/**
 * Product 写服务拥有创建的完整事务边界。编号在独立事务提交，Product 与 Audit
 * 在另一事务原子提交；任何底层异常都在离开领域前映射为固定公共错误。
 */
@Injectable()
export class ProductCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaryLookup: DictionaryLookupService,
    private readonly currencyLookup: CurrencyLookupService,
    private readonly numbering: NumberingGeneratorService,
    private readonly audit: AuditService,
    private readonly taxonomies: ProductTaxonomyService,
  ) {}

  async create(
    context: ProductCommandContext,
    input: unknown,
  ): Promise<ProductListItem> {
    const trusted = validateTrustedContext(context)
    const command = normalizeProductCreateCommand(input)
    if (command.categoryName === null || command.productHeadName === null) {
      // HTTP DTO 已要求新增必填；此处防止内部调用绕过契约创建无分类产品。
      throw productException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        '请求参数校验失败',
        {
          categoryName: ['分类不能为空'],
          productHeadName: ['产品头不能为空'],
        },
      )
    }
    const requestFingerprint = calculateProductCreateFingerprint(
      trusted.actorUserId,
      command,
    )

    await this.runDependencyTransaction(command)

    let issuance: Awaited<ReturnType<NumberingGeneratorService['generateScoped']>>
    try {
      issuance = await this.numbering.generateScoped({
        ruleCode: PRODUCT_NUMBERING_RULE_CODE,
        consumerCode: PRODUCT_NUMBERING_CONSUMER_CODE,
        idempotencyKey: trusted.idempotencyKey,
        requestFingerprint,
      })
    }
    catch (error) {
      return mapNumberingError(error)
    }

    if (issuance.idempotentReplay) {
      const existing = await this.readIssuedProduct(issuance.number)
      if (existing !== null) {
        if (!productMatchesCommand(existing.row, command, trusted.actorUserId)) {
          throw productException(
            HttpStatus.CONFLICT,
            'PRODUCT_CREATE_IDEMPOTENCY_CONFLICT',
            '幂等键已用于不同的产品创建请求',
          )
        }
        return this.mapHistoricalProduct(existing)
      }
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const dependencies = await this.requireDependencies(transaction, command)
        const taxonomy = await this.taxonomies.resolveOrCreateInTransaction(
          transaction,
          {
            actorUserId: trusted.actorUserId,
            requestId: trusted.requestId,
          },
          {
            supplierValue: command.supplierValue,
            categoryName: command.categoryName,
            productHeadName: command.productHeadName,
          },
        )
        const row = await createProductRecord(transaction, {
          productNo: issuance.number,
          actorUserId: trusted.actorUserId,
          categoryId: taxonomy.categoryId,
          productHeadId: taxonomy.productHeadId,
          sortOrder: await readNextProductSortOrder(transaction, {
            productHeadId: taxonomy.productHeadId,
            supplierValue: command.supplierValue,
          }),
          command,
        })
        await this.audit.record(transaction, {
          eventType: AuditEventType.PRODUCT_CREATED,
          outcome: AuditOutcome.SUCCESS,
          actorType: AuditActorType.USER,
          actorUserId: trusted.actorUserId,
          targetType: 'PRODUCT',
          targetId: row.id,
          requestId: trusted.requestId,
          metadata: {
            productNo: issuance.number,
            status: command.status,
            supplierSelected: true,
            categorySelected: taxonomy.categoryId !== null,
            twdSalePriceProvided: command.twdSalePrice.amount !== null,
            myrSalePriceProvided: command.myrSalePrice.amount !== null,
            purchaseCostProvided: command.purchaseCost.amount !== null,
            attributeCount: command.attributes.length,
          },
        })

        return mapProductListItem(
          row,
          effectiveSupplierResolution(dependencies.supplier),
          mapProductMedia(row.id, []),
        )
      })
    }
    catch (error) {
      if (isProductNumberUniqueViolation(error)) {
        return this.recoverProductNumberRace(
          issuance.number,
          issuance.idempotentReplay,
          command,
          trusted.actorUserId,
        )
      }
      return mapDependencyError(error)
    }
  }

  private async runDependencyTransaction(
    command: NormalizedProductCreateCommand,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        await this.requireDependencies(transaction, command)
      })
    }
    catch (error) {
      return mapDependencyError(error)
    }
  }

  private async requireDependencies(
    transaction: Prisma.TransactionClient,
    command: NormalizedProductCreateCommand,
  ): Promise<EffectiveProductDependencies> {
    // 锁序固定为 Supplier Type/Item -> Currency code；供应商现为必填。
    const supplier = await this.dictionaryLookup.requireEffectiveValue(transaction, {
      dictionaryCode: SUPPLIER_DICTIONARY_CODE,
      value: command.supplierValue,
    })
    const currencies = await this.currencyLookup.requireEnabledCodes(
      transaction,
      [
        command.twdSalePrice.currency,
        command.myrSalePrice.currency,
        command.purchaseCost.currency,
      ],
    )
    const currenciesByCode = new Map(currencies.map(currency => [
      currency.code,
      currency,
    ]))

    assertMoneyPrecision(
      command.twdSalePrice,
      'twdSalePrice.amount',
      currenciesByCode,
    )
    assertMoneyPrecision(
      command.myrSalePrice,
      'myrSalePrice.amount',
      currenciesByCode,
    )
    assertMoneyPrecision(
      command.purchaseCost,
      'purchaseCost.amount',
      currenciesByCode,
    )
    return { supplier }
  }

  private async readIssuedProduct(productNo: string): Promise<IssuedProductSnapshot | null> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await applyTransactionTimeouts(transaction)
        const row = await readProductByNumber(transaction, productNo)
        if (row === null) return null
        const mediaRows = await readActiveProductMedia(transaction, [row.id])
        return { row, mediaRows }
      })
    }
    catch (error) {
      if (hasProductStateChangeCode(error)) throw stateChangedError()
      throw internalProductError()
    }
  }

  private async mapHistoricalProduct(
    snapshot: IssuedProductSnapshot,
  ): Promise<ProductListItem> {
    try {
      const { row } = snapshot
      const supplierResolution = await this.dictionaryLookup.resolveStoredValue({
        dictionaryCode: SUPPLIER_DICTIONARY_CODE,
        value: row.supplierValue,
      })
      return mapProductListItem(
        row,
        supplierResolution,
        mapProductMedia(row.id, snapshot.mediaRows),
      )
    }
    catch {
      throw internalProductError()
    }
  }

  private async recoverProductNumberRace(
    productNo: string,
    idempotentReplay: boolean,
    command: NormalizedProductCreateCommand,
    actorUserId: string,
  ): Promise<ProductListItem> {
    const existing = await this.readIssuedProduct(productNo)
    if (
      idempotentReplay
      && existing !== null
      && productMatchesCommand(existing.row, command, actorUserId)
    ) {
      return this.mapHistoricalProduct(existing)
    }
    throw productException(
      HttpStatus.CONFLICT,
      'PRODUCT_NUMBER_CONFLICT',
      '产品编号发生冲突',
    )
  }
}
