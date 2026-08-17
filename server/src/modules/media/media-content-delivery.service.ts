import type {
  MediaConfiguration,
  MediaContentDeliveryMode,
} from '../../config/media.config'
import type {
  MediaByteRange,
  MediaStorage,
  ReadableStoredObject,
  StoredObjectStat,
} from './media-storage'

/**
 * 对领域模块暴露业务中立的私有媒体读取能力。
 *
 * Product 等领域只持有 object key，不接触本地绝对路径；是否由应用进程读取文件仍由
 * 部署配置决定，从而同时支持本地单进程开发和生产 Nginx internal redirect。
 */
export class MediaContentDeliveryService {
  readonly mode: MediaContentDeliveryMode

  constructor(
    private readonly storage: MediaStorage,
    mode: MediaContentDeliveryMode,
  ) {
    this.mode = mode
  }

  static fromConfiguration(
    storage: MediaStorage,
    configuration: MediaConfiguration,
  ): MediaContentDeliveryService {
    return new MediaContentDeliveryService(
      storage,
      configuration.contentDeliveryMode,
    )
  }

  open(
    objectKey: string,
    range?: MediaByteRange,
  ): Promise<ReadableStoredObject> {
    return this.storage.open(objectKey, range)
  }

  stat(objectKey: string): Promise<StoredObjectStat | null> {
    return this.storage.stat(objectKey)
  }
}
