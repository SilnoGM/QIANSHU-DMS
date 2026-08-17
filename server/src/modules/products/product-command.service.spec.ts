import type { Prisma } from '../../generated/prisma/client'
import {
  AuditActorType,
  AuditEventType,
  AuditOutcome,
  DictionaryTone,
  ProductStatus,
} from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { ApiException } from '../../infrastructure/http/api.exception'
import type {
  AuditService,
  RecordAuditEventInput,
} from '../audit/audit.service'
import type {
  EffectiveCurrency,
} from '../currencies/currency-lookup.service'
import { CurrencyLookupError } from '../currencies/currency-lookup.service'
import type {
  DictionaryLookupService,
  EffectiveDictionaryValue,
  StoredDictionaryValueResolution,
} from '../dictionaries/dictionary-lookup.service'
import { DictionaryValueUnavailableError } from '../dictionaries/dictionary-lookup.service'
import type {
  GenerateNumberResult,
  NumberingGeneratorService,
} from '../numbering/numbering-generator.service'
import type { GenerateScopedNumberRequest } from '../numbering/numbering-internal-input'
import { NumberingGenerationError } from '../numbering/numbering.errors'
import type { ProductQueryRow } from './product-query.mapper'
import { ProductCommandService } from './product-command.service'

const ACTOR_ID = '11111111-1111-4111-8111-111111111111'
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222'

function createInput(): Record<string, unknown> {
  return {
    name: ' Product ',
    status: 'DRAFT',
    supplierValue: 'SUPPLIER_A',
    twdSalePrice: { amount: '10.20', currency: 'TWD' },
    myrSalePrice: { amount: null, currency: 'MYR' },
    purchaseCost: { amount: '5', currency: 'CNY' },
    attributes: [{ title: ' Color ', value: ' Red ' }],
  }
}

function createRow(overrides: Partial<ProductQueryRow> = {}): ProductQueryRow {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Product',
    productNo: 'P202608120001',
    status: ProductStatus.DRAFT,
    supplierValue: 'SUPPLIER_A',
    twdSalePriceAmount: { toString: () => '10.2000' },
    twdSalePriceCurrency: 'TWD',
    myrSalePriceAmount: null,
    myrSalePriceCurrency: 'MYR',
    purchaseCostAmount: { toString: () => '5.0000' },
    purchaseCostCurrency: 'CNY',
    attributes: [{ title: 'Color', value: 'Red' }],
    createdBy: { id: ACTOR_ID, displayName: 'Admin' },
    updatedBy: { id: ACTOR_ID, displayName: 'Admin' },
    version: 1,
    createdAt: new Date('2026-08-12T01:00:00.000Z'),
    updatedAt: new Date('2026-08-12T01:00:00.000Z'),
    ...overrides,
  }
}

interface Fixture {
  readonly service: ProductCommandService
  readonly events: string[]
  readonly transactions: jest.Mock<
    Promise<unknown>,
    [(transaction: Prisma.TransactionClient) => Promise<unknown>]
  >
  readonly requireEffectiveValue: jest.Mock<
    Promise<EffectiveDictionaryValue>,
    [Prisma.TransactionClient, { dictionaryCode: string; value: string }]
  >
  readonly requireEnabledCodes: jest.Mock<
    Promise<readonly EffectiveCurrency[]>,
    [Prisma.TransactionClient, readonly string[]]
  >
  readonly generateScoped: jest.Mock<
    Promise<GenerateNumberResult>,
    [Readonly<GenerateScopedNumberRequest>]
  >
  readonly auditRecord: jest.Mock<
    Promise<Record<string, never>>,
    [Prisma.TransactionClient, RecordAuditEventInput]
  >
  readonly productCreate: jest.Mock<Promise<ProductQueryRow>, [unknown]>
  readonly productFindUnique: jest.Mock<
    Promise<ProductQueryRow | null>,
    [unknown]
  >
  readonly resolveStoredValue: jest.Mock<
    Promise<StoredDictionaryValueResolution>,
    [{ dictionaryCode: string; value: string }]
  >
}

