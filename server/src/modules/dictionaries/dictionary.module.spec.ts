import { HTTP_MODULES } from '../../http.modules'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryCatalogController } from './dictionary-catalog.controller'
import { DictionaryCommandService } from './dictionary-command.service'
import { DictionaryLookupService } from './dictionary-lookup.service'
import { DictionaryModule } from './dictionary.module'
import { DictionaryQueryService } from './dictionary-query.service'
import { DictionariesController } from './dictionaries.controller'

describe('DictionaryModule metadata', () => {
  it('uses the exact infrastructure, HTTP boundary and provider set', () => {
    expect(Reflect.getMetadata('imports', DictionaryModule)).toEqual([
      PrismaModule,
      AuthModule,
    ])
    expect(Reflect.getMetadata('controllers', DictionaryModule)).toEqual([
      DictionaryCatalogController,
      DictionariesController,
    ])
    expect(Reflect.getMetadata('providers', DictionaryModule)).toEqual([
      DictionaryQueryService,
      DictionaryCommandService,
      DictionaryLookupService,
    ])
    // 只有内部 Lookup 是跨业务模块边界；管理 Query/Command 始终保持私有。
    expect(Reflect.getMetadata('exports', DictionaryModule)).toEqual([
      DictionaryLookupService,
    ])
  })

  it('is registered exactly once in the live HTTP/OpenAPI module list', () => {
    expect(HTTP_MODULES.filter(module => module === DictionaryModule))
      .toHaveLength(1)
  })
})
