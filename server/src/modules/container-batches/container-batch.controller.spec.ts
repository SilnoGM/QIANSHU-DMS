import { randomUUID } from 'node:crypto'
import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { ContainerBatchController } from './container-batch.controller'
import { ContainerBatchService } from './container-batch.service'
import { ContainerBatchCreateDto, ContainerBatchUpdateDto, ContainerLoadingItemCreateDto } from './container-batch.dto'

@Module({ controllers: [ContainerBatchController], providers: [{ provide: ContainerBatchService, useValue: {} }] })
class ContractModule {}
describe('ContainerBatchController foundation contract', () => {
  it('protects queries and commands with their dedicated permissions', () => {
    const reflector = new Reflector()
    expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, ContainerBatchController.prototype.create)).toEqual(['container-batches:create'])
    expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, ContainerBatchController.prototype.createItem)).toEqual(['container-batches:update'])
    for (const action of ['list', 'get', 'items'] as const) expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, ContainerBatchController.prototype[action])).toEqual(['container-batches:read'])
  })
  it('publishes authenticated, idempotent foundations without physical shipment actions', async () => {
    const document = await createOpenApiDocument(ContractModule)
    const root = '/api/container-batches'
    expect(Object.keys(document.paths)).toEqual([root, `${root}/{id}`, `${root}/{id}/items`, `${root}/{id}/items/{itemId}`])
    expect(document.paths[`${root}/{id}`].patch?.operationId).toBe('container_batches_update')
    expect(document.paths[`${root}/{id}/items/{itemId}`].patch?.operationId).toBe('container_loading_items_update')
    expect(document.paths[root].post).toMatchObject({ operationId: 'container_batches_create', 'x-qianshu-contract': { csrf: true }, responses: { 201: expect.any(Object) as unknown, 409: expect.any(Object) as unknown } })
    expect(document.paths[`${root}/{id}/items`].post?.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Idempotency-Key', required: true })]))
    expect(document.paths[root].get?.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'page', schema: expect.objectContaining({ type: 'number' }) as unknown }),
      expect.objectContaining({ name: 'pageSize', schema: expect.objectContaining({ type: 'number' }) as unknown }),
    ]))
    expect(document.components?.schemas?.ContainerBatchCreateDto).not.toHaveProperty('properties.containerBatchNo')
    expect(document.components?.schemas?.ContainerLoadingItemCreateDto).not.toHaveProperty('properties.shipmentStatus')
  })
  it('rejects client-owned numbering and computed quantities at the HTTP boundary', async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true }
    const head = await validate(plainToInstance(ContainerBatchCreateDto, { containerBatchName: '0917柜', warehouseValue: 'B5', sourceFileId: randomUUID(), containerBatchNo: 'FORGED' }), options)
    expect(head.map(error => error.property)).toEqual(['containerBatchNo'])
    const item = await validate(plainToInstance(ContainerLoadingItemCreateDto, { expectedVersion: 1, goodsName: 'Machine', packageCount: 10, volumeCai: '12.88' }), options)
    expect(item.map(error => error.property)).toEqual(['volumeCai'])
    expect(await validate(plainToInstance(ContainerLoadingItemCreateDto, { goodsName: 'Machine', packageCount: 1 }), options)).not.toHaveLength(0)
  })
  it('requires sourceFileId on create but accepts historical updates without it', async () => {
    const fields = { containerBatchName: '0917柜', warehouseValue: 'B5' }
    for (const sourceFileId of [undefined, null]) {
      const errors = await validate(plainToInstance(ContainerBatchCreateDto, { ...fields, sourceFileId }))
      expect(errors.map(error => error.property)).toEqual(['sourceFileId'])
    }
    expect(await validate(plainToInstance(ContainerBatchCreateDto, { ...fields, sourceFileId: randomUUID() }))).toHaveLength(0)
    expect(await validate(plainToInstance(ContainerBatchUpdateDto, { ...fields, expectedVersion: 1 }))).toHaveLength(0)
    const document = await createOpenApiDocument(ContractModule)
    expect(document.components?.schemas?.ContainerBatchCreateDto).toHaveProperty('required', expect.arrayContaining(['sourceFileId']))
    expect(document.components?.schemas?.ContainerBatchUpdateDto).not.toHaveProperty('required', expect.arrayContaining(['sourceFileId']))
  })
  it('accepts decimal measurement strings, exposes derived volume and rejects numeric JSON measurements', async () => {
    const base = { expectedVersion: 1, goodsName: 'Machine', packageCount: 10 }
    const options = { whitelist: true, forbidNonWhitelisted: true }
    expect(await validate(plainToInstance(ContainerLoadingItemCreateDto, { ...base, lengthCm: '128', widthCm: '19', heightCm: '15', grossWeightKg: '180', reportedVolumeCai: '12.88' }), options)).toHaveLength(0)
    const invalid = await validate(plainToInstance(ContainerLoadingItemCreateDto, { ...base, lengthCm: 128, chargeableVolumeCai: 13, volumeDifferenceCai: '0' }), options)
    expect(invalid.map(error => error.property).sort()).toEqual(['chargeableVolumeCai', 'lengthCm', 'volumeDifferenceCai'])
    const document = await createOpenApiDocument(ContractModule)
    for (const property of ['grossWeightKg', 'lengthCm', 'widthCm', 'heightCm', 'reportedVolumeCai', 'volumeCai', 'volumeDifferenceCai']) {
      expect(document.components?.schemas?.ContainerLoadingItemDto).toHaveProperty(`properties.${property}`, expect.objectContaining({ type: 'string', nullable: true }))
    }
    expect(document.components?.schemas?.ContainerLoadingItemDto).toHaveProperty('properties.chargeableVolumeCai', expect.objectContaining({ type: 'number', nullable: true }))
  })
})
