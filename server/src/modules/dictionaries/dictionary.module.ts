import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { DictionaryCatalogController } from './dictionary-catalog.controller'
import { DictionaryCommandService } from './dictionary-command.service'
import { DictionaryLookupService } from './dictionary-lookup.service'
import { DictionaryQueryService } from './dictionary-query.service'
import { DictionariesController } from './dictionaries.controller'

/**
 * 管理 HTTP、消费 Catalog 与内部字典校验共用同一领域模块。只有 Lookup
 * 对业务模块导出，Query/Command 与两个 Controller 始终保持模块私有。
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [DictionaryCatalogController, DictionariesController],
  providers: [
    DictionaryQueryService,
    DictionaryCommandService,
    DictionaryLookupService,
  ],
  exports: [DictionaryLookupService],
})
export class DictionaryModule {}
