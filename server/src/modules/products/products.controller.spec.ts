import { HttpStatus, Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { ProductQueryService } from './product-query.service'
import { ProductsController } from './products.controller'

type ContractOperation = NonNullable<
  OpenAPIObject['paths'][string]['get']
> & { 'x-qianshu-contract'?: unknown }

function createController(): {
  readonly controller: ProductsController
  readonly list: jest.Mock
} {
  const list = jest.fn().mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  })
  return {
    controller: new ProductsController({ list } as unknown as ProductQueryService),
    list,
  }
}

@Module({
  controllers: [ProductsController],
  providers: [{
    provide: ProductQueryService,
    useValue: { list: jest.fn() },
  }],
})
class ProductsControllerContractModule {}

describe('ProductsController', () => {
  it('delegates only the confirmed list query and requires products:read', async () => {
    const fixture = createController()
    const query = {
      keyword: 'Product-001',
      page: 2,
      pageSize: 50,
      supplierValue: 'SUPPLIER_A',
    }

    await fixture.controller.list(query)

    expect(fixture.list).toHaveBeenCalledWith(query)
    expect(new Reflector().get(
      REQUIRED_PERMISSIONS_METADATA,
      ProductsController.prototype.list,
    )).toEqual(['products:read'])
    expect(Object.getOwnPropertyNames(ProductsController.prototype).sort())
      .toEqual(['constructor', 'list'])
  })
})

describe('ProductsController OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(ProductsControllerContractModule)
  })

  it('publishes one private no-store GET with exact errors and no mutations', () => {
    const path = document.paths['/api/products']
    const operation: ContractOperation | undefined = path?.get
    expect(operation?.operationId).toBe('products_list')
    expect(Object.keys(path ?? {}).sort()).toEqual(['get'])
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '422',
      '500',
    ])
    expect(operation?.security).toEqual([{ sessionCookie: [] }])
    const keywordParameter = operation?.parameters?.find(parameter =>
      'name' in parameter && parameter.name === 'keyword')
    expect(keywordParameter).toEqual({
      description: '产品名称或产品编号，不区分大小写的包含匹配',
      in: 'query',
      name: 'keyword',
      required: false,
      schema: {
        maxLength: 128,
        minLength: 1,
        type: 'string',
      },
    })
    expect(operation?.['x-qianshu-contract']).toEqual({
      kind: 'application',
      authentication: true,
      authorization: true,
      resourceLocator: false,
      conflict: false,
      validation: true,
      session: 'required',
      privateNoStore: true,
      errors: [
        { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
        { status: 422, codes: ['VALIDATION_FAILED'] },
      ],
    })
    expect(operation?.responses?.[String(HttpStatus.OK)]).toBeDefined()
  })
})
