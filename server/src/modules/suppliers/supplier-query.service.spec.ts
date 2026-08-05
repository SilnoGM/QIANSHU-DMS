import { HttpStatus } from '@nestjs/common'

import { SupplierEntityType } from '../../generated/prisma/enums'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { applyTransactionTimeouts } from '../../infrastructure/database/transaction-timeouts'
import { ApiException } from '../../infrastructure/http/api.exception'
import {
  SupplierSortBy,
  SupplierSortOrder,
  SupplierStatusFilter,
} from './dto/supplier-management.dto'
import { SupplierQueryService } from './supplier-query.service'

jest.mock(
  '../../infrastructure/database/transaction-timeouts',
  () => ({ applyTransactionTimeouts: jest.fn().mockResolvedValue(undefined) }),
)

const mockedApplyTransactionTimeouts = jest.mocked(applyTransactionTimeouts)
const SUPPLIER_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const COUNTRY_ID = 'ba6e6036-42c7-489b-b22b-238c3d36a879'
const PROVINCE_ID = '5f6ddb91-c9a0-4ee4-a1de-e2587128fdc3'
const CITY_ID = '29a605c9-04e3-4099-91eb-63fa1e8c1961'

interface CountArgs {
  readonly where?: unknown
}

interface FindManyArgs extends CountArgs {
  readonly select?: Record<string, unknown>
  readonly orderBy?: unknown
  readonly skip?: number
  readonly take?: number
}

interface FindUniqueArgs {
  readonly where: { readonly id: string }
  readonly select?: Record<string, unknown>
}

function supplierRow() {
  return {
    id: SUPPLIER_ID,
    code: 'SUP-0001',
    legalName: '示例供应商',
    shortName: '示例',
    entityType: SupplierEntityType.ORGANIZATION,
    registrationCountryRegionId: COUNTRY_ID,
    registrationNumber: 'SECRET-REGISTRATION',
    contactName: '张三',
    contactPhone: '13800000000',
    contactWechatId: 'secret-wechat',
    addressCountryRegionId: COUNTRY_ID,
    addressProvinceStateId: PROVINCE_ID,
    addressCityId: CITY_ID,
    addressLine: 'SECRET-ADDRESS',
    postalCode: 'SECRET-POSTAL',
    remark: 'SECRET-REMARK',
    enabled: false,
    version: 3,
    createdAt: new Date('2026-08-05T01:00:00.000Z'),
    updatedAt: new Date('2026-08-05T02:00:00.000Z'),
    registrationCountryRegion: { id: COUNTRY_ID, name: '中国' },
    addressCountryRegion: { id: COUNTRY_ID, name: '中国' },
    addressProvinceState: { id: PROVINCE_ID, name: '广东省' },
    addressCity: { id: CITY_ID, name: '深圳市' },
  }
}

function createFixture() {
  const count = jest
    .fn<Promise<number>, [CountArgs]>()
    .mockResolvedValue(1)
  const findMany = jest
    .fn<Promise<unknown[]>, [FindManyArgs]>()
    .mockResolvedValue([supplierRow()])
  const transactionClient = { supplier: { count, findMany } }
  const transaction = jest.fn().mockImplementation(
    (callback: (client: typeof transactionClient) => unknown) =>
      callback(transactionClient),
  )
  const findUnique = jest
    .fn<Promise<unknown>, [FindUniqueArgs]>()
    .mockResolvedValue(supplierRow())
  const prisma = {
    $transaction: transaction,
    supplier: { findUnique },
  } as unknown as PrismaService
  return {
    count,
    findMany,
    findUnique,
    transaction,
    transactionClient,
    service: new SupplierQueryService(prisma),
  }
}

async function expectApiError(
  action: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  try {
    await action()
    throw new Error('Expected action to reject')
  } catch (error) {
    expect(error).toBeInstanceOf(ApiException)
    expect(error).toMatchObject({ code })
    expect((error as ApiException).getStatus()).toBe(status)
  }
}

