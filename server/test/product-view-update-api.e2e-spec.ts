import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Response } from 'supertest'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import type { Prisma } from '../src/generated/prisma/client'
import {
  AuditEventType,
  DictionaryTone,
  ProductStatus,
} from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuditService, AuditWriteFailedError } from '../src/modules/audit/audit.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const PRODUCT_NO_PREFIX = 'PRODUCT-VIEW-UPDATE-E2E-'
const USERNAME_PREFIX = 'product-view-update-e2e-'
const ROLE_CODE_PREFIX = 'product-view-update-e2e-'

interface ApiErrorBody {
  readonly code: string
  readonly requestId: string
}

interface AuthContextBody {
  readonly permissions: string[]
}

interface ProductBody {
  readonly id: string
  readonly name: string
  readonly categoryName: string | null
  readonly productHeadName: string | null
  readonly productNo: string
  readonly status: ProductStatus
  readonly supplier: {
    readonly value: string
    readonly label: string | null
    readonly tone: DictionaryTone | null
    readonly state: 'DISABLED' | 'EFFECTIVE' | 'UNKNOWN'
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

interface TestAccount {
  readonly browser: ReturnType<typeof request.agent>
  readonly permissions: readonly string[]
  readonly userId: string
}

interface OriginalCurrencyState {
  readonly id: string
  readonly code: 'MYR' | 'TWD'
  readonly enabled: boolean
  readonly rate: string | null
}

function readBody<T>(response: { readonly body: unknown }): T {
  return response.body as T
}

function expectApiError(
  response: Response,
  status: number,
  code: string,
): void {
  expect(response.status).toBe(status)
  expect(readBody<ApiErrorBody>(response)).toMatchObject({
    code,
    requestId: expect.any(String) as unknown,
  })
  expect(response.headers['cache-control']).toContain('no-store')
}

describe('Product detail and update API with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)

  let application: INestApplication
  let audit: AuditService
  let administrator: TestAccount
  let anonymousBrowser: ReturnType<typeof request.agent>
  let passwords: PasswordProvider
  let prisma: PrismaService
  let supplierDictionaryTypeId: string
  let supplierDictionaryTypeEnabled: boolean
  let originalCurrencyStates: readonly OriginalCurrencyState[]
  const createdProductIds = new Set<string>()
  const createdRoleIds = new Set<string>()
  const createdUserIds = new Set<string>()
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
  const supplierValues = {
    disabled: `PRODUCT_UPDATE_${suffix}_DISABLED`,
    effective: `PRODUCT_UPDATE_${suffix}_EFFECTIVE`,
    unknown: `PRODUCT_UPDATE_${suffix}_UNKNOWN`,
  } as const

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()

    audit = application.get(AuditService)
    anonymousBrowser = request.agent(application.getHttpServer())
    passwords = application.get(PasswordProvider)
    prisma = application.get(PrismaService)

    const supplierType = await prisma.dictionaryType.findUniqueOrThrow({
      where: { code: SUPPLIER_DICTIONARY_CODE },
    })
    supplierDictionaryTypeId = supplierType.id
    supplierDictionaryTypeEnabled = supplierType.enabled

    const currencies = await prisma.currency.findMany({
      where: { code: { in: ['TWD', 'MYR'] } },
      orderBy: { code: 'asc' },
      include: { exchangeRate: true },
    })
    if (currencies.length !== 2) {
      throw new Error('Product update E2E requires seeded TWD and MYR currencies')
    }
    originalCurrencyStates = currencies.map(currency => ({
      id: currency.id,
      code: currency.code as 'MYR' | 'TWD',
      enabled: currency.enabled,
      rate: currency.exchangeRate?.foreignUnitsPerCny.toString() ?? null,
    }))

    await prisma.$transaction(async (transaction) => {
      await transaction.dictionaryItem.createMany({
        data: [
          {
            dictionaryTypeId: supplierDictionaryTypeId,
            value: supplierValues.effective,
            label: '产品编辑有效供应商',
            tone: DictionaryTone.SUCCESS,
            enabled: true,
            sortOrder: 10,
          },
          {
            dictionaryTypeId: supplierDictionaryTypeId,
            value: supplierValues.disabled,
            label: '产品编辑停用供应商',
            tone: DictionaryTone.WARNING,
            enabled: false,
            sortOrder: 20,
          },
        ],
      })
      await transaction.dictionaryType.update({
        where: { id: supplierDictionaryTypeId },
        data: { enabled: true },
      })
      for (const currency of originalCurrencyStates) {
        if (currency.rate === null) {
          await transaction.exchangeRate.create({
            data: { currencyId: currency.id, foreignUnitsPerCny: '1' },
          })
        }
      }
      await transaction.currency.updateMany({
        where: { code: { in: ['TWD', 'MYR'] } },
        data: { enabled: true },
      })
    })

    administrator = await createAccount({ systemAdmin: true })
    expect(administrator.permissions).toEqual(
      expect.arrayContaining(['products:read', 'products:update']),
    )
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    const productIds = [...createdProductIds]
    if (productIds.length > 0) {
      await prisma.auditEvent.deleteMany({
        where: { targetType: 'PRODUCT', targetId: { in: productIds } },
      })
      await prisma.product.deleteMany({ where: { id: { in: productIds } } })
      createdProductIds.clear()
    }
  })

