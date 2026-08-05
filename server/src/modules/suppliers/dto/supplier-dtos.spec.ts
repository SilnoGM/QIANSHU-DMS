import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { SupplierEntityType } from '../../../generated/prisma/enums'
import {
  ChangeSupplierStatusRequestDto,
  CreateSupplierRequestDto,
  UpdateSupplierRequestDto,
} from './supplier-command.dto'
import {
  SupplierIdParamDto,
  SupplierListQueryDto,
  SupplierSortBy,
  SupplierSortOrder,
  SupplierStatusFilter,
} from './supplier-management.dto'

const COUNTRY_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'

async function errorPaths<T extends object>(
  type: new () => T,
  input: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  })
  const paths: string[] = []
  const visit = (items: typeof errors, parent = ''): void => {
    for (const item of items) {
      const path = parent ? `${parent}.${item.property}` : item.property
      if (item.constraints) paths.push(path)
      visit(item.children ?? [], path)
    }
  }
  visit(errors)
  return paths.sort()
}

describe('supplier command DTO validation', () => {
  it('accepts a complete create and a minimal disabled draft', async () => {
    expect(await errorPaths(CreateSupplierRequestDto, {
      legalName: '示例供应商',
      entityType: SupplierEntityType.ORGANIZATION,
    })).toEqual([])
    expect(await errorPaths(CreateSupplierRequestDto, {
      legalName: '个体供应商',
      shortName: null,
      entityType: SupplierEntityType.INDIVIDUAL,
      registration: { countryRegionId: COUNTRY_ID, number: '9133-01' },
      primaryContact: { name: null, phone: null, wechatId: null },
      primaryAddress: {
        countryRegionId: COUNTRY_ID,
        provinceStateId: null,
        cityId: null,
        addressLine: null,
        postalCode: null,
      },
      remark: null,
    })).toEqual([])
  })

  it('requires complete nested replacement objects and rejects identity fields', async () => {
    expect(await errorPaths(CreateSupplierRequestDto, {
      legalName: '示例供应商',
      entityType: SupplierEntityType.ORGANIZATION,
      registration: { countryRegionId: COUNTRY_ID },
      primaryContact: { name: null },
      primaryAddress: { countryRegionId: COUNTRY_ID },
      code: 'SUP-1',
      enabled: false,
      version: 1,
    })).toEqual([
      'code',
      'enabled',
      'primaryAddress.addressLine',
      'primaryAddress.cityId',
      'primaryAddress.postalCode',
      'primaryAddress.provinceStateId',
      'primaryContact.phone',
      'primaryContact.wechatId',
      'registration.number',
      'version',
    ])
  })

  it('rejects invalid entity, UUIDs and scalar types', async () => {
    expect(await errorPaths(CreateSupplierRequestDto, {
      legalName: 123,
      entityType: 'PUBLIC_BODY',
      registration: { countryRegionId: 'country', number: 123 },
      primaryContact: 'contact',
      primaryAddress: [],
      remark: 1,
    })).toEqual(expect.arrayContaining([
      'entityType',
      'legalName',
      'primaryAddress',
      'primaryContact',
      'registration.countryRegionId',
      'registration.number',
      'remark',
    ]))
  })

  it('preserves PATCH group tri-state and requires one mutable field', async () => {
    expect(await errorPaths(UpdateSupplierRequestDto, {
      expectedVersion: 1,
      primaryContact: null,
    })).toEqual([])
    expect(await errorPaths(UpdateSupplierRequestDto, {
      expectedVersion: 1,
      primaryContact: { name: null, phone: null, wechatId: null },
    })).toEqual([])
    expect(await errorPaths(UpdateSupplierRequestDto, {
      expectedVersion: 1,
    })).toContain('legalName')
  })

  it('requires positive int32 expectedVersion for update and status changes', async () => {
    expect(await errorPaths(ChangeSupplierStatusRequestDto, {
      expectedVersion: 2_147_483_647,
    })).toEqual([])
    expect(await errorPaths(UpdateSupplierRequestDto, {
      legalName: '新名称',
      expectedVersion: 0,
    })).toContain('expectedVersion')
    expect(await errorPaths(ChangeSupplierStatusRequestDto, {
      expectedVersion: 2_147_483_648,
    })).toContain('expectedVersion')
  })
})

describe('supplier management query DTO validation', () => {
  it('defaults pagination and accepts the complete filter/sort contract', async () => {
    const defaults = plainToInstance(SupplierListQueryDto, {})
    expect(await validate(defaults)).toEqual([])
    expect(defaults).toMatchObject({ page: 1, pageSize: 20 })

    expect(await errorPaths(SupplierListQueryDto, {
      query: '  示例供方  ',
      status: SupplierStatusFilter.ENABLED,
      entityType: SupplierEntityType.ORGANIZATION,
      page: '2',
      pageSize: '100',
      sortBy: SupplierSortBy.LEGAL_NAME,
      sortOrder: SupplierSortOrder.ASC,
    })).toEqual([])
  })

  it('rejects whitespace queries, unknown filters and invalid pagination', async () => {
    expect(await errorPaths(SupplierListQueryDto, {
      query: ' \u0085 ',
      status: 'ARCHIVED',
      entityType: 'PUBLIC_BODY',
      page: '0',
      pageSize: '101',
      sortBy: 'registrationNumber',
      sortOrder: 'sideways',
    })).toEqual([
      'entityType',
      'page',
      'pageSize',
      'query',
      'sortBy',
      'sortOrder',
      'status',
    ])
  })

  it('requires a valid supplier UUID path parameter', async () => {
    expect(await errorPaths(SupplierIdParamDto, {
      supplierId: COUNTRY_ID,
    })).toEqual([])
    expect(await errorPaths(SupplierIdParamDto, {
      supplierId: 'not-a-uuid',
    })).toEqual(['supplierId'])
  })
})
