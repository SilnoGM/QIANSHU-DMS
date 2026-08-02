import { HTTP_MODULES } from '../../http.modules'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { NumberingCommandService } from './numbering-command.service'
import { NumberingController } from './numbering.controller'
import { NumberingGeneratorService } from './numbering-generator.service'
import { NumberingModule } from './numbering.module'
import { NumberingQueryService } from './numbering-query.service'

describe('NumberingModule metadata', () => {
  it('uses the exact infrastructure, boundary and provider set', () => {
    expect(Reflect.getMetadata('imports', NumberingModule)).toEqual([
      PrismaModule,
      AuthModule,
    ])
    expect(Reflect.getMetadata('controllers', NumberingModule)).toEqual([
      NumberingController,
    ])
    expect(Reflect.getMetadata('providers', NumberingModule)).toEqual([
      NumberingQueryService,
      NumberingCommandService,
      NumberingGeneratorService,
    ])
    expect(Reflect.getMetadata('exports', NumberingModule)).toEqual([
      NumberingGeneratorService,
    ])
  })

  it('is registered exactly once in the live HTTP/OpenAPI module list', () => {
    expect(HTTP_MODULES.filter(module => module === NumberingModule))
      .toHaveLength(1)
  })
})