function createFixture(options: {
  readonly numberingReplay?: boolean
  readonly existingRows?: Array<ProductQueryRow | null>
} = {}): Fixture {
  const events: string[] = []
  const productCreate = jest.fn<Promise<ProductQueryRow>, [unknown]>(() => {
    events.push('product.create')
    return Promise.resolve(createRow())
  })
  const existingRows = [...(options.existingRows ?? [])]
  const productFindUnique = jest.fn<
    Promise<ProductQueryRow | null>,
    [unknown]
  >(() => {
    events.push('product.findUnique')
    return Promise.resolve(existingRows.shift() ?? null)
  })
  const productMediaFindMany = jest.fn<Promise<unknown[]>, [unknown]>(() => {
    events.push('product.media')
    return Promise.resolve([])
  })
  const transactionClient = {
    $queryRaw: jest.fn(() => {
      events.push('timeout')
      return Promise.resolve([])
    }),
    product: {
      create: productCreate,
      findUnique: productFindUnique,
    },
    productMedia: { findMany: productMediaFindMany },
  } as unknown as Prisma.TransactionClient
  const transactions = jest.fn<
    Promise<unknown>,
    [(transaction: Prisma.TransactionClient) => Promise<unknown>]
  >((operation) => {
    events.push('transaction')
    return operation(transactionClient)
  })
  const requireEffectiveValue = jest.fn<
    Promise<EffectiveDictionaryValue>,
    [Prisma.TransactionClient, { dictionaryCode: string; value: string }]
  >(() => {
    events.push('supplier')
    return Promise.resolve({
      dictionaryCode: 'service_provider.supplier',
      value: 'SUPPLIER_A',
      label: '供应商 A',
      tone: DictionaryTone.SUCCESS,
    })
  })
  const requireEnabledCodes = jest.fn<
    Promise<readonly EffectiveCurrency[]>,
    [Prisma.TransactionClient, readonly string[]]
  >(() => {
    events.push('currency')
    return Promise.resolve([
      { code: 'CNY', minorUnit: 2 },
      { code: 'MYR', minorUnit: 2 },
      { code: 'TWD', minorUnit: 2 },
    ])
  })
  const generateScoped = jest.fn<
    Promise<GenerateNumberResult>,
    [Readonly<GenerateScopedNumberRequest>]
  >(() => {
    events.push('number')
    return Promise.resolve({
      number: 'P202608120001',
      ruleCode: 'PRODUCT',
      ruleRevision: 1,
      issuedAt: '2026-08-12T01:00:00.000Z',
      idempotentReplay: options.numberingReplay ?? false,
    })
  })
  const auditRecord = jest.fn<
    Promise<Record<string, never>>,
    [Prisma.TransactionClient, RecordAuditEventInput]
  >(() => {
    events.push('audit')
    return Promise.resolve({})
  })
  const resolveStoredValue = jest.fn<
    Promise<StoredDictionaryValueResolution>,
    [{ dictionaryCode: string; value: string }]
  >(() => Promise.resolve({
    known: true as const,
    dictionaryCode: 'service_provider.supplier',
    value: 'SUPPLIER_A',
    label: '供应商 A',
    tone: DictionaryTone.SUCCESS,
    typeEnabled: false,
    itemEnabled: false,
    effectiveEnabled: false,
  }))

  return {
    service: new ProductCommandService(
      { $transaction: transactions } as unknown as PrismaService,
      {
        requireEffectiveValue,
        resolveStoredValue,
      } as unknown as DictionaryLookupService,
      { requireEnabledCodes },
      { generateScoped } as unknown as NumberingGeneratorService,
      { record: auditRecord } as unknown as AuditService,
    ),
    events,
    transactions,
    requireEffectiveValue,
    requireEnabledCodes,
    generateScoped,
    auditRecord,
    productCreate,
    productFindUnique,
    resolveStoredValue,
  }
}

