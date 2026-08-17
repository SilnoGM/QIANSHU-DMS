import type { MediaConfiguration } from '../../config/media.config'
import {
  collectMediaOperationalHealth,
  type MediaOperationalHealthDependencies,
} from './media-operational-health'

const configuration: MediaConfiguration = {
  contentDeliveryMode: 'application',
  driver: 'local',
  ffprobePath: '/usr/bin/ffprobe',
  qpdfPath: '/usr/bin/qpdf',
  storageRoot: '/var/lib/qianshu-dms/media',
  stagingTtlHours: 24,
  trashRetentionDays: 7,
}

function dependencies(
  overrides: Partial<MediaOperationalHealthDependencies> = {},
): MediaOperationalHealthDependencies {
  return {
    checkReadAccess: jest.fn().mockResolvedValue(true),
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
})
