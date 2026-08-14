import { HTTP_MODULES } from '../../http.modules'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { CurrencyModule } from '../currencies/currency.module'
import { DictionaryModule } from '../dictionaries/dictionary.module'
import { NumberingModule } from '../numbering/numbering.module'
import { MediaModule } from '../media/media.module'
import { ProductMediaContentService } from './media/product-media-content.service'
import { ProductMediaHttpService } from './media/product-media-http.service'
import { ProductMediaMultipartParser } from './media/product-media-multipart.parser'
import { ProductMediaPersistence } from './media/product-media.persistence'
import { ProductMediaService } from './media/product-media.service'
import { ProductCommandService } from './product-command.service'
import { ProductQueryService } from './product-query.service'
import { ProductUpdateService } from './product-update.service'
import { ProductsController } from './products.controller'
import { ProductsModule } from './products.module'

describe('ProductsModule metadata', () => {
  it('registers the confirmed query/create/update dependencies only', () => {
    expect(Reflect.getMetadata('imports', ProductsModule)).toEqual([
      PrismaModule,
      DictionaryModule,
      AuthModule,
      CurrencyModule,
      NumberingModule,
      MediaModule,
    ])
    expect(Reflect.getMetadata('controllers', ProductsModule)).toEqual([
      ProductsController,
    ])
    expect(Reflect.getMetadata('providers', ProductsModule)).toEqual([
      ProductQueryService,
      ProductCommandService,
      ProductUpdateService,
      ProductMediaPersistence,
      ProductMediaService,
      ProductMediaHttpService,
      ProductMediaContentService,
      expect.objectContaining({ provide: ProductMediaMultipartParser }),
    ])
  })

  it('is registered in the single live HTTP/OpenAPI module list', () => {
    expect(HTTP_MODULES).toContain(ProductsModule)
  })
})
