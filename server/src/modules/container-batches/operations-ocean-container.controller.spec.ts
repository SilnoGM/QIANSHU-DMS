import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { ContainerBatchListQueryDto } from './container-batch.dto'
import { OperationsOceanContainerController } from './operations-ocean-container.controller'
import { OperationsOceanContainerService } from './operations-ocean-container.service'

@Module({ controllers: [OperationsOceanContainerController], providers: [{ provide: OperationsOceanContainerService, useValue: {} }] })
class ContractModule {}

describe('operations ocean containers contract', () => {
  it('uses sales reading permission for every operation without requiring cabinet management access', () => {
    const reflector = new Reflector()
    for (const action of ['list', 'listAll', 'itemsAll', 'itemAll', 'items', 'item'] as const) {
      expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, OperationsOceanContainerController.prototype[action])).toEqual(['sales-orders:read'])
    }
  })

  it('publishes only authenticated private reads and a narrow overview', async () => {
    const document = await createOpenApiDocument(ContractModule)
    const root = '/api/operations/ocean-containers'
    expect(Object.keys(document.paths)).toEqual([root, `${root}/all`, `${root}/all/{id}/items`, `${root}/all/{id}/items/{itemId}`, `${root}/{id}/items`, `${root}/{id}/items/{itemId}`])
    for (const path of Object.values(document.paths)) {
      expect(Object.keys(path)).toEqual(['get'])
      expect(path.get).toHaveProperty('x-qianshu-contract', expect.objectContaining({ session: 'required', authorization: true, privateNoStore: true }))
      expect(path.get?.responses).toHaveProperty('401')
      expect(path.get?.responses).toHaveProperty('403')
    }
    expect(document.components?.schemas?.OperationsOceanContainerPageDto).toHaveProperty('properties.dataScope')
    expect(document.components?.schemas?.OperationsOceanContainerDto).toHaveProperty('properties.myItemCount')
    for (const field of ['sourceFileId', 'createdById', 'remark', 'items', 'version']) {
      expect(document.components?.schemas?.OperationsOceanContainerDto).not.toHaveProperty(`properties.${field}`)
    }
    for (const field of ['salesOrderId', 'salesOrderNo', 'purchaseOrderId', 'purchaseOrderNo']) {
      expect(document.components?.schemas?.OperationsOceanContainerLineDto).toHaveProperty(`properties.${field}`)
    }
    for (const field of ['sourceData', 'shipmentId']) {
      expect(document.components?.schemas?.OperationsOceanContainerLineDto).not.toHaveProperty(`properties.${field}`)
    }
    expect(document.components?.schemas?.OperationsOceanContainerAllLineDto).toHaveProperty('properties.mine')
    for (const field of ['issuerUserId', 'sourceData', 'shipmentId']) {
      expect(document.components?.schemas?.OperationsOceanContainerAllLineDto).not.toHaveProperty(`properties.${field}`)
    }
  })

  it('rejects caller-selected ownership and malformed paging parameters', async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true }
    for (const input of [{ issuerUserId: 'other-user' }, { actorUserId: 'other-user' }, { page: 0 }, { pageSize: 1000 }]) {
      expect(await validate(plainToInstance(ContainerBatchListQueryDto, input), options)).not.toHaveLength(0)
    }
  })
})
