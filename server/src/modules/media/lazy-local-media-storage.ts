import type { MediaConfiguration } from '../../config/media.config'
import { LocalMediaStorage } from './local-media-storage'
import type {
  MediaByteRange,
  MediaStorage,
  MediaStorageHealthResult,
  MediaStorageInventoryPage,
  MediaStorageInventoryRequest,
  ReadableStoredObject,
  StagingWrite,
  StoredObjectStat,
} from './media-storage'

export type LocalMediaStorageFactory = (
  configuration: MediaConfiguration,
) => Promise<MediaStorage>

const createLocalMediaStorage: LocalMediaStorageFactory = configuration =>
  LocalMediaStorage.create(configuration)

/**
 * 普通 API 与测试进程启动时不触碰真实媒体目录；第一次媒体操作才执行 Local
 * root 的 realpath、权限、设备和容量校验。初始化失败不会缓存，运维修复目录后
 * 后续请求可重新校验，但同一时刻的并发请求共享唯一初始化 Promise。
 */
export class LazyLocalMediaStorage implements MediaStorage {
  private storagePromise: Promise<MediaStorage> | undefined

  constructor(
    private readonly configuration: MediaConfiguration,
    private readonly factory: LocalMediaStorageFactory = createLocalMediaStorage,
  ) {}

  checkHealth(minimumFreeBytes?: bigint): Promise<MediaStorageHealthResult> {
    return this.withStorage(storage => storage.checkHealth(minimumFreeBytes))
  }

  checksumSha256(objectKey: string): Promise<string> {
    return this.withStorage(storage => storage.checksumSha256(objectKey))
  }

  createStagingWrite(assetId: string): Promise<StagingWrite> {
    return this.withStorage(storage => storage.createStagingWrite(assetId))
  }

  finalize(stagingKey: string, objectKey: string): Promise<void> {
    return this.withStorage(storage => storage.finalize(stagingKey, objectKey))
  }

  inventory(request: MediaStorageInventoryRequest): Promise<MediaStorageInventoryPage> {
    return this.withStorage(storage => storage.inventory(request))
  }

  open(objectKey: string, range?: MediaByteRange): Promise<ReadableStoredObject> {
    return this.withStorage(storage => storage.open(objectKey, range))
  }

  moveToTrash(objectKey: string, trashKey: string): Promise<void> {
    return this.withStorage(storage => storage.moveToTrash(objectKey, trashKey))
  }

  restoreFromTrash(trashKey: string, objectKey: string): Promise<void> {
    return this.withStorage(storage => storage.restoreFromTrash(trashKey, objectKey))
  }

  purge(key: string): Promise<void> {
    return this.withStorage(storage => storage.purge(key))
  }

  stat(key: string): Promise<StoredObjectStat | null> {
    return this.withStorage(storage => storage.stat(key))
  }

  withStagingValidationSource<T>(
    stagingKey: string,
    operation: (sourcePath: string) => Promise<T>,
  ): Promise<T> {
    return this.withStorage(storage =>
      storage.withStagingValidationSource(stagingKey, operation))
  }

  private async withStorage<T>(
    operation: (storage: MediaStorage) => Promise<T>,
  ): Promise<T> {
    return operation(await this.requireStorage())
  }

  private requireStorage(): Promise<MediaStorage> {
    if (this.storagePromise === undefined) {
      const initialization = this.factory(this.configuration)
      const retryable = initialization.catch((error: unknown) => {
        if (this.storagePromise === retryable) this.storagePromise = undefined
        throw error
      })
      this.storagePromise = retryable
    }
    return this.storagePromise
  }
}
