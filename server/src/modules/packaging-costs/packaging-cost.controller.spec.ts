import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { PackagingCostController } from './packaging-cost.controller'
import { PackagingCostService } from './packaging-cost.service'
import { PackagingCostQueryService } from './packaging-cost-query.service'
import { PackagingCostImageService } from './packaging-cost-image.service'
import { PackagingCostListQueryDto, PackagingCostRequestCreateDto, PackagingCostRequestPayDto } from './packaging-cost.dto'

@Module({ controllers: [PackagingCostController], providers: [PackagingCostService, PackagingCostQueryService, PackagingCostImageService].map(provide => ({ provide, useValue: {} })) })
class ContractModule {}

describe('PackagingCostController contract', () => {
  it('separates operations submission and finance reading/payment permissions', () => {
    const reflector = new Reflector()
    for (const method of ['submit', 'upload', 'shipmentContext'] as const) expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, PackagingCostController.prototype[method])).toEqual(['packaging-costs:create'])
    for (const method of ['list', 'detail', 'image', 'headImage'] as const) expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, PackagingCostController.prototype[method])).toEqual(['packaging-costs:read'])
    expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, PackagingCostController.prototype.pay)).toEqual(['packaging-costs:read', 'packaging-costs:pay'])
  })
  it('documents all operations with private responses, CSRF on writes and a fixed payment amount', async () => {
    const document = await createOpenApiDocument(ContractModule)
    const root = '/api/packaging-cost-requests'
    expect(document.paths[root].post).toMatchObject({ operationId: 'packaging_costs_create', responses: { 201: { headers: { 'X-Request-Id': expect.any(Object) as unknown } }, 409: expect.any(Object) as unknown } })
    expect(document.paths[`${root}/images`].post).toMatchObject({ operationId: 'packaging_costs_upload_image', requestBody: { content: { 'multipart/form-data': { schema: { required: ['mediaType', 'file'] } } } } })
    expect(document.paths[`${root}/shipment-context/{shipmentId}`].get).toMatchObject({ operationId: 'packaging_costs_shipment_context' })
    expect(document.paths[`${root}/{id}/pay`].post).toMatchObject({ operationId: 'packaging_costs_pay', responses: { 200: expect.any(Object) as unknown, 403: expect.any(Object) as unknown, 409: expect.any(Object) as unknown } })
    expect(document.paths[`${root}/{id}/pay`].post).toMatchObject({
      'x-qianshu-contract': { errors: expect.arrayContaining([
        { status: 422, codes: expect.arrayContaining(['PACKAGING_COST_POSTING_UNAVAILABLE']) as unknown },
      ]) as unknown },
    })
    expect(document.components?.schemas?.PackagingCostRequestPayDto).toMatchObject({ required: ['recipientAccountId', 'recipientProfileVersion', 'paymentMethod', 'voucher', 'expectedVersion'], properties: { expectedVersion: expect.any(Object) as unknown } })
    expect(document.components?.schemas?.PackagingCostRequestPayDto).not.toHaveProperty('properties.amount')
    for (const method of ['get', 'head'] as const) expect(document.paths[`${root}/{id}/images/{kind}`][method]?.responses).toHaveProperty('304')
    expect(document.paths[`${root}/{id}/images/{kind}`].get?.responses[200]).toMatchObject({ content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': expect.any(Object) as unknown, 'image/webp': expect.any(Object) as unknown } })
  })
  it('rejects forged owner, amount override, invalid evidence and unknown filter values', async () => {
    const id = '00000000-0000-4000-8000-000000000001'
    const options = { whitelist: true, forbidNonWhitelisted: true }
    expect((await validate(plainToInstance(PackagingCostRequestCreateDto, { shipmentId: id, packagingType: 'WOODEN_BOX', packagingVendor: 'OTHER', amount: '2.00', packagingImageMediaAssetId: id, quotationImageMediaAssetId: id, ownerUserId: id }), options)).map(error => error.property)).toContain('ownerUserId')
    expect((await validate(plainToInstance(PackagingCostRequestPayDto, { expectedVersion: 1, recipientAccountId: id, recipientProfileVersion: 1, paymentMethod: 'ALIPAY', voucher: { mediaAssetId: id }, amount: '1' }), options)).map(error => error.property)).toEqual(['amount'])
    for (const input of [{ page: 0 }, { pageSize: 101 }, { status: 'APPROVED' }, { keyword: 'x'.repeat(129) }]) expect((await validate(plainToInstance(PackagingCostListQueryDto, input), options)).length).toBeGreaterThan(0)
  })
})
