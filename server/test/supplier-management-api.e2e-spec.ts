import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { configureApplication } from '../src/app.setup'
import {
  NumberingResetPolicy,
  NumberingRuleStatus,
  NumberingRuleVersionStatus,
  NumberingSegmentType,
  RegionLevel,
} from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'
import {
  createIsolatedSupplierDatabase,
  type IsolatedSupplierDatabase,
  IsolatedSupplierPrismaService,
} from './supplier-e2e-database'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const ALL_SUPPLIER_PERMISSIONS = [
  'suppliers:create',
  'suppliers:disable',
  'suppliers:enable',
  'suppliers:read',
  'suppliers:update',
] as const

interface ApiErrorBody {
  code: string
  message: string
  requestId: string
}

interface SupplierBody {
  id: string
  code: string
  legalName: string
  shortName: string | null
  entityType: 'INDIVIDUAL' | 'ORGANIZATION'
  registration: null | {
    countryRegion: { id: string; name: string }
    number: string
  }
  primaryContact: null | {
    name: string | null
    phone: string | null
    wechatId: string | null
  }
  primaryAddress: null | {
    countryRegionId: string | null
    provinceStateId: string | null
    cityId: string | null
    regionPath: Array<{ id: string; name: string }>
    addressLine: string | null
    postalCode: string | null
  }
  remark: string | null
  enabled: boolean
  enableReadiness: {
    ready: boolean
    missingFields: string[]
  }
  version: number
  createdAt: string
  updatedAt: string
}

interface SupplierPageBody {
  items: Array<Record<string, unknown>>
  page: number
  pageSize: number
  total: number
}

function readBody<T>(response: { body: unknown }): T {
  return response.body as T
}

function createPayload(
  legalName: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    legalName,
    entityType: 'ORGANIZATION',
    ...overrides,
  }
}

