import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { OperationsOceanChangeController } from './operations-ocean-change.controller'
import { OperationsOceanChangeService } from './operations-ocean-change.service'

@Module({ controllers: [OperationsOceanChangeController], providers: [{ provide: OperationsOceanChangeService, useValue: {} }] })
class ContractModule {}

describe('operations ocean line change contract', () => {
  it('requires both sales read and update permissions for commit and undo', () => {
    const reflector = new Reflector()
    for (const action of ['change', 'undo'] as const) expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, OperationsOceanChangeController.prototype[action])).toEqual(['sales-orders:read', 'sales-orders:update'])
  })
  it('publishes private CSRF-protected mutations with explicit confirmation and optimistic version contracts', async () => {
    const document = await createOpenApiDocument(ContractModule), root = '/api/operations/ocean-containers/{id}/items/{itemId}'
    const undo = document.paths[`${root}/changes/{changeId}/undo`].post!
    const change = document.paths[`${root}/changes`].post!
    for (const operation of [undo, change]) {
      expect(operation).toHaveProperty('x-qianshu-contract', expect.objectContaining({ session: 'required', authorization: true, csrf: true, privateNoStore: true }))
      for (const code of ['401', '403', '404', '409', '422']) expect(operation.responses).toHaveProperty(code)
    }
    expect(undo.operationId).toBe('operations_ocean_container_items_undo_change')
    expect(change.operationId).toBe('operations_ocean_container_items_change')
    expect(document.components?.schemas?.OperationsOceanContainerChangeDto).toHaveProperty('required', ['requestKey', 'kind', 'expectedVersion', 'notificationConfirmed'])
    expect(document.components?.schemas?.OperationsOceanContainerLineDto).toHaveProperty('properties.version')
    expect(document.components?.schemas?.OperationsOceanContainerChangeResultDto).toHaveProperty('properties.changeId')
    expect(Object.keys(document.paths)).toHaveLength(2)
  })
})
