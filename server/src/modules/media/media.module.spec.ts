import { ConfigModule } from '@nestjs/config'

import type {
  CosMediaConfiguration,
  LocalMediaConfiguration,
} from '../../config/media.config'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { CosObjectClientError } from './cos-object-client'
import { LazyCosMediaStorage } from './lazy-cos-media-storage'
import { LazyLocalMediaStorage } from './lazy-local-media-storage'
import { MediaAssetService } from './media-asset.service'
import { MediaContentDeliveryService } from './media-content-delivery.service'
import { createMediaStorage, MediaModule } from './media.module'
import { OceanFreightSourceFileService } from './ocean-freight-source-file.service'
import { MediaAssetRetentionService } from './media-retention.service'

/** 占位凭据在运行时拼接，源码里不出现形似真实密钥的字面量。 */
function placeholderCredential(label: string): string {
  return ['placeholder', label, '0123456789abcdef'].join('-')
}

const LOCAL_CONFIGURATION: LocalMediaConfiguration = Object.freeze({
  contentDeliveryMode: 'application',
  driver: 'local',
  ffprobePath: '/usr/bin/ffprobe',
  qpdfPath: '/usr/bin/qpdf',
  stagingTtlHours: 24,
  storageEnvironment: 'dev',
  storageRoot: '/var/lib/qianshu-dms/media',
  trashRetentionDays: 7,
})

const COS_CONFIGURATION: CosMediaConfiguration = Object.freeze({
  ...LOCAL_CONFIGURATION,
  cos: Object.freeze({ bucket: 'dms-qs-media-1396967080', region: 'ap-beijing' }),
  driver: 'cos',
})

describe('MediaModule metadata', () => {
  it('owns business-neutral media infrastructure and exports only domain-facing services', () => {
    expect(Reflect.getMetadata('imports', MediaModule)).toEqual([
      ConfigModule,
      PrismaModule,
    ])
    expect(Reflect.getMetadata('exports', MediaModule)).toEqual([
      MediaAssetService,
      OceanFreightSourceFileService,
      MediaContentDeliveryService,
      MediaAssetRetentionService,
    ])
    const providers = Reflect.getMetadata('providers', MediaModule) as unknown[]
    expect(providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ provide: MediaAssetService }),
      expect.objectContaining({ provide: MediaContentDeliveryService }),
      expect.objectContaining({ provide: MediaAssetRetentionService }),
    ]))
  })

  it('wires the local driver without requiring any COS credential', () => {
    expect(createMediaStorage(LOCAL_CONFIGURATION, {}))
      .toBeInstanceOf(LazyLocalMediaStorage)
  })

  it('wires the cos driver only when credentials are present', () => {
    expect(createMediaStorage(COS_CONFIGURATION, {
      MEDIA_COS_SECRET_ID: placeholderCredential('id'),
      MEDIA_COS_SECRET_KEY: placeholderCredential('key'),
    })).toBeInstanceOf(LazyCosMediaStorage)
  })

  it('fails closed when the cos driver is selected without credentials', () => {
    expect(() => createMediaStorage(COS_CONFIGURATION, {}))
      .toThrow(CosObjectClientError)
    try {
      createMediaStorage(COS_CONFIGURATION, {})
    }
    catch (error) {
      expect((error as CosObjectClientError).code)
        .toBe('COS_CLIENT_CONFIGURATION_INVALID')
    }
  })
})
