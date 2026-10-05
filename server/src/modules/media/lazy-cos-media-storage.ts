import type { CosMediaConfiguration } from '../../config/media.config'
import type { CosObjectClient } from './cos-object-client'
import { CosMediaStorage } from './cos-media-storage'
import type {
  MediaByteRange,
  MediaStorage,
  MediaStorageHealthResult,
  MediaStorageInventoryPage,
  MediaStorageInventoryRequest,
  ReadableStoredObject,
  StagingWrite,
  StoredObjectExpectation,
  StoredObjectStat,
} from './media-storage'

export type CosMediaStorageFactory = (
  configuration: CosMediaConfiguration,
  client: CosObjectClient,
) => Promise<MediaStorage>

const createCosMediaStorage: CosMediaStorageFactory = (configuration, client) =>
  CosMediaStorage.create(configuration, client)

/**
 * 普通 API 与测试进程启动时不建立对象存储连接，也不校验本地 staging 目录；
 * 第一次媒体操作才初始化。初始化失败不缓存，运维修复桶权限或目录后后续请求可以重新校验，
 * 同一时刻的并发请求共享唯一初始化 Promise。
 */
export class LazyCosMediaStorage implements MediaStorage {
  private storagePromise: Promise<MediaStorage> | undefined

  constructor(
    private readonly configuration: CosMediaConfiguration,
    private readonly client: CosObjectClient,
    private readonly factory: CosMediaStorageFactory = createCosMediaStorage,
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

  openManagedObject(
    objectKey: string,
    range?: MediaByteRange,
  ): Promise<ReadableStoredObject> {
    return this.withStorage(storage => storage.openManagedObject(objectKey, range))
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

  verifyStoredObject(
    objectKey: string,
    expected: StoredObjectExpectation,
  ): Promise<boolean> {
    return this.withStorage(storage => storage.verifyStoredObject(objectKey, expected))
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
      const initialization = this.factory(this.configuration, this.client)
      const retryable = initialization.catch((error: unknown) => {
        if (this.storagePromise === retryable) this.storagePromise = undefined
        throw error
      })
      this.storagePromise = retryable
    }
    return this.storagePromise
  }
}
