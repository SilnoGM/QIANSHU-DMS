import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Response } from 'supertest'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { DictionaryTone } from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuditService } from '../src/modules/audit/audit.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
import { CurrencyLookupService } from '../src/modules/currencies/currency-lookup.service'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'
import { calculateIdempotencyKeyHash } from '../src/modules/numbering/numbering-internal-input'
import { ProductCommandService } from '../src/modules/products/product-command.service'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const PRODUCT_NUMBER_PREFIX = 'PRD-E2E-'
const PRODUCT_RULE_CODE = 'PRODUCT'
const PRODUCT_CONSUMER_CODE = 'PRODUCT.CREATE'

export interface ProductCreateBody {
  readonly name: string
  readonly categoryName: string
  readonly productHeadName: string
  readonly status: 'ACTIVE' | 'DRAFT' | 'INACTIVE'
  readonly supplierValue: string | null
  readonly twdSalePrice: {
    readonly amount: string | null
    readonly currency: 'TWD'
  }
  readonly myrSalePrice: {
    readonly amount: string | null
    readonly currency: 'MYR'
  }
  readonly purchaseCost: {
    readonly amount: string | null
    readonly currency: string
  }
  readonly attributes: ReadonlyArray<{
    readonly title: string
    readonly value: string
  }>
}

