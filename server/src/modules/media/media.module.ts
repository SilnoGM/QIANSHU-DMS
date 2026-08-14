import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import type { MediaConfiguration } from '../../config/media.config'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LazyLocalMediaStorage } from './lazy-local-media-storage'
import { MediaAssetPersistence } from './media-asset.persistence'
import { MediaAssetService } from './media-asset.service'
import { MediaContentValidator } from './media-content-validator'
import { MediaReconciliationPersistence } from './media-reconciliation.persistence'
import { MediaAssetReferenceRepository } from './media-reference.repository'
import { MediaAssetRetentionService } from './media-retention.service'
import type { MediaStorage } from './media-storage'

const MEDIA_CONFIGURATION = Symbol('qianshu.media.configuration')
const MEDIA_STORAGE = Symbol('qianshu.media.storage')

const providers = [{
  provide: MEDIA_CONFIGURATION,
  inject: [ConfigService],
  useFactory: (config: ConfigService): MediaConfiguration =>
    config.getOrThrow<MediaConfiguration>('media'),
}, {
  provide: MEDIA_STORAGE,
  inject: [MEDIA_CONFIGURATION],
  useFactory: (configuration: MediaConfiguration): MediaStorage =>
    new LazyLocalMediaStorage(configuration),
}, {
  provide: MediaAssetPersistence,
  inject: [PrismaService],
  useFactory: (prisma: PrismaService): MediaAssetPersistence =>
    new MediaAssetPersistence(prisma),
}, {
  provide: MediaContentValidator,
  inject: [MEDIA_CONFIGURATION],
  useFactory: (configuration: MediaConfiguration): MediaContentValidator =>
    new MediaContentValidator({
      ffprobePath: configuration.ffprobePath,
      qpdfPath: configuration.qpdfPath,
    }),
}, {
  provide: MediaAssetService,
  inject: [
    MediaAssetPersistence,
    MEDIA_STORAGE,
    MediaContentValidator,
    MEDIA_CONFIGURATION,
  ],
  useFactory: (
    persistence: MediaAssetPersistence,
    storage: MediaStorage,
    validator: MediaContentValidator,
    configuration: MediaConfiguration,
  ): MediaAssetService => new MediaAssetService(
    persistence,
    storage,
    validator,
    configuration,
  ),
}, {
  provide: MediaReconciliationPersistence,
  inject: [PrismaService],
  useFactory: (prisma: PrismaService): MediaReconciliationPersistence =>
    new MediaReconciliationPersistence(prisma),
}, {
  provide: MediaAssetReferenceRepository,
  useFactory: (): MediaAssetReferenceRepository =>
    new MediaAssetReferenceRepository(),
}, {
  provide: MediaAssetRetentionService,
  inject: [
    MediaReconciliationPersistence,
    MediaAssetReferenceRepository,
    MEDIA_STORAGE,
    MEDIA_CONFIGURATION,
  ],
  useFactory: (
    persistence: MediaReconciliationPersistence,
    references: MediaAssetReferenceRepository,
    storage: MediaStorage,
    configuration: MediaConfiguration,
  ): MediaAssetRetentionService => new MediaAssetRetentionService(
    persistence,
    references,
    storage,
    { trashRetentionDays: configuration.trashRetentionDays },
  ),
}]

/** 统一媒体基础设施模块保持业务中立，只向领域模块输出生命周期服务。 */
@Module({
  imports: [ConfigModule, PrismaModule],
  providers,
  exports: [MediaAssetService, MediaAssetRetentionService],
})
export class MediaModule {}
