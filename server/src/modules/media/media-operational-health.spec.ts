import type {
  CosMediaConfiguration,
  MediaConfiguration,
} from '../../config/media.config'
import {
  collectMediaOperationalHealth,
  type MediaOperationalHealthDependencies,
} from './media-operational-health'

const configuration: MediaConfiguration = {
  contentDeliveryMode: 'application',
  driver: 'local',
  ffprobePath: '/usr/bin/ffprobe',
  qpdfPath: '/usr/bin/qpdf',
  storageEnvironment: 'dev',
  storageRoot: '/var/lib/qianshu-dms/media',
  stagingTtlHours: 24,
  trashRetentionDays: 7,
}

const cosConfiguration: CosMediaConfiguration = {
  ...configuration,
  cos: { bucket: 'dms-qs-media-1396967080', region: 'ap-beijing' },
  driver: 'cos',
}

function dependencies(
  overrides: Partial<MediaOperationalHealthDependencies> = {},
): MediaOperationalHealthDependencies {
  return {
    checkReadAccess: jest.fn().mockResolvedValue(true),
    checkRemoteReadAccess: jest.fn().mockResolvedValue(true),
    checkRemoteWriteAccess: jest.fn().mockResolvedValue(true),
    checkVideoValidator: jest.fn().mockResolvedValue(true),
    checkWriteAccess: jest.fn().mockResolvedValue(true),
    inspectCapacity: jest.fn().mockResolvedValue({
      availableBlocks: 50n,
      blockSize: 4_096n,
      totalBlocks: 100n,
    }),
    ...overrides,
  }
}

describe('collectMediaOperationalHealth', () => {
  it('keeps read up but fails write closed at critical capacity', async () => {
    const result = await collectMediaOperationalHealth(
      configuration,
      dependencies({
        checkVideoValidator: jest.fn().mockResolvedValue(false),
        inspectCapacity: jest.fn().mockResolvedValue({
          availableBlocks: 9n,
          blockSize: 4_096n,
          totalBlocks: 100n,
        }),
      }),
    )

    expect(result).toEqual({
      capabilities: {
        read: { code: 'MEDIA_READ_READY', status: 'up' },
        videoValidator: {
          code: 'MEDIA_VIDEO_VALIDATOR_UNAVAILABLE',
          status: 'down',
        },
        write: { code: 'MEDIA_CAPACITY_CRITICAL', status: 'down' },
      },
      capacity: { freePercent: 9, level: 'critical' },
      status: 'degraded',
    })
  })

  it('reports warning capacity without disabling writes', async () => {
    const result = await collectMediaOperationalHealth(
      configuration,
      dependencies({
        inspectCapacity: jest.fn().mockResolvedValue({
          availableBlocks: 15n,
          blockSize: 4_096n,
          totalBlocks: 100n,
        }),
      }),
    )

    expect(result.status).toBe('degraded')
    expect(result.capacity).toEqual({ freePercent: 15, level: 'warning' })
    expect(result.capabilities.write).toEqual({
      code: 'MEDIA_CAPACITY_WARNING',
      status: 'up',
    })
  })

  it('reports a complete read outage without exposing configured paths', async () => {
    const result = await collectMediaOperationalHealth(
      configuration,
      dependencies({
        checkReadAccess: jest.fn().mockResolvedValue(false),
      }),
    )

    expect(result.status).toBe('down')
    expect(result.capabilities.read).toEqual({
      code: 'MEDIA_READ_UNAVAILABLE',
      status: 'down',
    })
    expect(JSON.stringify(result)).not.toContain(configuration.storageRoot)
    expect(JSON.stringify(result)).not.toContain(configuration.ffprobePath)
  })

  it('degrades instead of blocking startup when the bucket read probe fails under the cos driver', async () => {
    const checkReadAccess = jest.fn().mockResolvedValue(true)

    const result = await collectMediaOperationalHealth(
      cosConfiguration,
      dependencies({
        checkReadAccess,
        checkRemoteReadAccess: jest.fn().mockResolvedValue(false),
      }),
    )

    expect(result.status).toBe('degraded')
    expect(result.capabilities.read).toEqual({
      code: 'MEDIA_READ_UNAVAILABLE',
      status: 'down',
    })
    // COS 模式下本地 assets/trash 目录不再参与读取判定。
    expect(checkReadAccess).not.toHaveBeenCalled()
  })

  it('requires the bucket write probe before declaring the cos driver writable', async () => {
    const result = await collectMediaOperationalHealth(
      cosConfiguration,
      dependencies({
        checkRemoteWriteAccess: jest.fn().mockResolvedValue(false),
      }),
    )

    expect(result.capabilities.write).toEqual({
      code: 'MEDIA_WRITE_UNAVAILABLE',
      status: 'down',
    })
    expect(result.status).toBe('degraded')
  })

  it('reports a healthy deployment when both the staging volume and the bucket are usable', async () => {
    const result = await collectMediaOperationalHealth(
      cosConfiguration,
      dependencies(),
    )

    expect(result).toEqual({
      capabilities: {
        read: { code: 'MEDIA_READ_READY', status: 'up' },
        videoValidator: { code: 'MEDIA_VIDEO_VALIDATOR_READY', status: 'up' },
        write: { code: 'MEDIA_WRITE_READY', status: 'up' },
      },
      capacity: { freePercent: 50, level: 'ok' },
      status: 'healthy',
    })
  })
})
