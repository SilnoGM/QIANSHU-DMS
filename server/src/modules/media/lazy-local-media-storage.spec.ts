import type { MediaConfiguration } from '../../config/media.config'
import {
  LazyLocalMediaStorage,
  type LocalMediaStorageFactory,
} from './lazy-local-media-storage'
import type { MediaStorage } from './media-storage'
import { MediaStorageError } from './media-storage'

const configuration: MediaConfiguration = {
  contentDeliveryMode: 'application',
  driver: 'local',
  ffprobePath: '/usr/bin/ffprobe',
  qpdfPath: '/usr/bin/qpdf',
  storageRoot: '/srv/qianshu-media',
  stagingTtlHours: 24,
  trashRetentionDays: 7,
}

function storageFixture() {
  return {
    stat: jest.fn().mockResolvedValue({
      sizeBytes: 10n,
      modifiedAt: new Date('2026-08-14T00:00:00.000Z'),
    }),
    checkHealth: jest.fn().mockResolvedValue({
      status: 'up',
      code: 'MEDIA_STORAGE_READY',
    }),
  } as unknown as MediaStorage
}

describe('LazyLocalMediaStorage', () => {
  it('has zero filesystem side effects until first use and shares concurrent initialization', async () => {
    const storage = storageFixture()
    const factory = jest.fn<ReturnType<LocalMediaStorageFactory>, Parameters<LocalMediaStorageFactory>>()
      .mockResolvedValue(storage)
    const lazy = new LazyLocalMediaStorage(configuration, factory)

    expect(factory).not.toHaveBeenCalled()
    await Promise.all([
      lazy.stat('assets/2026/08/a.jpg'),
      lazy.checkHealth(),
    ])
    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledWith(configuration)
  })

  it('fails closed but allows a later request to retry initialization after operations repair storage', async () => {
    const storage = storageFixture()
    const factory = jest.fn<ReturnType<LocalMediaStorageFactory>, Parameters<LocalMediaStorageFactory>>()
      .mockRejectedValueOnce(new MediaStorageError('MEDIA_STORAGE_UNAVAILABLE'))
      .mockResolvedValueOnce(storage)
    const lazy = new LazyLocalMediaStorage(configuration, factory)

    await expect(lazy.stat('assets/2026/08/a.jpg')).rejects.toMatchObject({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    })
    await expect(lazy.stat('assets/2026/08/a.jpg')).resolves.toMatchObject({
      sizeBytes: 10n,
    })
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
