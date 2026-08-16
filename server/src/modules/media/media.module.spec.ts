import { ConfigModule } from '@nestjs/config'

import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { MediaAssetService } from './media-asset.service'
import { MediaContentDeliveryService } from './media-content-delivery.service'
import { MediaModule } from './media.module'
import { MediaAssetRetentionService } from './media-retention.service'

describe('MediaModule metadata', () => {
  it('owns business-neutral media infrastructure and exports only domain-facing services', () => {
    expect(Reflect.getMetadata('imports', MediaModule)).toEqual([
      ConfigModule,
      PrismaModule,
    ])
    expect(Reflect.getMetadata('exports', MediaModule)).toEqual([
      MediaAssetService,
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
})
