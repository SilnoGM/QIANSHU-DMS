import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { ContainerSourceFileController } from './container-source-file.controller'
import { CONTAINER_SOURCE_MIME, ContainerSourceFileService } from './container-source-file.service'

@Module({ controllers: [ContainerSourceFileController], providers: [{ provide: ContainerSourceFileService, useValue: {} }] })
class ContractModule {}
describe('Container source file HTTP contract', () => {
  it('requires read/update to prepare uploads and read for attached files', () => {
    const reflector = new Reflector()
    expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, ContainerSourceFileController.prototype.upload)).toEqual(['container-batches:read', 'container-batches:update'])
    for (const method of ['metadata', 'download', 'head'] as const) {
      expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, ContainerSourceFileController.prototype[method])).toEqual(['container-batches:read'])
    }
  })
  it('documents session, csrf, xlsx binary response and safe metadata', async () => {
    const document = await createOpenApiDocument(ContractModule)
    const upload = document.paths['/api/container-batches/{id}/source-file-uploads'].post
    expect(upload).toMatchObject({ operationId: 'container_source_files_upload', 'x-qianshu-contract': { session: 'required', csrf: true } })
    const get = document.paths['/api/container-batches/{id}/source-file/content'].get
    expect(get?.responses[200]).toMatchObject({ content: { [CONTAINER_SOURCE_MIME]: { schema: { type: 'string', format: 'binary' } } } })
    expect(document.components?.schemas?.ContainerSourceFileDto).not.toHaveProperty('properties.objectKey')
    expect(document.paths['/api/container-batches/{id}/source-file/content'].head?.responses[200]).not.toHaveProperty('content')
  })
})
