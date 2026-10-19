import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import {
  DictionaryTone,
  ProductStatus,
} from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
import { DictionaryLookupService } from '../src/modules/dictionaries/dictionary-lookup.service'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const SUPPLIER_DICTIONARY_CODE = 'service_provider.supplier'
const PRODUCT_NO_PREFIX = 'PRODUCT-E2E-'
const USERNAME_PREFIX = 'product-list-e2e-'
const ROLE_CODE_PREFIX = 'product-list-reader-'

interface ApiErrorBody {
  readonly code: string
}

interface AuthContextBody {
  readonly permissions: string[]
}

interface ProductListItemBody {
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

interface ProductPageBody {
  readonly items: ProductListItemBody[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

function readResponseBody<T>(response: { readonly body: unknown }): T {
  return response.body as T
}

describe('Product list API with isolated PostgreSQL', () => {
  jest.setTimeout(30_000)

  let application: INestApplication
  let dictionaryLookup: DictionaryLookupService
  let passwords: PasswordProvider
  let prisma: PrismaService
  let supplierDictionaryTypeId: string
  let supplierDictionaryTypeEnabled: boolean
  const createdRoleIds = new Set<string>()
  const createdUserIds = new Set<string>()
  const supplierValues = {
    effective: `${PRODUCT_NO_PREFIX}SUPPLIER-A`,
    disabled: `${PRODUCT_NO_PREFIX}SUPPLIER-B`,
    unknown: `${PRODUCT_NO_PREFIX}SUPPLIER-UNKNOWN`,
  } as const

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    // 套件统一创建并在 afterAll 关闭监听器，避免 supertest 为每次请求临时 listen/close。
    await application.listen(0, '127.0.0.1')

    dictionaryLookup = application.get(DictionaryLookupService)
    passwords = application.get(PasswordProvider)
    prisma = application.get(PrismaService)
    const supplierType = await prisma.dictionaryType.findUniqueOrThrow({
      where: { code: SUPPLIER_DICTIONARY_CODE },
    })
    supplierDictionaryTypeId = supplierType.id
    supplierDictionaryTypeEnabled = supplierType.enabled
  })

  beforeEach(async () => {
    await prisma.$transaction(async (transaction) => {
      // 字典约束要求先存在启用 Item，才能把 Type 切换为启用。
      await transaction.dictionaryItem.createMany({
        data: [
          {
            dictionaryTypeId: supplierDictionaryTypeId,
            value: supplierValues.effective,
            label: '有效供应商',
            tone: DictionaryTone.SUCCESS,
            enabled: true,
            sortOrder: 10,
          },
          {
            dictionaryTypeId: supplierDictionaryTypeId,
            value: supplierValues.disabled,
            label: '已停用供应商',
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
    })
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await prisma.product.deleteMany({
      where: { productNo: { startsWith: PRODUCT_NO_PREFIX } },
    })
    await prisma.productHead.deleteMany({
      where: {
        category: {
          supplierValue: { in: Object.values(supplierValues) },
        },
      },
    })
    await prisma.productCategory.deleteMany({
      where: { supplierValue: { in: Object.values(supplierValues) } },
    })
    await prisma.$transaction(async (transaction) => {
      await transaction.dictionaryType.update({
        where: { id: supplierDictionaryTypeId },
        data: { enabled: false },
      })
      /*
       * 生产字典禁止物理删除。这里只在一次性 E2E 数据库的原子事务内短暂停用
       * 精确 User Trigger，删除本测试创建的 values 后立即恢复，不扩大到其他表。
       */
      await transaction.$executeRawUnsafe(
        'ALTER TABLE "dictionary_items" DISABLE TRIGGER "dictionary_items_invariants_trigger"',
      )
      await transaction.dictionaryItem.deleteMany({
        where: {
          dictionaryTypeId: supplierDictionaryTypeId,
          value: { in: Object.values(supplierValues) },
        },
      })
      await transaction.$executeRawUnsafe(
        'ALTER TABLE "dictionary_items" ENABLE TRIGGER "dictionary_items_invariants_trigger"',
      )
    })

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
    createdUserIds.clear()
    createdRoleIds.clear()

    expect(supplierDictionaryTypeEnabled).toBe(false)
  })

  afterAll(async () => {
    await application.close()
  })

  async function createUser(options: {
    readonly mustChangePassword?: boolean
    readonly productsRead?: boolean
  } = {}) {
    const suffix = randomUUID()
    const username = `${USERNAME_PREFIX}${suffix}`
    const password = `Product-${suffix.slice(0, 12)}`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: '产品列表 E2E 用户',
        passwordHash: await passwords.hash(password),
        passwordChangedAt: new Date(),
        mustChangePassword: options.mustChangePassword ?? false,
        profile: { create: {} },
      },
    })
    createdUserIds.add(user.id)

    if (options.productsRead === true) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { code: 'products:read' },
      })
      const role = await prisma.role.create({
        data: {
          code: `${ROLE_CODE_PREFIX}${suffix.replaceAll('-', '')}`,
          name: '产品列表只读 E2E',
        },
      })
      createdRoleIds.add(role.id)
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      })
      await prisma.userRole.create({
        data: { userId: user.id, roleId: role.id },
      })
    }

    return { password, user }
  }

  async function createLoggedInBrowser(options: {
    readonly mustChangePassword?: boolean
    readonly productsRead?: boolean
  } = {}) {
    const account = await createUser(options)
    const browser = request.agent(application.getHttpServer())
    const loginResponse = await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: account.user.username, password: account.password })
      .expect(200)
    return { account, browser, loginResponse }
  }

  async function createReaderBrowser() {
    const context = await createLoggedInBrowser({ productsRead: true })
    expect(
      readResponseBody<AuthContextBody>(context.loginResponse).permissions,
    ).toEqual(['products:read'])
    return context.browser
  }

  async function seedProducts(actorUserId: string): Promise<{
    readonly categoryGeneratorId: string
    readonly categoryMicroDisabledId: string
    readonly categoryMicroEffectiveId: string
    readonly disabledId: string
    readonly effectiveId: string
    readonly emptyCategoryId: string
    readonly emptyHeadId: string
    readonly productHeadEffectiveId: string
    readonly unclassifiedId: string
    readonly unknownId: string
  }> {
    const sharedUpdatedAt = new Date('2026-08-12T04:00:00.000Z')
    const effectiveId = randomUUID()
    const disabledId = randomUUID()
    const unknownId = randomUUID()
    const unclassifiedId = randomUUID()

    // 同名分类可存在于不同供应商；分类/产品头按稳定 ID 关联。
    const categoryMicroEffective = await prisma.productCategory.create({
      data: { name: '微耕机', supplierValue: supplierValues.effective },
    })
    const productHeadEffective = await prisma.productHead.create({
      data: { categoryId: categoryMicroEffective.id, name: '旱地履带' },
    })
    const categoryMicroDisabled = await prisma.productCategory.create({
      data: { name: '微耕机', supplierValue: supplierValues.disabled },
    })
    const productHeadDisabled = await prisma.productHead.create({
      data: { categoryId: categoryMicroDisabled.id, name: '四驱四轮' },
    })
    const categoryGenerator = await prisma.productCategory.create({
      data: { name: '发电机', supplierValue: supplierValues.unknown },
    })
    const productHeadGenerator = await prisma.productHead.create({
      data: { categoryId: categoryGenerator.id, name: '汽油发电机' },
    })
    const emptyCategory = await prisma.productCategory.create({
      data: { name: '空分类', supplierValue: supplierValues.effective },
    })
    const emptyHead = await prisma.productHead.create({
      data: { categoryId: emptyCategory.id, name: '空产品头' },
    })

    await prisma.product.createMany({
      data: [
        {
          id: effectiveId,
          name: '有效供应商产品',
          categoryId: categoryMicroEffective.id,
          productHeadId: productHeadEffective.id,
          productNo: `${PRODUCT_NO_PREFIX}001`,
          status: ProductStatus.ACTIVE,
          supplierValue: supplierValues.effective,
          twdSalePriceAmount: '12345678901234567890.12',
          myrSalePriceAmount: null,
          purchaseCostAmount: '10.50',
          attributes: [
            { title: '颜色', value: '墨黑' },
            { title: '尺寸', value: 'XL' },
          ],
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          createdAt: new Date('2026-08-10T04:00:00.000Z'),
          updatedAt: sharedUpdatedAt,
        },
        {
          id: disabledId,
          name: '停用供应商历史产品',
          categoryId: categoryMicroDisabled.id,
          productHeadId: productHeadDisabled.id,
          productNo: `${PRODUCT_NO_PREFIX}002`,
          status: ProductStatus.INACTIVE,
          supplierValue: supplierValues.disabled,
          twdSalePriceAmount: null,
          myrSalePriceAmount: '88.12',
          purchaseCostAmount: null,
          updatedAt: sharedUpdatedAt,
        },
        {
          id: unknownId,
          name: '未知供应商历史产品',
          categoryId: categoryGenerator.id,
          productHeadId: productHeadGenerator.id,
          productNo: `${PRODUCT_NO_PREFIX}003`,
          status: ProductStatus.INACTIVE,
          supplierValue: supplierValues.unknown,
          updatedAt: new Date('2026-08-11T04:00:00.000Z'),
        },
        {
          id: unclassifiedId,
          name: '未分类产品',
          productNo: `${PRODUCT_NO_PREFIX}004`,
          status: ProductStatus.INACTIVE,
          supplierValue: supplierValues.effective,
          updatedAt: new Date('2026-08-09T04:00:00.000Z'),
        },
      ],
    })

    return {
      categoryGeneratorId: categoryGenerator.id,
      categoryMicroDisabledId: categoryMicroDisabled.id,
      categoryMicroEffectiveId: categoryMicroEffective.id,
      disabledId,
      effectiveId,
      emptyCategoryId: emptyCategory.id,
      emptyHeadId: emptyHead.id,
      productHeadEffectiveId: productHeadEffective.id,
      unclassifiedId,
      unknownId,
    }
  }

  it('requires an authenticated normal session with products:read', async () => {
    await request(application.getHttpServer())
      .get('/api/products')
      .expect(401)
      .expect((response) => {
        expect(response.headers['cache-control']).toBe('private, no-store')
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'AUTHENTICATION_REQUIRED',
        )
      })

    const ordinary = await createLoggedInBrowser()
    expect(
      readResponseBody<AuthContextBody>(ordinary.loginResponse).permissions,
    ).toEqual([])
    await ordinary.browser
      .get('/api/products')
      .expect(403)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe('FORBIDDEN')
      })

    const forced = await createLoggedInBrowser({
      mustChangePassword: true,
      productsRead: true,
    })
    await forced.browser
      .get('/api/products')
      .expect(403)
      .expect((response) => {
        expect(readResponseBody<ApiErrorBody>(response).code).toBe(
          'PASSWORD_CHANGE_REQUIRED',
        )
      })

    await (await createReaderBrowser()).get('/api/products').expect(200)
  })

  it('returns stable pages, Decimal strings, historical suppliers and one batch lookup', async () => {
    const reader = await createLoggedInBrowser({ productsRead: true })
    const products = await seedProducts(reader.account.user.id)
    const resolveStoredValues = jest.spyOn(
      dictionaryLookup,
      'resolveStoredValues',
    )

    const response = await reader.browser
      .get('/api/products?page=1&pageSize=4')
      .expect(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    const page = readResponseBody<ProductPageBody>(response)
    expect(page).toMatchObject({ page: 1, pageSize: 4, total: 4 })
    expect(page.items.map(item => item.id)).toEqual([
      products.effectiveId,
      products.unclassifiedId,
      products.disabledId,
      products.unknownId,
    ])
    expect(resolveStoredValues).toHaveBeenCalledTimes(1)
    expect(resolveStoredValues).toHaveBeenCalledWith({
      dictionaryCode: SUPPLIER_DICTIONARY_CODE,
      values: expect.arrayContaining([
        supplierValues.effective,
        supplierValues.disabled,
        supplierValues.unknown,
      ]) as unknown,
    })

    const effective = page.items.find(item => item.id === products.effectiveId)
    expect(effective).toMatchObject({
      supplier: {
        value: supplierValues.effective,
        label: '有效供应商',
        tone: DictionaryTone.SUCCESS,
        state: 'EFFECTIVE',
      },
      media: { mainImage: null, images: [], videos: [] },
      twdSalePrice: {
        amount: '12345678901234567890.12',
        currency: 'TWD',
      },
      myrSalePrice: { amount: null, currency: 'MYR' },
      purchaseCost: { amount: '10.5', currency: 'CNY' },
      attributes: [
        { title: '颜色', value: '墨黑' },
        { title: '尺寸', value: 'XL' },
      ],
      createdBy: {
        id: reader.account.user.id,
        displayName: '产品列表 E2E 用户',
      },
      updatedBy: {
        id: reader.account.user.id,
        displayName: '产品列表 E2E 用户',
      },
    })
    expect(effective?.createdBy).not.toHaveProperty('username')
    expect(page.items.every(item => (
      item.media.mainImage === null
      && item.media.images.length === 0
      && item.media.videos.length === 0
    ))).toBe(true)
    expect(page.items.find(item => item.id === products.disabledId))
      .toMatchObject({
        supplier: {
          value: supplierValues.disabled,
          label: '已停用供应商',
          state: 'DISABLED',
        },
        myrSalePrice: { amount: '88.12', currency: 'MYR' },
        purchaseCost: { amount: null, currency: 'CNY' },
      })
    expect(page.items.find(item => item.id === products.unknownId))
      .toMatchObject({
        supplier: {
          value: supplierValues.unknown,
          label: null,
          tone: null,
          state: 'UNKNOWN',
        },
      })
    expect(page.items.find(item => item.id === products.unclassifiedId))
      .toMatchObject({
        categoryId: null,
        categoryName: null,
        productHeadId: null,
        productHeadName: null,
        supplier: { value: supplierValues.effective },
      })
  })

  it('returns taxonomy options scoped by supplier, including empty entries', async () => {
    const reader = await createLoggedInBrowser({ productsRead: true })
    const products = await seedProducts(reader.account.user.id)

    const response = await reader.browser
      .get('/api/products/taxonomy-options')
      .expect(200)
    const body = readResponseBody<{
      categories: Array<{
        id: string
        name: string
        supplierValue: string
        productHeads: Array<{ id: string, name: string }>
      }>
    }>(response)
    const microCategories = body.categories.filter(category => category.name === '微耕机')
    expect(microCategories).toHaveLength(2)
    expect(microCategories.map(category => category.supplierValue).sort())
      .toEqual([supplierValues.disabled, supplierValues.effective].sort())
    expect(microCategories.flatMap(category => category.productHeads.map(head => head.name)).sort())
      .toEqual(['四驱四轮', '旱地履带'].sort())
    const generator = body.categories.find(category => category.id === products.categoryGeneratorId)
    expect(generator).toMatchObject({
      name: '发电机',
      supplierValue: supplierValues.unknown,
      productHeads: [{ name: '汽油发电机' }],
    })
    expect(body.categories.find(category => category.id === products.emptyCategoryId))
      .toMatchObject({
        name: '空分类',
        productHeads: [{ id: products.emptyHeadId, name: '空产品头' }],
      })
    expect(body.categories.some(category => category.name === '未分类')).toBe(false)
  })

  it('applies exact status and supplier filters, resets empty pages and rejects invalid queries', async () => {
    const reader = await createLoggedInBrowser({ productsRead: true })
    const products = await seedProducts(reader.account.user.id)

    const filteredResponse = await reader.browser
      .get('/api/products')
      .query({ supplierValue: supplierValues.effective, page: 1, pageSize: 1 })
      .expect(200)
    const filtered = readResponseBody<ProductPageBody>(filteredResponse)
    expect(filtered).toMatchObject({ page: 1, pageSize: 1, total: 2 })
    expect(filtered.items.map(item => item.productNo)).toEqual([
      `${PRODUCT_NO_PREFIX}001`,
    ])

    const inactiveResponse = await reader.browser
      .get('/api/products')
      .query({ status: ProductStatus.INACTIVE })
      .expect(200)
    const inactive = readResponseBody<ProductPageBody>(inactiveResponse)
    expect(inactive).toMatchObject({ total: 3 })
    expect(inactive.items.every(item => item.status === ProductStatus.INACTIVE))
      .toBe(true)

    const combinedResponse = await reader.browser
      .get('/api/products')
      .query({
        status: ProductStatus.ACTIVE,
        supplierValue: supplierValues.effective,
      })
      .expect(200)
    expect(readResponseBody<ProductPageBody>(combinedResponse)).toMatchObject({
      total: 1,
      items: [{ productNo: `${PRODUCT_NO_PREFIX}001` }],
    })

    const categoryResponse = await reader.browser
      .get('/api/products')
      .query({ categoryId: products.categoryMicroEffectiveId })
      .expect(200)
    expect(readResponseBody<ProductPageBody>(categoryResponse)).toMatchObject({
      total: 1,
      items: [{ productNo: `${PRODUCT_NO_PREFIX}001` }],
    })

    const productHeadResponse = await reader.browser
      .get('/api/products')
      .query({ productHeadId: products.productHeadEffectiveId })
      .expect(200)
    expect(readResponseBody<ProductPageBody>(productHeadResponse)).toMatchObject({
      total: 1,
      items: [{ productNo: `${PRODUCT_NO_PREFIX}001` }],
    })

    const wrongCase = await reader.browser
      .get('/api/products')
      .query({ supplierValue: supplierValues.effective.toLowerCase() })
      .expect(200)
    expect(readResponseBody<ProductPageBody>(wrongCase)).toMatchObject({
      items: [],
      total: 0,
    })

    const emptyPage = await reader.browser
      .get('/api/products?page=99&pageSize=2')
      .expect(200)
    expect(readResponseBody<ProductPageBody>(emptyPage)).toMatchObject({
      items: [],
      page: 99,
      pageSize: 2,
      total: 4,
    })

    for (const query of [
      'page=0',
      'pageSize=101',
      'keyword=%20%20%20',
      `keyword=${encodeURIComponent('😀'.repeat(129))}`,
      'status=UNKNOWN',
      'supplierValue=%20%20%20',
      'categoryId=not-a-uuid',
      'productHeadId=11111111-1111-4111-8111-11111111111A',
    ]) {
      await reader.browser
        .get(`/api/products?${query}`)
        .expect(422)
        .expect((response) => {
          expect(readResponseBody<ApiErrorBody>(response).code).toBe(
            'VALIDATION_FAILED',
          )
        })
    }
  })

  it('searches product names or numbers and combines keyword with supplier', async () => {
    const reader = await createLoggedInBrowser({ productsRead: true })
    await seedProducts(reader.account.user.id)

    const byNameResponse = await reader.browser
      .get('/api/products')
      .query({ keyword: '  未分类  ' })
      .expect(200)
    expect(readResponseBody<ProductPageBody>(byNameResponse)).toMatchObject({
      total: 1,
      items: [{ productNo: `${PRODUCT_NO_PREFIX}004` }],
    })

    const byNumberResponse = await reader.browser
      .get('/api/products')
      .query({ keyword: 'product-e2e-001' })
      .expect(200)
    expect(readResponseBody<ProductPageBody>(byNumberResponse)).toMatchObject({
      total: 1,
      items: [{ productNo: `${PRODUCT_NO_PREFIX}001` }],
    })

    const combinedResponse = await reader.browser
      .get('/api/products')
      .query({
        keyword: '001',
        supplierValue: supplierValues.disabled,
      })
      .expect(200)
    expect(readResponseBody<ProductPageBody>(combinedResponse)).toMatchObject({
      items: [],
      total: 0,
    })
  })
})
