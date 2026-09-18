import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { PurchaseShipmentFilterDto, PurchaseShipmentListQueryDto } from './purchase-shipment.dto'

const validationOptions = { whitelist: true, forbidNonWhitelisted: true }

describe('purchase shipment read filters', () => {
  it.each(['true', 'false', true, false])('converts only explicit boolean values: %s', async value => {
    const query = plainToInstance(PurchaseShipmentFilterDto, { destinationWarehouseMissing: value })
    expect(await validate(query, validationOptions)).toEqual([])
    expect(query).toMatchObject({ destinationWarehouseMissing: value === 'true' || value === true })
  })

  it.each(['', 'TRUE', 'False', '0', '1', 0, 1, null, [], ['true']])('rejects ambiguous warehouse-missing flags %#', async destinationWarehouseMissing => {
    const query = plainToInstance(PurchaseShipmentFilterDto, { destinationWarehouseMissing })
    expect((await validate(query, validationOptions)).map(error => error.property)).toContain('destinationWarehouseMissing')
  })

  it('normalizes a stable warehouse value without requiring an effective dictionary item', async () => {
    for (const type of [PurchaseShipmentFilterDto, PurchaseShipmentListQueryDto]) {
      const query = plainToInstance(type, { destinationWarehouseValue: '  retired.cn-a_1  ', destinationWarehouseMissing: 'false' })
      expect(await validate(query, validationOptions)).toEqual([])
      expect(query).toMatchObject({ destinationWarehouseValue: 'RETIRED.CN-A_1', destinationWarehouseMissing: false })
    }
  })

  it.each(['', ' ', 'A'.repeat(65), '仓库', 'CN/A', null, 123, ['CN-A']])('rejects malformed stable warehouse values %#', async destinationWarehouseValue => {
    const query = plainToInstance(PurchaseShipmentFilterDto, { destinationWarehouseValue })
    expect((await validate(query, validationOptions)).map(error => error.property)).toContain('destinationWarehouseValue')
  })

  it.each(['CREATED_DESC', 'SHIPPED_DESC', 'WAREHOUSE_RECEIVED_DESC'])('accepts list sort %s while keeping counts free of sort', async sort => {
    expect(await validate(plainToInstance(PurchaseShipmentListQueryDto, { sort }), validationOptions)).toEqual([])
    expect((await validate(plainToInstance(PurchaseShipmentFilterDto, { sort }), validationOptions)).map(error => error.property)).toEqual(['sort'])
  })

  it.each(['SHIPPED_ASC', '', null, ['CREATED_DESC']])('rejects invalid list sort %#', async sort => {
    expect((await validate(plainToInstance(PurchaseShipmentListQueryDto, { sort }), validationOptions)).map(error => error.property)).toContain('sort')
  })

  it('keeps new filters optional for existing consumers', async () => {
    expect(await validate(plainToInstance(PurchaseShipmentFilterDto, {}), validationOptions)).toEqual([])
    expect(await validate(plainToInstance(PurchaseShipmentListQueryDto, { view: 'ALL', page: '2' }), validationOptions)).toEqual([])
  })
})
