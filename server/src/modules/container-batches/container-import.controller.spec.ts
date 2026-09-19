import { randomUUID } from 'node:crypto'
import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { ContainerImportController } from './container-import.controller'
import { ContainerImportService } from './container-import.service'
import { ContainerImportConfirmDto } from './container-import.dto'

@Module({ controllers: [ContainerImportController], providers: [{ provide: ContainerImportService, useValue: {} }] })
class ContractModule {}
describe('ContainerImportController contract', () => {
  it('requires container read/update and purchase read for preview and confirmation', () => {
    const reflector = new Reflector()
    for (const action of ['preview', 'confirm'] as const) {
      expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, ContainerImportController.prototype[action])).toEqual(['container-batches:read', 'container-batches:update', 'purchase-orders:read'])
    }
  })
  it('exposes a read-only preview and authenticated CSRF-protected idempotent import', async () => {
    const document = await createOpenApiDocument(ContractModule)
    expect(document.paths['/api/container-batches/{id}/import-preview'].get).toMatchObject({ operationId: 'container_import_preview', 'x-qianshu-contract': { csrf: false } })
    expect(document.paths['/api/container-batches/{id}/import'].post).toMatchObject({ operationId: 'container_import_confirm', 'x-qianshu-contract': { csrf: true } })
    expect(document.paths['/api/container-batches/{id}/import'].post?.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Idempotency-Key', required: true })]))
    expect(document.components?.schemas?.ContainerImportRowDto).not.toHaveProperty('properties.sourceData')
  })
  it('accepts only an explicit complete selection envelope and rejects forged business fields', async () => {
    const input = { expectedVersion: 1, sourceFileId: randomUUID(), sourceHash: 'a'.repeat(64), allowUnmatched: false, rows: [{ rowKey: '1:3', shipmentId: randomUUID() }] }
    const options = { whitelist: true, forbidNonWhitelisted: true }
    expect(await validate(plainToInstance(ContainerImportConfirmDto, input), options)).toHaveLength(0)
    for (const body of [{ ...input, rows: [] }, { ...input, allowUnmatched: undefined }, { ...input, sourceHash: 'short' }, { ...input, rows: [{ rowKey: '1:3', shipmentId: null, goodsName: 'forged' }] }]) {
      expect(await validate(plainToInstance(ContainerImportConfirmDto, body), options)).not.toHaveLength(0)
    }
  })
})