describe('SupplierQueryService list', () => {
  beforeEach(() => mockedApplyTransactionTimeouts.mockClear())

  it('uses one timed transaction, explicit minimal select and stable defaults', async () => {
    const fixture = createFixture()
    const result = await fixture.service.list({})

    expect(result).toEqual({
      items: [{
        id: SUPPLIER_ID,
        code: 'SUP-0001',
        legalName: '示例供应商',
        shortName: '示例',
        entityType: SupplierEntityType.ORGANIZATION,
        registrationCountryRegion: { id: COUNTRY_ID, name: '中国' },
        primaryContactName: '张三',
        hasPrimaryContactPhone: true,
        hasPrimaryContactWechatId: true,
        primaryAddressRegionPath: [
          { id: COUNTRY_ID, name: '中国' },
          { id: PROVINCE_ID, name: '广东省' },
          { id: CITY_ID, name: '深圳市' },
        ],
        enabled: false,
        version: 3,
        updatedAt: '2026-08-05T02:00:00.000Z',
      }],
      page: 1,
      pageSize: 20,
      total: 1,
    })
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET-(?:REGISTRATION|ADDRESS|POSTAL|REMARK)|secret-wechat|13800000000/u,
    )
    expect(fixture.transaction).toHaveBeenCalledTimes(1)
    expect(mockedApplyTransactionTimeouts).toHaveBeenCalledWith(
      fixture.transactionClient,
    )
    expect(fixture.count).toHaveBeenCalledTimes(1)
    expect(fixture.findMany).toHaveBeenCalledTimes(1)
    expect(fixture.findMany.mock.calls[0]?.[0]).toMatchObject({
      skip: 0,
      take: 20,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    })
    const select = fixture.findMany.mock.calls[0]?.[0].select
    expect(select).not.toHaveProperty('registrationNumber')
    expect(select).not.toHaveProperty('addressLine')
    expect(select).not.toHaveProperty('postalCode')
    expect(select).not.toHaveProperty('remark')
    expect(select).not.toHaveProperty('normalizedLegalName')
    expect(select).not.toHaveProperty('numberingIssuanceId')
  })

  it('normalizes all search variants and applies whitelisted filters/order', async () => {
    const fixture = createFixture()
    fixture.count.mockResolvedValue(0)
    fixture.findMany.mockResolvedValue([])

    await fixture.service.list({
      query: ' ＡＢ (138)-01 ',
      status: SupplierStatusFilter.ENABLED,
      entityType: SupplierEntityType.INDIVIDUAL,
      page: 2,
      pageSize: 100,
      sortBy: SupplierSortBy.LEGAL_NAME,
      sortOrder: SupplierSortOrder.ASC,
    })

    const countArgs = fixture.count.mock.calls[0]?.[0]
    const rowArgs = fixture.findMany.mock.calls[0]?.[0]
    expect(rowArgs).toMatchObject({
      skip: 100,
      take: 100,
      orderBy: [{ normalizedLegalName: 'asc' }, { id: 'asc' }],
    })
    expect(rowArgs.where).toEqual(countArgs.where)
    expect(rowArgs.where).toMatchObject({
      enabled: true,
      entityType: SupplierEntityType.INDIVIDUAL,
    })
    expect(JSON.stringify(rowArgs.where)).toContain('ab (138)-01')
    expect(JSON.stringify(rowArgs.where)).toContain('AB(138)-01')
    expect(JSON.stringify(rowArgs.where)).toContain('AB13801')
  })

  it('rejects invalid direct inputs before opening a transaction', async () => {
    const fixture = createFixture()
    await expectApiError(
      () => fixture.service.list({ page: 0, pageSize: 101 }),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
    )
    expect(fixture.transaction).not.toHaveBeenCalled()
  })

  it('maps unexpected database failures to a fixed safe error', async () => {
    const fixture = createFixture()
    fixture.count.mockRejectedValue(new Error('postgres://secret'))
    await expectApiError(
      () => fixture.service.list({}),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })
})

describe('SupplierQueryService detail', () => {
  it('returns complete business fields and server-computed enable readiness', async () => {
    const fixture = createFixture()
    const detail = await fixture.service.getById(SUPPLIER_ID)

    expect(detail).toEqual({
      id: SUPPLIER_ID,
      code: 'SUP-0001',
      legalName: '示例供应商',
      shortName: '示例',
      entityType: SupplierEntityType.ORGANIZATION,
      registration: {
        countryRegion: { id: COUNTRY_ID, name: '中国' },
        number: 'SECRET-REGISTRATION',
      },
      primaryContact: {
        name: '张三',
        phone: '13800000000',
        wechatId: 'secret-wechat',
      },
      primaryAddress: {
        countryRegionId: COUNTRY_ID,
        provinceStateId: PROVINCE_ID,
        cityId: CITY_ID,
        regionPath: [
          { id: COUNTRY_ID, name: '中国' },
          { id: PROVINCE_ID, name: '广东省' },
          { id: CITY_ID, name: '深圳市' },
        ],
        addressLine: 'SECRET-ADDRESS',
        postalCode: 'SECRET-POSTAL',
      },
      remark: 'SECRET-REMARK',
      enabled: false,
      enableReadiness: { ready: true, missingFields: [] },
      version: 3,
      createdAt: '2026-08-05T01:00:00.000Z',
      updatedAt: '2026-08-05T02:00:00.000Z',
    })
    const select = fixture.findUnique.mock.calls[0]?.[0].select
    expect(select).not.toHaveProperty('normalizedLegalName')
    expect(select).not.toHaveProperty('normalizedRegistrationNumber')
    expect(select).not.toHaveProperty('numberingIssuanceId')
    expect(select).not.toHaveProperty('createRequest')
  })

  it('reports readiness gaps without making registration or address required', async () => {
    const fixture = createFixture()
    fixture.findUnique.mockResolvedValue({
      ...supplierRow(),
      registrationCountryRegionId: null,
      registrationNumber: null,
      registrationCountryRegion: null,
      contactName: null,
      contactPhone: null,
      contactWechatId: null,
      addressCountryRegionId: null,
      addressProvinceStateId: null,
      addressCityId: null,
      addressCountryRegion: null,
      addressProvinceState: null,
      addressCity: null,
      addressLine: null,
      postalCode: null,
    })

    await expect(fixture.service.getById(SUPPLIER_ID)).resolves.toMatchObject({
      registration: null,
      primaryAddress: null,
      enableReadiness: {
        ready: false,
        missingFields: ['primaryContact.name', 'primaryContact.channel'],
      },
    })
  })

  it('returns stable not-found/validation errors and hides database details', async () => {
    const missing = createFixture()
    missing.findUnique.mockResolvedValue(null)
    await expectApiError(
      () => missing.service.getById(SUPPLIER_ID),
      HttpStatus.NOT_FOUND,
      'SUPPLIER_NOT_FOUND',
    )

    const invalid = createFixture()
    await expectApiError(
      () => invalid.service.getById('not-a-uuid'),
      HttpStatus.UNPROCESSABLE_ENTITY,
      'VALIDATION_FAILED',
    )
    expect(invalid.findUnique).not.toHaveBeenCalled()

    const failed = createFixture()
    failed.findUnique.mockRejectedValue(new Error('database secret'))
    await expectApiError(
      () => failed.service.getById(SUPPLIER_ID),
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
    )
  })
})
