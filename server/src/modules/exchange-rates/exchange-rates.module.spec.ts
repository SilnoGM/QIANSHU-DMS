import { HTTP_MODULES } from '../../http.modules'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { ExchangeRateCommandService } from './exchange-rate-command.service'
import { ExchangeRateQueryService } from './exchange-rate-query.service'
import { ExchangeRatesController } from './exchange-rates.controller'
import { ExchangeRatesModule } from './exchange-rates.module'

describe('ExchangeRatesModule metadata', () => {
  it('composes database/auth infrastructure and the management boundary', () => {
    expect(Reflect.getMetadata('imports', ExchangeRatesModule)).toEqual([
      PrismaModule,
      AuthModule,
    ])
    expect(Reflect.getMetadata('controllers', ExchangeRatesModule)).toEqual([
      ExchangeRatesController,
    ])
    expect(Reflect.getMetadata('providers', ExchangeRatesModule)).toEqual([
      ExchangeRateQueryService,
      ExchangeRateCommandService,
    ])
  })

  it('is registered in the single live HTTP/OpenAPI module list', () => {
    expect(HTTP_MODULES).toContain(ExchangeRatesModule)
  })
})
