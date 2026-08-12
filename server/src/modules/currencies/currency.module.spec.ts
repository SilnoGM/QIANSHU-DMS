import { HTTP_MODULES } from '../../http.modules'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { CurrencyCatalogController } from './currency-catalog.controller'
import { CurrencyCommandService } from './currency-command.service'
import { CurrencyLookupService } from './currency-lookup.service'
import { CurrencyModule } from './currency.module'
import { CurrencyQueryService } from './currency-query.service'
import { CurrenciesController } from './currencies.controller'

describe('CurrencyModule metadata', () => {
  it('composes shared database/auth providers and both HTTP boundaries', () => {
    expect(Reflect.getMetadata('imports', CurrencyModule)).toEqual([
      PrismaModule,
      AuthModule,
    ])
    expect(Reflect.getMetadata('controllers', CurrencyModule)).toEqual([
      CurrencyCatalogController,
      CurrenciesController,
    ])
    expect(Reflect.getMetadata('providers', CurrencyModule)).toEqual([
      CurrencyQueryService,
      CurrencyCommandService,
      CurrencyLookupService,
    ])
    expect(Reflect.getMetadata('exports', CurrencyModule)).toEqual([
      CurrencyLookupService,
    ])
  })

  it('is registered in the single live HTTP/OpenAPI module list', () => {
    expect(HTTP_MODULES).toContain(CurrencyModule)
  })
})
