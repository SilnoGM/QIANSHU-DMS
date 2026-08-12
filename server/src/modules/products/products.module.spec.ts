import { HTTP_MODULES } from '../../http.modules'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { ProductQueryService } from './product-query.service'
import { ProductsController } from './products.controller'
import { ProductsModule } from './products.module'

describe('ProductsModule metadata', () => {
  it('registers only the read controller and its query dependencies', () => {
    expect(Reflect.getMetadata('imports', ProductsModule)).toEqual([
      PrismaModule,
      DictionaryModule,
    ])
    expect(Reflect.getMetadata('controllers', ProductsModule)).toEqual([
      ProductsController,
    ])
    expect(Reflect.getMetadata('providers', ProductsModule)).toEqual([
      ProductQueryService,
    ])
  })

  it('is registered in the single live HTTP/OpenAPI module list', () => {
    expect(HTTP_MODULES).toContain(ProductsModule)
  })
})