  afterAll(async () => {
    if (prisma === undefined) {
      await application?.close()
      return
    }

    const userIds = [...createdUserIds]
    if (userIds.length > 0) {
      await prisma.auditEvent.deleteMany({
        where: { actorUserId: { in: userIds } },
      })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    }
    const roleIds = [...createdRoleIds]
    if (roleIds.length > 0) {
      await prisma.role.deleteMany({ where: { id: { in: roleIds } } })
    }

    await prisma.$transaction(async (transaction) => {
      for (const currency of originalCurrencyStates) {
        if (!currency.enabled) {
          await transaction.currency.update({
            where: { id: currency.id },
            data: { enabled: false },
          })
        }
        if (currency.rate === null) {
          await transaction.exchangeRate.deleteMany({
            where: { currencyId: currency.id },
          })
        }
        else {
          await transaction.exchangeRate.upsert({
            where: { currencyId: currency.id },
            update: { foreignUnitsPerCny: currency.rate },
            create: {
              currencyId: currency.id,
              foreignUnitsPerCny: currency.rate,
            },
          })
        }
        if (currency.enabled) {
          await transaction.currency.update({
            where: { id: currency.id },
            data: { enabled: true },
          })
        }
      }

      await transaction.dictionaryType.update({
        where: { id: supplierDictionaryTypeId },
        data: { enabled: supplierDictionaryTypeEnabled },
      })
      /*
       * 生产字典禁止物理删除。这里仅在一次性 E2E 数据库中暂时停用精确
       * User Trigger，删除本 suite 的随机 value 后立即恢复。
       */
      await transaction.$executeRawUnsafe(
        'ALTER TABLE "dictionary_items" DISABLE TRIGGER "dictionary_items_invariants_trigger"',
      )
      await transaction.dictionaryItem.deleteMany({
        where: {
          dictionaryTypeId: supplierDictionaryTypeId,
          value: { in: [supplierValues.effective, supplierValues.disabled] },
        },
      })
      await transaction.$executeRawUnsafe(
        'ALTER TABLE "dictionary_items" ENABLE TRIGGER "dictionary_items_invariants_trigger"',
      )
    })
    await application.close()
  })