function createProduct(fixture: Fixture, input = createInput()) {
  return fixture.service.create({
    actorUserId: ACTOR_ID,
    requestId: 'request-1',
    idempotencyKey: IDEMPOTENCY_KEY,
  }, input)
}

async function captureApiException(
  operation: Promise<unknown>,
): Promise<ApiException> {
  let thrown: unknown
  try {
    await operation
  }
  catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(ApiException)
  return thrown as ApiException
}

describe('ProductCommandService', () => {
  it('runs preflight before numbering, revalidates, writes and audits atomically', async () => {
    const fixture = createFixture()

    await expect(createProduct(fixture)).resolves.toMatchObject({
      productNo: 'P202608120001',
      supplier: {
        value: 'SUPPLIER_A',
        label: '供应商 A',
        state: 'EFFECTIVE',
      },
    })

    expect(fixture.events).toEqual([
      'transaction',
      'timeout',
      'supplier',
      'currency',
      'number',
      'transaction',
      'timeout',
      'supplier',
      'currency',
      'product.create',
      'audit',
    ])
    const numberingInput = fixture.generateScoped.mock.calls[0]?.[0]
    expect(numberingInput).toEqual({
      ruleCode: 'PRODUCT',
      consumerCode: 'PRODUCT.CREATE',
      idempotencyKey: IDEMPOTENCY_KEY,
      requestFingerprint: numberingInput?.requestFingerprint,
    })
    expect(numberingInput?.requestFingerprint).toMatch(/^[0-9a-f]{64}$/u)
    const auditInput = fixture.auditRecord.mock.calls[0]?.[1]
    expect(auditInput).toEqual({
        eventType: AuditEventType.PRODUCT_CREATED,
        outcome: AuditOutcome.SUCCESS,
        actorType: AuditActorType.USER,
        actorUserId: ACTOR_ID,
        targetType: 'PRODUCT',
        targetId: '33333333-3333-4333-8333-333333333333',
        requestId: 'request-1',
        metadata: {
          productNo: 'P202608120001',
          status: ProductStatus.DRAFT,
          supplierSelected: true,
          twdSalePriceProvided: true,
          myrSalePriceProvided: false,
          purchaseCostProvided: true,
          attributeCount: 1,
        },
    })
    expect(JSON.stringify(auditInput))
      .not.toContain('SUPPLIER_A')
    expect(JSON.stringify(auditInput))
      .not.toContain('10.20')
    expect(JSON.stringify(auditInput))
      .not.toContain(IDEMPOTENCY_KEY)
  })

  it('rejects validation and dependency failures before issuing a number', async () => {
    const invalid = createFixture()
    await expect(createProduct(invalid, {
      ...createInput(),
      status: 'ACTIVE',
      supplierValue: null,
    })).rejects.toMatchObject({ code: 'PRODUCT_SUPPLIER_REQUIRED' })
    expect(invalid.transactions).not.toHaveBeenCalled()
    expect(invalid.generateScoped).not.toHaveBeenCalled()

    const precision = createFixture()
    precision.requireEnabledCodes.mockResolvedValue([
      { code: 'CNY', minorUnit: 2 },
      { code: 'MYR', minorUnit: 2 },
      { code: 'TWD', minorUnit: 1 },
    ])
    const precisionError = await captureApiException(createProduct(precision))
    expect(precisionError.code).toBe('VALIDATION_FAILED')
    expect(precisionError.fieldErrors?.['twdSalePrice.amount'])
      .toEqual(['小数位超过当前币种精度'])
    expect(precision.generateScoped).not.toHaveBeenCalled()
  })

  it('returns an exact replay without a second dependency check or audit', async () => {
    const fixture = createFixture({
      numberingReplay: true,
      existingRows: [createRow()],
    })

    await expect(createProduct(fixture)).resolves.toMatchObject({
      productNo: 'P202608120001',
      supplier: { state: 'DISABLED' },
    })
    expect(fixture.events).toEqual([
      'transaction',
      'timeout',
      'supplier',
      'currency',
      'number',
      'transaction',
      'timeout',
      'product.findUnique',
      'product.media',
    ])
    expect(fixture.resolveStoredValue).toHaveBeenCalledTimes(1)
    expect(fixture.productCreate).not.toHaveBeenCalled()
    expect(fixture.auditRecord).not.toHaveBeenCalled()
  })

  it('continues from an issuance gap but keeps the issued number on second validation failure', async () => {
    const replayGap = createFixture({
      numberingReplay: true,
      existingRows: [null],
    })
    replayGap.requireEffectiveValue
      .mockResolvedValueOnce({
        dictionaryCode: 'service_provider.supplier',
        value: 'SUPPLIER_A',
        label: '供应商 A',
        tone: DictionaryTone.SUCCESS,
      })
      .mockRejectedValueOnce(
        new DictionaryValueUnavailableError('DICTIONARY_ITEM_DISABLED'),
      )

    await expect(createProduct(replayGap)).rejects.toMatchObject({
      code: 'PRODUCT_SUPPLIER_UNAVAILABLE',
      publicMessage: '供应商当前不可用',
    })
    expect(replayGap.generateScoped).toHaveBeenCalledTimes(1)
    expect(replayGap.productCreate).not.toHaveBeenCalled()
    expect(replayGap.auditRecord).not.toHaveBeenCalled()
  })

  it('rejects replay payload drift and maps numbering errors to Product errors', async () => {
    const drift = createFixture({
      numberingReplay: true,
      existingRows: [createRow({ name: 'Changed' })],
    })
    await expect(createProduct(drift)).rejects.toMatchObject({
      code: 'PRODUCT_CREATE_IDEMPOTENCY_CONFLICT',
    })
    expect(drift.auditRecord).not.toHaveBeenCalled()

    const unavailable = createFixture()
    unavailable.generateScoped.mockRejectedValue(
      new NumberingGenerationError('NUMBERING_RULE_UNAVAILABLE'),
    )
    const unavailableError = await captureApiException(
      createProduct(unavailable),
    )
    expect(unavailableError.code).toBe('PRODUCT_NUMBERING_UNAVAILABLE')
    expect(unavailableError.publicMessage).not.toContain('NUMBERING')
  })

  it('recovers a trusted same-key product-number race without a second audit', async () => {
    const fixture = createFixture({
      numberingReplay: true,
      existingRows: [null, createRow()],
    })
    fixture.productCreate.mockRejectedValue({
      code: 'P2002',
      meta: { constraint: 'products_product_no_key' },
    })

    await expect(createProduct(fixture)).resolves.toMatchObject({
      productNo: 'P202608120001',
      supplier: { state: 'DISABLED' },
    })
    expect(fixture.productFindUnique).toHaveBeenCalledTimes(2)
    expect(fixture.auditRecord).not.toHaveBeenCalled()
  })

  it('fails closed for untrusted number collisions and audit failures', async () => {
    const collision = createFixture({
      existingRows: [createRow()],
    })
    collision.productCreate.mockRejectedValue({
      code: '23505',
      constraint: 'products_product_no_key',
    })
    await expect(createProduct(collision)).rejects.toMatchObject({
      code: 'PRODUCT_NUMBER_CONFLICT',
    })

    const auditFailure = createFixture()
    auditFailure.auditRecord.mockRejectedValue(
      new Error('audit database secret'),
    )
    await expect(createProduct(auditFailure)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      publicMessage: '服务器内部错误',
    })
    expect(auditFailure.productCreate).toHaveBeenCalledTimes(1)
  })

  it('rechecks minorUnit after numbering and never writes when configuration changes', async () => {
    const fixture = createFixture()
    fixture.requireEnabledCodes
      .mockResolvedValueOnce([
        { code: 'CNY', minorUnit: 2 },
        { code: 'MYR', minorUnit: 2 },
        { code: 'TWD', minorUnit: 2 },
      ])
      .mockResolvedValueOnce([
        { code: 'CNY', minorUnit: 2 },
        { code: 'MYR', minorUnit: 2 },
        { code: 'TWD', minorUnit: 1 },
      ])

    const error = await captureApiException(createProduct(fixture))
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.fieldErrors?.['twdSalePrice.amount'])
      .toEqual(['小数位超过当前币种精度'])
    expect(fixture.generateScoped).toHaveBeenCalledTimes(1)
    expect(fixture.productCreate).not.toHaveBeenCalled()
    expect(fixture.auditRecord).not.toHaveBeenCalled()
  })

  it('skips supplier lookup for null supplier but still validates every currency', async () => {
    const fixture = createFixture()
    fixture.productCreate.mockResolvedValue(createRow({ supplierValue: null }))
    await expect(createProduct(fixture, {
      ...createInput(),
      supplierValue: null,
    })).resolves.toMatchObject({ supplier: null })

    expect(fixture.requireEffectiveValue).not.toHaveBeenCalled()
    expect(fixture.requireEnabledCodes).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      ['TWD', 'MYR', 'CNY'],
    )
    expect(fixture.requireEnabledCodes).toHaveBeenCalledTimes(2)
  })

  it('maps preflight dependency and transaction failures without issuing a number', async () => {
    const supplier = createFixture()
    supplier.requireEffectiveValue.mockRejectedValue(
      new DictionaryValueUnavailableError('DICTIONARY_TYPE_DISABLED'),
    )
    await expect(createProduct(supplier)).rejects.toMatchObject({
      code: 'PRODUCT_SUPPLIER_UNAVAILABLE',
      fieldErrors: { supplierValue: ['供应商当前不可用'] },
    })
    expect(supplier.generateScoped).not.toHaveBeenCalled()

    const currency = createFixture()
    currency.requireEnabledCodes.mockRejectedValue(
      new CurrencyLookupError('CURRENCY_DISABLED'),
    )
    await expect(createProduct(currency)).rejects.toMatchObject({
      code: 'PRODUCT_CURRENCY_UNAVAILABLE',
    })
    expect(currency.generateScoped).not.toHaveBeenCalled()

    const stateChange = createFixture()
    stateChange.transactions.mockRejectedValueOnce({ code: 'P2034' })
    await expect(createProduct(stateChange)).rejects.toMatchObject({
      code: 'PRODUCT_STATE_CHANGED',
    })
    expect(stateChange.generateScoped).not.toHaveBeenCalled()
  })

  it.each([
    ['NUMBERING_RULE_NOT_FOUND', 'PRODUCT_NUMBERING_UNAVAILABLE'],
    ['NUMBERING_RULE_UNAVAILABLE', 'PRODUCT_NUMBERING_UNAVAILABLE'],
    ['NUMBERING_CAPACITY_EXHAUSTED', 'PRODUCT_NUMBERING_UNAVAILABLE'],
    ['NUMBERING_RULE_CONFIG_INVALID', 'PRODUCT_NUMBERING_UNAVAILABLE'],
    ['NUMBERING_RULE_STATE_CHANGED', 'PRODUCT_STATE_CHANGED'],
    ['NUMBERING_GENERATION_RETRY_EXHAUSTED', 'PRODUCT_STATE_CHANGED'],
    ['NUMBERING_OUTPUT_CONFLICT', 'PRODUCT_NUMBER_CONFLICT'],
    ['NUMBERING_IDEMPOTENCY_CONFLICT', 'PRODUCT_CREATE_IDEMPOTENCY_CONFLICT'],
    ['INTERNAL_ERROR', 'INTERNAL_ERROR'],
    ['VALIDATION_FAILED', 'INTERNAL_ERROR'],
  ] as const)('maps numbering %s to %s', async (numberingCode, productCode) => {
    const fixture = createFixture()
    fixture.generateScoped.mockRejectedValue(
      new NumberingGenerationError(numberingCode),
    )

    await expect(createProduct(fixture)).rejects.toMatchObject({
      code: productCode,
    })
    expect(fixture.productCreate).not.toHaveBeenCalled()
    expect(fixture.auditRecord).not.toHaveBeenCalled()
  })
})
