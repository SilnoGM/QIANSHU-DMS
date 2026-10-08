import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import type { MediaConfiguration } from '../../config/media.config'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { createCosObjectClient, readCosCredentials } from './cos-object-client'
import { LazyCosMediaStorage } from './lazy-cos-media-storage'
import { LazyLocalMediaStorage } from './lazy-local-media-storage'
import { MediaAssetPersistence } from './media-asset.persistence'
import { MediaAssetService } from './media-asset.service'
import { MediaContentValidator } from './media-content-validator'
import { MediaContentDeliveryService } from './media-content-delivery.service'
import { MediaReconciliationPersistence } from './media-reconciliation.persistence'
import { MediaReconciliationService } from './media-reconciliation.service'
import { MediaAssetReferenceRepository } from './media-reference.repository'
import { MediaAssetRetentionService } from './media-retention.service'
import type { MediaStorage } from './media-storage'
import { MediaVariantService } from './media-variant.service'
import { OceanFreightSourceFileService } from './ocean-freight-source-file.service'

const MEDIA_CONFIGURATION = Symbol('qianshu.media.configuration')
const MEDIA_STORAGE = Symbol('qianshu.media.storage')

/**
 * 按配置装配存储实现。
 *
 * COS 凭据只在这个函数的 cos 分支里读取：既不进入 MediaConfiguration，也不出现在日志或异常中；
 * 本地驱动完全不接触凭据，因此 dev/CI 没有密钥也能照常启动。
 */
export function createMediaStorage(
  configuration: MediaConfiguration,
  environment: Record<string, unknown>,
): MediaStorage {
  if (configuration.driver !== 'cos') {
    return new LazyLocalMediaStorage(configuration)
  }
  const credentials = readCosCredentials(environment)
  return new LazyCosMediaStorage(
    configuration,
    createCosObjectClient({
      bucket: configuration.cos.bucket,
      region: configuration.cos.region,
      ...credentials,
    }),
  )
}

const providers = [{
  provide: MEDIA_CONFIGURATION,
  inject: [ConfigService],
  useFactory: (config: ConfigService): MediaConfiguration =>
    config.getOrThrow<MediaConfiguration>('media'),
}, {
  provide: MEDIA_STORAGE,
  inject: [MEDIA_CONFIGURATION, ConfigService],
  useFactory: (
    configuration: MediaConfiguration,
    config: ConfigService,
  ): MediaStorage =>
    createMediaStorage(configuration, {
      MEDIA_COS_SECRET_ID: config.get<string>('MEDIA_COS_SECRET_ID'),
      MEDIA_COS_SECRET_KEY: config.get<string>('MEDIA_COS_SECRET_KEY'),
    }),
}, {
  provide: MediaContentDeliveryService,
  inject: [MEDIA_STORAGE, MEDIA_CONFIGURATION],
  useFactory: (
    storage: MediaStorage,
    configuration: MediaConfiguration,
  ): MediaContentDeliveryService =>
    MediaContentDeliveryService.fromConfiguration(storage, configuration),
}, {
  provide: MediaAssetPersistence,
  inject: [PrismaService, MEDIA_CONFIGURATION],
  useFactory: (
    prisma: PrismaService,
    configuration: MediaConfiguration,
  ): MediaAssetPersistence =>
    new MediaAssetPersistence(prisma, configuration.driver),
}, {
  provide: MediaVariantService,
  inject: [MediaContentDeliveryService, MEDIA_CONFIGURATION],
  useFactory: (
    delivery: MediaContentDeliveryService,
    configuration: MediaConfiguration,
  ): MediaVariantService => new MediaVariantService(delivery, configuration),
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
}, {
  provide: MediaReconciliationService,
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
  ): MediaReconciliationService => new MediaReconciliationService(
    persistence,
    references,
    storage,
    configuration.storageEnvironment,
  ),
}]

/** 统一媒体基础设施模块保持业务中立，只向领域模块输出生命周期服务。 */
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [...providers, OceanFreightSourceFileService],
  exports: [
    MediaAssetService,
    OceanFreightSourceFileService,
    MediaContentDeliveryService,
    MediaAssetRetentionService,
    MediaVariantService,
  ],
})
export class MediaModule {}