interface ProductResponseBody {
  readonly id: string
  readonly name: string
  readonly categoryName: string | null
  readonly productHeadName: string | null
  readonly productNo: string
  readonly status: string
  readonly supplier: {
    readonly value: string
    readonly label: string | null
    readonly tone: DictionaryTone | null
    readonly state: string
  } | null
  readonly media: {
    readonly mainImage: null
    readonly images: readonly unknown[]
    readonly videos: readonly unknown[]
  }
  readonly twdSalePrice: { readonly amount: string | null; readonly currency: string }
  readonly myrSalePrice: { readonly amount: string | null; readonly currency: string }
  readonly purchaseCost: { readonly amount: string | null; readonly currency: string }
  readonly attributes: Array<{ readonly title: string; readonly value: string }>
  readonly createdBy: { readonly id: string; readonly displayName: string } | null
  readonly updatedBy: { readonly id: string; readonly displayName: string } | null
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

interface AuthContextBody {
  readonly permissions: string[]
}

interface NumberingRuleBody {
  readonly id: string
  readonly version: number
}

interface OriginalCurrencyState {
  readonly id: string
  readonly code: 'TWD' | 'MYR'
  readonly enabled: boolean
}

export interface TestAccount {
  readonly browser: ReturnType<typeof request.agent>
  readonly userId: string
}

export interface CreateProductRequest {
  readonly browser: ReturnType<typeof request.agent>
  readonly idempotencyKey?: string
  readonly body: object | string
  readonly includeCsrf?: boolean
}

function responseBody<T>(response: { readonly body: unknown }): T {
  return response.body as T
}

function requireResponseHeader(response: Response, name: string): string {
  const value = response.headers[name.toLowerCase()]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing response header ${name}`)
  }
  return value
}

function idempotencyKeyHash(idempotencyKey: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(calculateIdempotencyKeyHash(idempotencyKey))
}

async function createAccountFixture(input: {
  readonly application: INestApplication
  readonly mustChangePassword?: boolean
  readonly passwords: PasswordProvider
  readonly prisma: PrismaService
  readonly systemAdmin?: boolean
}): Promise<TestAccount> {
  const suffix = randomUUID()
  const username = `product-create-e2e-${suffix}`
  const password = `Product-${suffix.slice(0, 12)}`
  const user = await input.prisma.user.create({
    data: {
      username,
      usernameNormalized: username,
      displayName: '产品创建 E2E 用户',
      passwordHash: await input.passwords.hash(password),
      passwordChangedAt: new Date(),
      mustChangePassword: input.mustChangePassword ?? false,
      profile: { create: {} },
    },
  })

  if (input.systemAdmin === true) {
    const role = await input.prisma.role.findUniqueOrThrow({
      where: { code: 'system_admin' },
    })
    await input.prisma.userRole.create({
      data: { userId: user.id, roleId: role.id },
    })
  }

  const browser = request.agent(input.application.getHttpServer())
  const login = await browser
    .post('/api/auth/login')
    .set(CSRF_HEADERS)
    .send({ username, password })
    .expect(200)
  if (input.systemAdmin === true) {
    expect(responseBody<AuthContextBody>(login).permissions)
      .toEqual(expect.arrayContaining(['products:create', 'products:read']))
  }
  return { browser, userId: user.id }
}

/**
 * Product 创建 E2E 的唯一 fixture。它只运行在官方 Docker PostgreSQL wrapper
 * 注入的数据库中；Rule ledger 留给一次性容器销毁，其余跨 suite 可见数据在
 * dispose 中恢复，避免影响同一 E2E 进程的其他测试文件。
 */
export class ProductCreateE2eHarness {
  readonly anonymousBrowser: ReturnType<typeof request.agent>
  readonly audit: AuditService
  readonly creatorBrowser: ReturnType<typeof request.agent>
  readonly creatorUserId: string
  readonly currencyLookup: CurrencyLookupService
  readonly dictionaryLookup: DictionaryLookupService
  readonly productCommands: ProductCommandService
  readonly supplierValue: string
  readonly fallbackSupplierValue: string

  private readonly createdUserIds = new Set<string>()
  private disposed = false
  private productRuleId: string | null = null
  private productRuleVersion: number | null = null

  private constructor(
    private readonly application: INestApplication,
    readonly prisma: PrismaService,
    private readonly passwords: PasswordProvider,
    creator: TestAccount,
    private readonly supplierDictionaryTypeId: string,
    private readonly originalSupplierTypeEnabled: boolean,
    private readonly originalCurrencyStates: readonly OriginalCurrencyState[],
    supplierValue: string,
    fallbackSupplierValue: string,
  ) {
    this.anonymousBrowser = request.agent(application.getHttpServer())
    this.audit = application.get(AuditService)
    this.creatorBrowser = creator.browser
    this.creatorUserId = creator.userId
    this.currencyLookup = application.get(CurrencyLookupService)
    this.dictionaryLookup = application.get(DictionaryLookupService)
    this.productCommands = application.get(ProductCommandService)
    this.supplierValue = supplierValue
    this.fallbackSupplierValue = fallbackSupplierValue
    this.createdUserIds.add(creator.userId)
  }

  static async start(): Promise<ProductCreateE2eHarness> {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    const application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()

    const prisma = application.get(PrismaService)
    const passwords = application.get(PasswordProvider)
    const [initialProducts, initialProductRules, initialProductAudits] =
      await Promise.all([
        prisma.product.count(),
        prisma.numberingRule.count({ where: { ruleCode: PRODUCT_RULE_CODE } }),
        prisma.auditEvent.count({ where: { eventType: 'PRODUCT_CREATED' } }),
      ])
    if (
      initialProducts !== 0
      || initialProductRules !== 0
      || initialProductAudits !== 0
    ) {
      throw new Error('Product migrations must not seed business data')
    }
    const supplierType = await prisma.dictionaryType.findUniqueOrThrow({
      where: { code: SUPPLIER_DICTIONARY_CODE },
    })
    const originalCurrencyStates = await prisma.currency.findMany({
      where: { code: { in: ['TWD', 'MYR'] } },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, enabled: true },
    }) as OriginalCurrencyState[]
    if (originalCurrencyStates.length !== 2) {
      throw new Error('Product E2E requires seeded TWD and MYR currencies')
    }
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
    const supplierValue = `PRODUCT_CREATE_${suffix}_A`
    const fallbackSupplierValue = `PRODUCT_CREATE_${suffix}_B`

    let harness: ProductCreateE2eHarness | undefined
    try {
      await prisma.$transaction(async (transaction) => {
        await transaction.dictionaryItem.createMany({
          data: [
            {
              dictionaryTypeId: supplierType.id,
              value: supplierValue,
              label: '产品创建供应商',
              tone: DictionaryTone.SUCCESS,
              enabled: true,
              sortOrder: 10,
            },
            {
              dictionaryTypeId: supplierType.id,
              value: fallbackSupplierValue,
              label: '产品创建备用供应商',
              tone: DictionaryTone.INFO,
              enabled: true,
              sortOrder: 20,
            },
          ],
        })
        await transaction.dictionaryType.update({
          where: { id: supplierType.id },
          data: { enabled: true },
        })
        // 官方 wrapper 每次从完整 migration 建立一次性数据库；先配置测试汇率，
        // 再启用外币，满足 Currency 的延迟一致性约束。
        await transaction.exchangeRate.createMany({
          data: originalCurrencyStates.map(currency => ({
            currencyId: currency.id,
            foreignUnitsPerCny: '1',
          })),
        })
        await transaction.currency.updateMany({
          where: { code: { in: ['TWD', 'MYR'] } },
          data: { enabled: true },
        })
      })

      const creator = await createAccountFixture({
        application,
        prisma,
        passwords,
        systemAdmin: true,
      })
      harness = new ProductCreateE2eHarness(
        application,
        prisma,
        passwords,
        creator,
        supplierType.id,
        supplierType.enabled,
        originalCurrencyStates,
        supplierValue,
        fallbackSupplierValue,
      )
      return harness
    }
    catch (error) {
      await harness?.dispose().catch(() => undefined)
      await application.close().catch(() => undefined)
      throw error
    }
  }

  validBody(overrides: Partial<ProductCreateBody> = {}): ProductCreateBody {
    return {
      name: ' Product E2E ',
      categoryName: ' 农机 ',
      productHeadName: ' 旱地履带 ',
      status: 'ACTIVE',
      supplierValue: this.supplierValue,
      twdSalePrice: { amount: '1280.50', currency: 'TWD' },
      myrSalePrice: { amount: null, currency: 'MYR' },
      purchaseCost: { amount: '88.10', currency: 'CNY' },
      attributes: [
        { title: ' Color ', value: ' Re\u0301d ' },
        { title: 'Color', value: 'Blue' },
      ],
      ...overrides,
    }
  }

  async createAccount(options: {
    readonly mustChangePassword?: boolean
    readonly systemAdmin?: boolean
  } = {}): Promise<TestAccount> {
    const account = await createAccountFixture({
      application: this.application,
      prisma: this.prisma,
      passwords: this.passwords,
      ...options,
    })
    this.createdUserIds.add(account.userId)
    return account
  }

  createProduct(input: CreateProductRequest): Promise<Response> {
    let productRequest = input.browser
      .post('/api/products')
      .send(input.body)
    if (input.includeCsrf !== false) {
      productRequest = productRequest.set(CSRF_HEADERS)
    }
    if (input.idempotencyKey !== undefined) {
      productRequest = productRequest.set(
        'Idempotency-Key',
        input.idempotencyKey,
      )
    }
    return productRequest
  }

  async createProductRuleDraft(): Promise<void> {
    if (this.productRuleId !== null) {
      throw new Error('Product E2E rule already exists')
    }
    const createdResponse = await this.creatorBrowser
      .post('/api/numbering-rules')
      .set(CSRF_HEADERS)
      .send({
        ruleCode: PRODUCT_RULE_CODE,
        purpose: 'BUSINESS',
        name: 'Product E2E Rule',
        resetPolicy: 'NEVER',
        segments: [
          { type: 'FIXED', value: 'PRD' },
          { type: 'SEPARATOR', value: '-' },
          { type: 'FIXED', value: 'E2E' },
          { type: 'SEPARATOR', value: '-' },
          { type: 'SEQUENCE', width: 8, startValue: '1', step: '1' },
        ],
      })
      .expect(201)
    const rule = responseBody<NumberingRuleBody>(createdResponse)
    expect(rule.version).toBe(1)
    this.productRuleId = rule.id
    this.productRuleVersion = rule.version
  }

  async publishProductRule(): Promise<void> {
    const ruleId = this.requireProductRuleId()
    const expectedVersion = this.requireProductRuleVersion()
    const response = await this.creatorBrowser
      .post(`/api/numbering-rules/${ruleId}/publish`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion, draftRevision: 1 })
      .expect(200)
    this.productRuleVersion = responseBody<NumberingRuleBody>(response).version
  }

  async enableProductRule(): Promise<void> {
    const ruleId = this.requireProductRuleId()
    const expectedVersion = this.requireProductRuleVersion()
    const response = await this.creatorBrowser
      .post(`/api/numbering-rules/${ruleId}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion })
      .expect(200)
    this.productRuleVersion = responseBody<NumberingRuleBody>(response).version
  }

  async setSupplierEnabled(enabled: boolean): Promise<void> {
    await this.prisma.dictionaryItem.update({
      where: {
        dictionaryTypeId_value: {
          dictionaryTypeId: this.supplierDictionaryTypeId,
          value: this.supplierValue,
        },
      },
      data: { enabled },
    })
  }

  async setCurrencyEnabled(code: 'TWD' | 'MYR', enabled: boolean): Promise<void> {
    await this.prisma.currency.update({
      where: { code },
      data: { enabled },
    })
  }

  async exhaustProductRuleCapacity(): Promise<void> {
    const result = await this.prisma.numberingPeriodState.updateMany({
      where: { ruleId: this.requireProductRuleId() },
      data: {
        usedCount: 99_999_999n,
        nextSequenceValue: null,
      },
    })
    if (result.count !== 1) {
      throw new Error('Product E2E rule period state is unavailable')
    }
  }

  async expectSuccessfulProductState(
    response: Response,
    input: {
      readonly idempotencyKey: string
      readonly expectedActorId: string
    },
  ): Promise<void> {
    const body = responseBody<ProductResponseBody>(response)
    expect(body).toMatchObject({
      name: 'Product E2E',
      categoryName: '农机',
      productHeadName: '旱地履带',
      status: 'ACTIVE',
      supplier: {
        value: this.supplierValue,
        label: '产品创建供应商',
        tone: DictionaryTone.SUCCESS,
        state: 'EFFECTIVE',
      },
      media: { mainImage: null, images: [], videos: [] },
      twdSalePrice: { amount: '1280.5', currency: 'TWD' },
      myrSalePrice: { amount: null, currency: 'MYR' },
      purchaseCost: { amount: '88.1', currency: 'CNY' },
      attributes: [
        { title: 'Color', value: 'Réd' },
        { title: 'Color', value: 'Blue' },
      ],
      createdBy: { id: input.expectedActorId },
      updatedBy: { id: input.expectedActorId },
      version: 1,
    })
    expect(body.productNo).toMatch(/^PRD-E2E-\d{8}$/u)
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt)
    expect(new Date(body.updatedAt).toISOString()).toBe(body.updatedAt)

    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: body.id },
    })
    expect(product).toMatchObject({
      name: 'Product E2E',
      categoryName: '农机',
      productHeadName: '旱地履带',
      productNo: body.productNo,
      status: 'ACTIVE',
      supplierValue: this.supplierValue,
      twdSalePriceCurrency: 'TWD',
      myrSalePriceAmount: null,
      myrSalePriceCurrency: 'MYR',
      purchaseCostCurrency: 'CNY',
      attributes: [
        { title: 'Color', value: 'Réd' },
        { title: 'Color', value: 'Blue' },
      ],
      createdByUserId: input.expectedActorId,
      updatedByUserId: input.expectedActorId,
      version: 1,
    })
    expect(product).not.toHaveProperty('mainImage')
    expect(product).not.toHaveProperty('images')
    expect(product).not.toHaveProperty('videos')
    expect(product.twdSalePriceAmount?.toFixed(4)).toBe('1280.5000')
    expect(product.purchaseCostAmount?.toFixed(4)).toBe('88.1000')

    const issuanceCount = await this.prisma.numberingIssuance.count({
      where: {
        consumerCode: PRODUCT_CONSUMER_CODE,
        idempotencyKeyHash: idempotencyKeyHash(input.idempotencyKey),
      },
    })
    expect(issuanceCount).toBe(1)

    const audits = await this.prisma.auditEvent.findMany({
      where: {
        eventType: 'PRODUCT_CREATED',
        targetType: 'PRODUCT',
        targetId: body.id,
      },
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      outcome: 'SUCCESS',
      actorType: 'USER',
      actorUserId: input.expectedActorId,
      requestId: requireResponseHeader(response, 'X-Request-Id'),
      metadata: {
        productNo: body.productNo,
        status: 'ACTIVE',
        supplierSelected: true,
        twdSalePriceProvided: true,
        myrSalePriceProvided: false,
        purchaseCostProvided: true,
        attributeCount: 2,
      },
    })
    const serializedAudit = JSON.stringify(audits[0])
    expect(serializedAudit).not.toContain(this.supplierValue)
    expect(serializedAudit).not.toContain('1280')
    expect(serializedAudit).not.toContain('Réd')
    expect(serializedAudit).not.toContain(input.idempotencyKey)
  }

  async countCreateState(idempotencyKey: string): Promise<{
    readonly audits: number
    readonly issuances: number
    readonly products: number
  }> {
    const [audits, issuances, products] = await Promise.all([
      this.prisma.auditEvent.count({
        where: { eventType: 'PRODUCT_CREATED' },
      }),
      this.prisma.numberingIssuance.count({
        where: {
          consumerCode: PRODUCT_CONSUMER_CODE,
          idempotencyKeyHash: idempotencyKeyHash(idempotencyKey),
        },
      }),
      this.prisma.product.count({
        where: { productNo: { startsWith: PRODUCT_NUMBER_PREFIX } },
      }),
    ])
    return { audits, issuances, products }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    try {
      await this.prisma.product.deleteMany({
        where: { productNo: { startsWith: PRODUCT_NUMBER_PREFIX } },
      })
      const userIds = [...this.createdUserIds]
      if (userIds.length > 0) {
        await this.prisma.auditEvent.deleteMany({
          where: { actorUserId: { in: userIds } },
        })
        await this.prisma.user.deleteMany({ where: { id: { in: userIds } } })
      }
      await this.prisma.$transaction(async (transaction) => {
        for (const currency of this.originalCurrencyStates) {
          await transaction.currency.update({
            where: { code: currency.code },
            data: { enabled: currency.enabled },
          })
        }
        await transaction.exchangeRate.deleteMany({
          where: {
            currencyId: {
              in: this.originalCurrencyStates.map(currency => currency.id),
            },
          },
        })
        await transaction.dictionaryType.update({
          where: { id: this.supplierDictionaryTypeId },
          data: { enabled: this.originalSupplierTypeEnabled },
        })
        await transaction.$executeRawUnsafe(
          'ALTER TABLE "dictionary_items" DISABLE TRIGGER "dictionary_items_invariants_trigger"',
        )
        await transaction.dictionaryItem.deleteMany({
          where: {
            dictionaryTypeId: this.supplierDictionaryTypeId,
            value: { in: [this.supplierValue, this.fallbackSupplierValue] },
          },
        })
        await transaction.$executeRawUnsafe(
          'ALTER TABLE "dictionary_items" ENABLE TRIGGER "dictionary_items_invariants_trigger"',
        )
      })
    }
    finally {
      await this.application.close()
    }
  }

  private requireProductRuleId(): string {
    if (this.productRuleId === null) {
      throw new Error('Product E2E rule has not been created')
    }
    return this.productRuleId
  }

  private requireProductRuleVersion(): number {
    if (this.productRuleVersion === null) {
      throw new Error('Product E2E rule version is unavailable')
    }
    return this.productRuleVersion
  }
}
