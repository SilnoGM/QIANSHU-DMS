import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { OceanFreightBillController } from './ocean-freight-bill.controller'
import { OceanFreightBillService } from './ocean-freight-bill.service'
import { OceanFreightBillCreateDto, OceanFreightBillLineCreateDto, OceanFreightBillListQueryDto } from './ocean-freight-bill.dto'

@Module({ controllers: [OceanFreightBillController], providers: [{ provide: OceanFreightBillService, useValue: {} }] })
class ContractModule {}
describe('OceanFreightBillController contract', () => {
  it('rejects unsafe pagination and unpersistable search text', async () => {
    for (const input of [{ page: 1e20 }, { keyword: 'bad\u0000query' }]) {
      expect(await validate(plainToInstance(OceanFreightBillListQueryDto, input))).not.toHaveLength(0)
    }
  })
  it('uses read/create/update permission boundaries', () => {
    const reflector = new Reflector()
    expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, OceanFreightBillController.prototype.create)).toEqual(['ocean-freight-bills:create'])
    expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, OceanFreightBillController.prototype.createLine)).toEqual(['ocean-freight-bills:read', 'ocean-freight-bills:update'])
    for (const action of ['list', 'detail', 'lines'] as const) expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, OceanFreightBillController.prototype[action])).toEqual(['ocean-freight-bills:read'])
  })
  it('declares request keys, session, CSRF, error responses and no settlement endpoint', async () => {
    const document = await createOpenApiDocument(ContractModule)
    const root = '/api/ocean-freight-bills'
    expect(document.paths[root].post).toMatchObject({ operationId: 'ocean_freight_bills_create', 'x-qianshu-contract': { csrf: true }, responses: { 201: { headers: { 'X-Request-Id': expect.any(Object) as unknown } }, 409: expect.any(Object) as unknown } })
    expect(document.paths[`${root}/{id}/lines`].post).toMatchObject({ operationId: 'ocean_freight_bill_lines_create', 'x-qianshu-contract': { csrf: true } })
    expect(Object.keys(document.paths)).toEqual([root, `${root}/{id}`, `${root}/{id}/lines`])
    expect(document.components?.schemas?.OceanFreightBillCreateDto).not.toHaveProperty('properties.payableAmountCny')
    expect(document.components?.schemas?.OceanFreightBillLineCreateDto).not.toHaveProperty('properties.reconciliationStatus')
  })
  it('rejects money totals, review state and invalid decimal inputs at DTO boundary', async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true }
    const head = await validate(plainToInstance(OceanFreightBillCreateDto, { billName: 'Bill', twdPerCny: '4.8', netReturnAmountCny: '1' }), options)
    expect(head.map(error => error.property)).toEqual(['netReturnAmountCny'])
    const line = await validate(plainToInstance(OceanFreightBillLineCreateDto, { lineType: 'NORMAL', goodsName: 'Machine', reconciliationStatus: 'CONFIRMED' }), options)
    expect(line.map(error => error.property)).toEqual(['reconciliationStatus'])
    expect(await validate(plainToInstance(OceanFreightBillCreateDto, { billName: 'Bill', twdPerCny: '4.1234567890123' }), options)).not.toHaveLength(0)
  })
})