describe('Supplier management API with isolated PostgreSQL', () => {
  jest.setTimeout(90_000)

  let application: INestApplication
  let database: IsolatedSupplierDatabase
  let originalDatabaseUrl: string | undefined
  let passwords: PasswordProvider
  let prisma: PrismaService
  let regionPath: {
    countryId: string
    provinceId: string
    cityId: string
  }

  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL
    database = await createIsolatedSupplierDatabase()
    process.env.DATABASE_URL = database.databaseUrl
    const isolatedPrisma = new IsolatedSupplierPrismaService(database)

    // AppModule 必须在 DATABASE_URL 切换后加载，确保 ConfigModule 与覆盖后的
    // Prisma provider 都只访问本 spec 的隔离 schema。
    const { AppModule } = await import('../src/app.module')
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(isolatedPrisma)
      .compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()

    passwords = application.get(PasswordProvider)
    prisma = application.get(PrismaService)
    await seedSupplierNumberingRule()
    regionPath = await readEnabledRegionPath()
  })

  afterAll(async () => {
    await application?.close()
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL
    }
    else {
      process.env.DATABASE_URL = originalDatabaseUrl
    }
    await database?.dispose()
  })

  async function seedSupplierNumberingRule(): Promise<void> {
    const rule = await prisma.numberingRule.create({
      data: {
        ruleCode: 'SUPPLIER',
        name: '供应商编号',
        description: 'Supplier E2E fixture only',
        versions: {
          create: {
            revision: 1,
            resetPolicy: NumberingResetPolicy.NEVER,
            configFingerprint: 'a'.repeat(64),
            segments: {
              create: [
                {
                  position: 0,
                  type: NumberingSegmentType.FIXED,
                  fixedValue: 'SUP',
                },
                {
                  position: 1,
                  type: NumberingSegmentType.SEPARATOR,
                  separatorValue: '-',
                },
                {
                  position: 2,
                  type: NumberingSegmentType.SEQUENCE,
                  sequenceWidth: 6,
                  sequenceStartValue: 1n,
                  sequenceStep: 1n,
                },
              ],
            },
          },
        },
      },
      include: { versions: true },
    })
    const version = rule.versions[0]
    if (!version) {
      throw new Error('Expected Supplier numbering version fixture')
    }
    // 正式约束只允许草稿阶段写 segments；夹具随后按发布、启用顺序推进。
    await prisma.numberingRuleVersion.update({
      where: { id: version.id },
      data: {
        status: NumberingRuleVersionStatus.ACTIVE,
        publishedAt: new Date(),
      },
    })
    await prisma.numberingRule.update({
      where: { id: rule.id },
      data: { status: NumberingRuleStatus.ENABLED },
    })
  }

  async function readEnabledRegionPath() {
    const city = await prisma.region.findFirstOrThrow({
      where: {
        level: RegionLevel.CITY,
        enabled: true,
        parent: {
          is: {
            level: RegionLevel.PROVINCE_STATE,
            enabled: true,
            parent: {
              is: {
                level: RegionLevel.COUNTRY_REGION,
                enabled: true,
              },
            },
          },
        },
      },
      select: {
        id: true,
        parent: {
          select: {
            id: true,
            parent: { select: { id: true } },
          },
        },
      },
    })
    const province = city.parent
    const country = province?.parent
    if (!province || !country) {
      throw new Error('Expected enabled three-level region fixture')
    }
    return {
      countryId: country.id,
      provinceId: province.id,
      cityId: city.id,
    }
  }

  async function createBrowser(permissionCodes: readonly string[]) {
    const suffix = randomUUID()
    const username = `supplier-api-e2e-${suffix}`
    const password = `Sup-${suffix.slice(0, 12)}`
    const permissions = await prisma.permission.findMany({
      where: { code: { in: [...permissionCodes] } },
      select: { id: true },
    })
    expect(permissions).toHaveLength(permissionCodes.length)
    const role = await prisma.role.create({
      data: {
        code: `supplier_e2e_${suffix.replaceAll('-', '')}`,
        name: '供应商 E2E 角色',
        permissions: {
          create: permissions.map(permission => ({
            permissionId: permission.id,
          })),
        },
      },
    })
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: '供应商 E2E 用户',
        passwordHash: await passwords.hash(password),
        passwordChangedAt: new Date(),
        profile: { create: {} },
        roles: { create: { roleId: role.id } },
      },
    })
    const browser = request.agent(application.getHttpServer())
    await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username, password })
      .expect(200)
    return { browser, user }
  }

  function postSupplier(
    browser: ReturnType<typeof request.agent>,
    payload: Record<string, unknown>,
    idempotencyKey = randomUUID(),
  ) {
    return browser
      .post('/api/suppliers')
      .set(CSRF_HEADERS)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
  }

  it('enforces session, independent permissions, CSRF and the approved route surface', async () => {
    await request(application.getHttpServer())
      .get('/api/suppliers')
      .expect(401)

    const { browser } = await createBrowser(['suppliers:create'])
    const payload = createPayload(`独立创建权限 ${randomUUID()}`)

    await postSupplier(browser, payload).expect(201)
    await browser.get('/api/suppliers').expect(403)
    await browser
      .post('/api/suppliers')
      .set('Idempotency-Key', randomUUID())
      .send(createPayload(`无 CSRF ${randomUUID()}`))
      .expect(403)
      .expect((response) => {
        expect(readBody<ApiErrorBody>(response).code).toBe('CSRF_REJECTED')
      })

    const unknownId = randomUUID()
    await browser
      .patch(`/api/suppliers/${unknownId}`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1, remark: '不可编辑' })
      .expect(403)
    await browser
      .post(`/api/suppliers/${unknownId}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1 })
      .expect(403)
    await browser
      .post(`/api/suppliers/${unknownId}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 1 })
      .expect(403)

    await browser.delete(`/api/suppliers/${unknownId}`).expect(404)
    await browser.post('/api/suppliers/generate').set(CSRF_HEADERS).expect(404)
    const { browser: reader } = await createBrowser(['suppliers:read'])
    // catalog 会落入详情 UUID 校验并返回 422，证明不存在独立 catalog route。
    await reader.get('/api/suppliers/catalog').expect(422)
  })

  it('completes the region-backed lifecycle with minimal list data and exact audit events', async () => {
    const { browser, user } = await createBrowser(ALL_SUPPLIER_PERMISSIONS)
    const legalName = `千树供应商 ${randomUUID()}`
    const registrationNumber = `REG-${randomUUID()}`
    const payload = createPayload(legalName, {
      shortName: '千树供方',
      registration: {
        countryRegionId: regionPath.countryId,
        number: registrationNumber,
      },
      primaryContact: {
        name: '主要联系人',
        phone: '+86 138 0000 0000',
        wechatId: 'qianshu_supplier',
      },
      primaryAddress: {
        countryRegionId: regionPath.countryId,
        provinceStateId: regionPath.provinceId,
        cityId: regionPath.cityId,
        addressLine: '测试路 100 号',
        postalCode: null,
      },
      remark: '仅详情可见的备注',
    })

    const createResponse = await postSupplier(browser, payload).expect(201)
    const created = readBody<SupplierBody>(createResponse)
    expect(created).toMatchObject({
      legalName,
      shortName: '千树供方',
      entityType: 'ORGANIZATION',
      enabled: false,
      version: 1,
      registration: { number: registrationNumber },
      primaryContact: {
        name: '主要联系人',
        phone: '+86 138 0000 0000',
        wechatId: 'qianshu_supplier',
      },
      primaryAddress: {
        postalCode: null,
        addressLine: '测试路 100 号',
      },
      enableReadiness: { ready: true, missingFields: [] },
    })
    expect(created.code).toMatch(/^SUP-[0-9]{6}$/u)

    const pageResponse = await browser
      .get('/api/suppliers')
      .query({ query: '13800000000', entityType: 'ORGANIZATION' })
      .expect(200)
    const page = readBody<SupplierPageBody>(pageResponse)
    expect(page).toMatchObject({ page: 1, pageSize: 20 })
    const item = page.items.find(candidate => candidate.id === created.id)
    expect(item).toBeDefined()
    expect(Object.keys(item ?? {}).sort()).toEqual([
      'code',
      'enabled',
      'entityType',
      'hasPrimaryContactPhone',
      'hasPrimaryContactWechatId',
      'id',
      'legalName',
      'primaryAddressRegionPath',
      'primaryContactName',
      'registrationCountryRegion',
      'shortName',
      'updatedAt',
      'version',
    ])
    expect(JSON.stringify(item)).not.toContain(registrationNumber)
    expect(JSON.stringify(item)).not.toContain('+86 138 0000 0000')
    expect(JSON.stringify(item)).not.toContain('qianshu_supplier')
    expect(JSON.stringify(item)).not.toContain('测试路 100 号')
    expect(JSON.stringify(item)).not.toContain('仅详情可见的备注')

    const updatedResponse = await browser
      .patch(`/api/suppliers/${created.id}`)
      .set(CSRF_HEADERS)
      .send({
        expectedVersion: 1,
        legalName: ` ${legalName}（更新） `,
      })
      .expect(200)
    const updated = readBody<SupplierBody>(updatedResponse)
    expect(updated).toMatchObject({
      legalName: `${legalName}（更新）`,
      version: 2,
    })

    await browser
      .patch(`/api/suppliers/${created.id}`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 2, legalName: ` ${legalName}（更新） ` })
      .expect(200)
      .expect((response) => {
        expect(readBody<SupplierBody>(response).version).toBe(2)
      })

    await browser
      .post(`/api/suppliers/${created.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 2 })
      .expect(200)
      .expect((response) => {
        expect(readBody<SupplierBody>(response)).toMatchObject({
          enabled: true,
          version: 3,
        })
      })
    await browser
      .post(`/api/suppliers/${created.id}/enable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 3 })
      .expect(200)
      .expect((response) => {
        expect(readBody<SupplierBody>(response).version).toBe(3)
      })

    await browser
      .patch(`/api/suppliers/${created.id}`)
      .set(CSRF_HEADERS)
      .send({
        expectedVersion: 3,
        primaryContact: { name: null, phone: null, wechatId: null },
      })
      .expect(422)
      .expect((response) => {
        expect(readBody<ApiErrorBody>(response).code).toBe(
          'SUPPLIER_ENABLE_REQUIREMENTS_NOT_MET',
        )
      })
    await browser
      .patch(`/api/suppliers/${created.id}`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 2, remark: '过期写入' })
      .expect(409)
      .expect((response) => {
        expect(readBody<ApiErrorBody>(response).code).toBe(
          'SUPPLIER_STATE_CHANGED',
        )
      })

    await browser
      .post(`/api/suppliers/${created.id}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 3 })
      .expect(200)
      .expect((response) => {
        expect(readBody<SupplierBody>(response)).toMatchObject({
          enabled: false,
          version: 4,
        })
      })
    await browser
      .post(`/api/suppliers/${created.id}/disable`)
      .set(CSRF_HEADERS)
      .send({ expectedVersion: 4 })
      .expect(200)
      .expect((response) => {
        expect(readBody<SupplierBody>(response).version).toBe(4)
      })

    const detailResponse = await browser
      .get(`/api/suppliers/${created.id}`)
      .expect(200)
    expect(readBody<SupplierBody>(detailResponse)).toMatchObject({
      id: created.id,
      version: 4,
      enabled: false,
    })

    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        actorUserId: user.id,
        targetType: 'Supplier',
        targetId: created.id,
      },
      orderBy: { occurredAt: 'asc' },
    })
    expect(auditEvents.map(event => event.eventType)).toEqual([
      'SUPPLIER_CREATED',
      'SUPPLIER_UPDATED',
      'SUPPLIER_ENABLED',
      'SUPPLIER_DISABLED',
    ])
    const serializedAudit = JSON.stringify(auditEvents)
    for (const sensitiveValue of [
      registrationNumber,
      '+86 138 0000 0000',
      'qianshu_supplier',
      '测试路 100 号',
      '仅详情可见的备注',
      'Idempotency-Key',
    ]) {
      expect(serializedAudit).not.toContain(sensitiveValue)
    }
  })

  it('replays identical creates, rejects changed payloads and converges same-key concurrency', async () => {
    const { browser, user } = await createBrowser(ALL_SUPPLIER_PERMISSIONS)
    const replayKey = randomUUID()
    const replayPayload = createPayload(`幂等重放 ${randomUUID()}`)

    const first = await postSupplier(browser, replayPayload, replayKey)
      .expect(201)
    const replay = await postSupplier(browser, replayPayload, replayKey)
      .expect(201)
    expect(readBody<SupplierBody>(replay)).toEqual(
      readBody<SupplierBody>(first),
    )
    await postSupplier(
      browser,
      { ...replayPayload, legalName: `${replayPayload.legalName} changed` },
      replayKey,
    )
      .expect(409)
      .expect((response) => {
        expect(readBody<ApiErrorBody>(response).code).toBe(
          'SUPPLIER_IDEMPOTENCY_CONFLICT',
        )
      })

    const concurrentKey = randomUUID()
    const concurrentPayload = createPayload(`并发创建 ${randomUUID()}`)
    const [left, right] = await Promise.all([
      postSupplier(browser, concurrentPayload, concurrentKey),
      postSupplier(browser, concurrentPayload, concurrentKey),
    ])
    expect([left.status, right.status]).toEqual([201, 201])
    expect(readBody<SupplierBody>(left)).toEqual(readBody<SupplierBody>(right))

    const supplierIds = [
      readBody<SupplierBody>(first).id,
      readBody<SupplierBody>(left).id,
    ]
    await expect(prisma.supplier.count({
      where: { id: { in: supplierIds } },
    })).resolves.toBe(2)
    await expect(prisma.supplierCreateRequest.count({
      where: { supplierId: { in: supplierIds } },
    })).resolves.toBe(2)
    await expect(prisma.numberingIssuance.count({
      where: {
        consumerCode: 'SUPPLIER.CREATE',
        supplier: { is: { id: { in: supplierIds } } },
      },
    })).resolves.toBe(2)
    await expect(prisma.auditEvent.count({
      where: {
        actorUserId: user.id,
        eventType: 'SUPPLIER_CREATED',
        targetId: { in: supplierIds },
      },
    })).resolves.toBe(2)
  })

  it('rejects invalid or unavailable regions and duplicate registration per country', async () => {
    const { browser } = await createBrowser(ALL_SUPPLIER_PERMISSIONS)
    const duplicateNumber = `DUP-${randomUUID()}`
    await postSupplier(browser, createPayload(`登记唯一一 ${randomUUID()}`, {
      registration: {
        countryRegionId: regionPath.countryId,
        number: duplicateNumber,
      },
    })).expect(201)
    await postSupplier(browser, createPayload(`登记唯一二 ${randomUUID()}`, {
      registration: {
        countryRegionId: regionPath.countryId,
        number: ` ${duplicateNumber.toLowerCase()} `,
      },
    }))
      .expect(409)
      .expect((response) => {
        expect(readBody<ApiErrorBody>(response).code).toBe(
          'SUPPLIER_REGISTRATION_ALREADY_EXISTS',
        )
      })

    await postSupplier(browser, createPayload(`地区缺失 ${randomUUID()}`, {
      registration: {
        countryRegionId: randomUUID(),
        number: `MISSING-${randomUUID()}`,
      },
    }))
      .expect(422)
      .expect((response) => {
        expect(readBody<ApiErrorBody>(response).code).toBe(
          'SUPPLIER_REGION_INVALID',
        )
      })

    const disabledCountry = await prisma.region.create({
      data: {
        code: `E2E-SUPPLIER-${randomUUID()}`.toUpperCase(),
        name: `停用国家 ${randomUUID()}`,
        normalizedName: `停用国家 ${randomUUID()}`,
        administrativeType: 'COUNTRY_REGION',
        level: RegionLevel.COUNTRY_REGION,
        enabled: false,
      },
    })
    await postSupplier(browser, createPayload(`地区停用 ${randomUUID()}`, {
      registration: {
        countryRegionId: disabledCountry.id,
        number: `DISABLED-${randomUUID()}`,
      },
    }))
      .expect(422)
      .expect((response) => {
        expect(readBody<ApiErrorBody>(response).code).toBe(
          'SUPPLIER_REGION_UNAVAILABLE',
        )
      })

    await postSupplier(browser, createPayload(`地区层级错误 ${randomUUID()}`, {
      primaryAddress: {
        countryRegionId: regionPath.countryId,
        provinceStateId: regionPath.cityId,
        cityId: null,
        addressLine: null,
        postalCode: null,
      },
    }))
      .expect(422)
      .expect((response) => {
        expect(readBody<ApiErrorBody>(response).code).toBe(
          'SUPPLIER_REGION_INVALID',
        )
      })
  })
})