  async function createAccount(options: {
    readonly mustChangePassword?: boolean
    readonly permissions?: readonly string[]
    readonly systemAdmin?: boolean
  } = {}): Promise<TestAccount> {
    const id = randomUUID()
    const username = `${USERNAME_PREFIX}${id}`
    const password = `Product-${id.slice(0, 12)}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: '产品查看编辑 E2E 用户',
        passwordHash: await passwords.hash(password),
        passwordChangedAt: new Date(),
        mustChangePassword: options.mustChangePassword ?? false,
        profile: { create: {} },
      },
    })
    createdUserIds.add(user.id)

    if (options.systemAdmin === true) {
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: 'system_admin' },
      })
      await prisma.userRole.create({
        data: { userId: user.id, roleId: role.id },
      })
    }
    else if (options.permissions !== undefined && options.permissions.length > 0) {
      const permissions = await prisma.permission.findMany({
        where: { code: { in: [...options.permissions] } },
      })
      if (permissions.length !== options.permissions.length) {
        throw new Error('Product update E2E permission fixture is incomplete')
      }
      const role = await prisma.role.create({
        data: {
          code: `${ROLE_CODE_PREFIX}${id.replaceAll('-', '')}`,
          name: '产品查看编辑 E2E 角色',
        },
      })
      createdRoleIds.add(role.id)
      await prisma.rolePermission.createMany({
        data: permissions.map(permission => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
      })
      await prisma.userRole.create({
        data: { userId: user.id, roleId: role.id },
      })
    }

    const browser = request.agent(application.getHttpServer())
    const login = await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username, password })
      .expect(200)
    return {
      browser,
      permissions: readBody<AuthContextBody>(login).permissions,
      userId: user.id,
    }
  }

  async function createProduct(
    overrides: Partial<Prisma.ProductUncheckedCreateInput> = {},
  ) {
    const product = await prisma.product.create({
      data: {
        name: '产品查看编辑 E2E',
        productNo: `${PRODUCT_NO_PREFIX}${randomUUID()}`,
        status: ProductStatus.DRAFT,
        supplierValue: supplierValues.effective,
        twdSalePriceAmount: '1280.50',
        twdSalePriceCurrency: 'TWD',
        myrSalePriceAmount: null,
        myrSalePriceCurrency: 'MYR',
        purchaseCostAmount: '88.10',
        purchaseCostCurrency: 'CNY',
        attributes: [{ title: '颜色', value: '黑色' }],
        createdByUserId: administrator.userId,
        updatedByUserId: administrator.userId,
        ...overrides,
      },
    })
    createdProductIds.add(product.id)
    return product
  }

  function updateProduct(
    browser: ReturnType<typeof request.agent>,
    productId: string,
    body: object,
    includeCsrf = true,
  ): Promise<Response> {
    let productRequest = browser.patch(`/api/products/${productId}`).send(body)
    if (includeCsrf) {
      productRequest = productRequest.set(CSRF_HEADERS)
    }
    return productRequest
  }

  it('reads one fresh detail with historical supplier semantics and safe resource errors', async () => {
    const disabled = await createProduct({
      supplierValue: supplierValues.disabled,
      status: ProductStatus.INACTIVE,
    })
    const unknown = await createProduct({
      supplierValue: supplierValues.unknown,
      status: ProductStatus.INACTIVE,
    })

    const disabledResponse = await administrator.browser
      .get(`/api/products/${disabled.id}`)
      .expect(200)
    expect(disabledResponse.headers['cache-control']).toBe('private, no-store')
    expect(readBody<ProductBody>(disabledResponse)).toMatchObject({
      id: disabled.id,
      supplier: {
        value: supplierValues.disabled,
        label: '产品编辑停用供应商',
        state: 'DISABLED',
      },
      media: { mainImage: null, images: [], videos: [] },
      version: 1,
    })

    const unknownResponse = await administrator.browser
      .get(`/api/products/${unknown.id}`)
      .expect(200)
    expect(readBody<ProductBody>(unknownResponse)).toMatchObject({
      supplier: {
        value: supplierValues.unknown,
        label: null,
        tone: null,
        state: 'UNKNOWN',
      },
    })

    expectApiError(
      await administrator.browser.get(`/api/products/${randomUUID()}`),
      404,
      'PRODUCT_NOT_FOUND',
    )
    expectApiError(
      await administrator.browser.get('/api/products/not-a-uuid'),
      422,
      'VALIDATION_FAILED',
    )
  })

  it('fails closed for detail/update authentication, authorization, forced password and CSRF', async () => {
    const product = await createProduct()
    const ordinary = await createAccount()
    const reader = await createAccount({ permissions: ['products:read'] })
    const forced = await createAccount({
      mustChangePassword: true,
      systemAdmin: true,
    })

    expectApiError(
      await anonymousBrowser.get(`/api/products/${product.id}`),
      401,
      'AUTHENTICATION_REQUIRED',
    )
    expectApiError(
      await ordinary.browser.get(`/api/products/${product.id}`),
      403,
      'FORBIDDEN',
    )
    await reader.browser.get(`/api/products/${product.id}`).expect(200)

    for (const testCase of [
      {
        response: await updateProduct(
          anonymousBrowser,
          product.id,
          { expectedVersion: 1, name: '匿名修改' },
        ),
        code: 'AUTHENTICATION_REQUIRED',
        status: 401,
      },
      {
        response: await updateProduct(
          ordinary.browser,
          product.id,
          { expectedVersion: 1, name: '无权限修改' },
        ),
        code: 'FORBIDDEN',
        status: 403,
      },
      {
        response: await updateProduct(
          reader.browser,
          product.id,
          { expectedVersion: 1, name: '只读修改' },
        ),
        code: 'FORBIDDEN',
        status: 403,
      },
      {
        response: await updateProduct(
          forced.browser,
          product.id,
          { expectedVersion: 1, name: '强制改密修改' },
        ),
        code: 'PASSWORD_CHANGE_REQUIRED',
        status: 403,
      },
      {
        response: await updateProduct(
          administrator.browser,
          product.id,
          { expectedVersion: 1, name: '无 CSRF 修改' },
          false,
        ),
        code: 'CSRF_REJECTED',
        status: 403,
      },
    ]) {
      expectApiError(testCase.response, testCase.status, testCase.code)
    }
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } }))
      .toMatchObject({ name: '产品查看编辑 E2E', version: 1 })
  })

  it('atomically updates allowed fields, preserves structured media and records safe audit metadata', async () => {
    const product = await createProduct()
    const response = await updateProduct(administrator.browser, product.id, {
      expectedVersion: 1,
      name: '  更新后的产品  ',
      categoryName: ' 新分类 ',
      productHeadName: ' 新产品头 ',
      status: 'ACTIVE',
      supplierValue: supplierValues.effective,
      twdSalePrice: { amount: '1688.00', currency: 'TWD' },
      myrSalePrice: { amount: '25.50', currency: 'MYR' },
      purchaseCost: { amount: '66.00', currency: 'CNY' },
      attributes: [{ title: ' 尺寸 ', value: ' XL ' }],
    })
    expect(response.status).toBe(200)
    const body = readBody<ProductBody>(response)
    expect(body).toMatchObject({
      id: product.id,
      name: '更新后的产品',
      categoryName: '新分类',
      productHeadName: '新产品头',
      status: ProductStatus.ACTIVE,
      supplier: { value: supplierValues.effective, state: 'EFFECTIVE' },
      media: { mainImage: null, images: [], videos: [] },
      twdSalePrice: { amount: '1688', currency: 'TWD' },
      myrSalePrice: { amount: '25.5', currency: 'MYR' },
      purchaseCost: { amount: '66', currency: 'CNY' },
      attributes: [{ title: '尺寸', value: 'XL' }],
      updatedBy: { id: administrator.userId },
      version: 2,
    })

    const stored = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    })
    expect(stored).toMatchObject({
      name: '更新后的产品',
      categoryName: '新分类',
      productHeadName: '新产品头',
      productNo: product.productNo,
      createdByUserId: administrator.userId,
      updatedByUserId: administrator.userId,
      version: 2,
    })
    expect(stored).not.toHaveProperty('mainImage')
    expect(stored).not.toHaveProperty('images')
    expect(stored).not.toHaveProperty('videos')

    const audits = await prisma.auditEvent.findMany({
      where: {
        eventType: AuditEventType.PRODUCT_UPDATED,
        targetType: 'PRODUCT',
        targetId: product.id,
      },
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      outcome: 'SUCCESS',
      actorUserId: administrator.userId,
      targetId: product.id,
      metadata: {
        productNo: product.productNo,
        changedFields: 'attributes,categoryName,myrSalePrice,name,productHeadName,purchaseCost,status,twdSalePrice',
        previousVersion: 1,
        version: 2,
        previousStatus: 'DRAFT',
        status: 'ACTIVE',
      },
    })
    const serializedAudit = JSON.stringify(audits[0])
    expect(serializedAudit).not.toContain(supplierValues.effective)
    expect(serializedAudit).not.toContain('1688')
    expect(serializedAudit).not.toContain('更新后的产品')
    expect(serializedAudit).not.toContain('XL')
  })

  it('keeps a normalized no-op at the same version without audit or updated-at mutation', async () => {
    const product = await createProduct({ name: 'No-op 产品' })
    const response = await updateProduct(administrator.browser, product.id, {
      expectedVersion: 1,
      name: '  No-op 产品  ',
    })
    expect(response.status).toBe(200)
    expect(readBody<ProductBody>(response)).toMatchObject({
      name: 'No-op 产品',
      version: 1,
    })
    const stored = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    })
    expect(stored.version).toBe(1)
    expect(stored.updatedAt).toEqual(product.updatedAt)
    expect(await prisma.auditEvent.count({
      where: {
        eventType: AuditEventType.PRODUCT_UPDATED,
        targetId: product.id,
      },
    })).toBe(0)
  })

  it('rejects stale and concurrent writers so exactly one version and audit can commit', async () => {
    const product = await createProduct()
    const responses = await Promise.all([
      updateProduct(administrator.browser, product.id, {
        expectedVersion: 1,
        name: '并发写入 A',
      }),
      updateProduct(administrator.browser, product.id, {
        expectedVersion: 1,
        name: '并发写入 B',
      }),
    ])
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    const conflict = responses.find(response => response.status === 409)
    if (conflict === undefined) {
      throw new Error('Expected one product update conflict')
    }
    expectApiError(conflict, 409, 'PRODUCT_STATE_CHANGED')

    const stored = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    })
    expect(['并发写入 A', '并发写入 B']).toContain(stored.name)
    expect(stored.version).toBe(2)
    expect(await prisma.auditEvent.count({
      where: {
        eventType: AuditEventType.PRODUCT_UPDATED,
        targetId: product.id,
      },
    })).toBe(1)

    expectApiError(
      await updateProduct(administrator.browser, product.id, {
        expectedVersion: 1,
        name: '过期再次写入',
      }),
      409,
      'PRODUCT_STATE_CHANGED',
    )
  })

  it('preserves historical dependencies outside Active but validates changed or activated dependencies', async () => {
    const product = await createProduct({
      status: ProductStatus.INACTIVE,
      supplierValue: supplierValues.unknown,
    })
    const historical = await updateProduct(administrator.browser, product.id, {
      expectedVersion: 1,
      name: '保留历史供应商的停用产品',
    })
    expect(historical.status).toBe(200)
    expect(readBody<ProductBody>(historical)).toMatchObject({
      name: '保留历史供应商的停用产品',
      supplier: { value: supplierValues.unknown, state: 'UNKNOWN' },
      version: 2,
    })

    const changedSupplier = await updateProduct(administrator.browser, product.id, {
      expectedVersion: 2,
      supplierValue: supplierValues.unknown,
    })
    // 同值是 no-op；先改为 null，再验证重新写入未知值必须失败。
    expect(changedSupplier.status).toBe(200)
    await updateProduct(administrator.browser, product.id, {
      expectedVersion: 2,
      supplierValue: null,
    }).then(response => expect(response.status).toBe(200))
    expectApiError(
      await updateProduct(administrator.browser, product.id, {
        expectedVersion: 3,
        supplierValue: supplierValues.unknown,
      }),
      422,
      'PRODUCT_SUPPLIER_UNAVAILABLE',
    )

    expectApiError(
      await updateProduct(administrator.browser, product.id, {
        expectedVersion: 3,
        status: 'ACTIVE',
      }),
      422,
      'PRODUCT_SUPPLIER_REQUIRED',
    )
  })

  it('rolls back Product and version when the audit write fails', async () => {
    const product = await createProduct()
    jest.spyOn(audit, 'record').mockRejectedValueOnce(new AuditWriteFailedError())

    const response = await updateProduct(administrator.browser, product.id, {
      expectedVersion: 1,
      name: '不应提交的产品名',
    })
    expectApiError(response, 500, 'INTERNAL_ERROR')
    expect(JSON.stringify(response.body)).not.toContain('不应提交的产品名')

    const stored = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    })
    expect(stored).toMatchObject({
      name: '产品查看编辑 E2E',
      version: 1,
    })
    expect(await prisma.auditEvent.count({
      where: {
        eventType: AuditEventType.PRODUCT_UPDATED,
        targetId: product.id,
      },
    })).toBe(0)
  })
})
