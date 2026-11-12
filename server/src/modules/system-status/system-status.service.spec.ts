import type { ConfigService } from '@nestjs/config'

import type { MediaOperationalHealthResult } from '../media/media-operational-health'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import type { MediaHealthCollector } from './media-health.collector'
import type { PerformanceSnapshot } from './request-performance-metrics'
import type { RequestPerformanceMetrics } from './request-performance-metrics'
import type { SystemResourceSampler } from './system-resource-sampler'
import type { SystemResourceSnapshot } from './system-resource.types'
import { SystemStatusService } from './system-status.service'

const DATABASE_ROW = {
  timeZone: 'UTC',
  version: 'PostgreSQL 16.10',
  databaseSize: '123456789',
  startedAt: new Date('2026-10-20T12:15:51.000Z'),
  connections: 3,
  activeConnections: 1,
}
const MIGRATION_ROW = {
  migrationName: '20261111160000_notification_priority_fairness',
}

const MEDIA_HEALTHY: MediaOperationalHealthResult = {
  status: 'healthy',
  capabilities: {
    read: { status: 'up', code: 'MEDIA_READ_READY' },
    write: { status: 'up', code: 'MEDIA_WRITE_READY' },
    videoValidator: { status: 'up', code: 'MEDIA_VIDEO_VALIDATOR_READY' },
  },
  capacity: { freePercent: 41.25, level: 'ok' },
}

function resourceSnapshot(
  overrides: Partial<SystemResourceSnapshot['container']> = {},
  diskFreePercent = 41.25,
): SystemResourceSnapshot {
  return {
    sampledAt: '2026-11-11T00:00:00.000Z',
    host: {
      cpuCount: 2,
      cpuUsagePercent: 20,
      loadAverage: [0.1, 0.2, 0.3],
      memoryTotalBytes: 3_904_778_240,
      memoryAvailableBytes: 2_983_956_480,
    },
    container: {
      cpuUsageCores: 0.1,
      cpuUsagePercentOfHost: 5,
      cpuQuotaCores: null,
      cpuThrottledPeriods: 0,
      memoryCurrentBytes: 322_351_104,
      memoryLimitBytes: 1_073_741_824,
      memoryPeakBytes: 397_090_816,
      memoryAnonBytes: 161_193_984,
      memoryOomKillCount: 0,
      pidCount: 13,
      pidLimit: 4_370,
      ...overrides,
    },
    process: {
      rssBytes: 100_000_000,
      heapUsedBytes: 20_000_000,
      uptimeSeconds: 3_600,
    },
    disk: {
      totalBytes: 73_859_022_848,
      freeBytes: 33_594_081_280,
      availableBytes: 30_466_916_352,
      freePercent: diskFreePercent,
      inodeTotal: 4_587_520,
      inodeFree: 3_995_544,
      inodeUsedPercent: 12.9,
    },
    network: {
      rxBytesPerSecond: 100,
      txBytesPerSecond: 200,
    },
  }
}

function performanceSnapshot(
  overrides: Partial<PerformanceSnapshot> = {},
): PerformanceSnapshot {
  return {
    averageMs: 20,
    clientErrors: 1,
    errorRatePercent: 0.5,
    p95Ms: 50,
    serverErrors: 0,
    slowest: [],
    totalRequests: 100,
    windowRequests: 80,
    windowSeconds: 300,
    ...overrides,
  }
}

interface ServiceDependencies {
  readonly collectMediaHealth: jest.Mock
  readonly config: ConfigService
  readonly performance: RequestPerformanceMetrics
  readonly prisma: PrismaService
  readonly resources: SystemResourceSampler
}

function createService(options: {
  collectMediaHealth?: jest.Mock
  performance?: PerformanceSnapshot
  prismaQuery?: (sql: string) => Promise<unknown>
  resources?: SystemResourceSnapshot
} = {}): { service: SystemStatusService, dependencies: ServiceDependencies } {
  const queryRaw = jest.fn((strings: TemplateStringsArray) => {
    const sql = strings.join('')
    if (options.prismaQuery !== undefined) {
      return options.prismaQuery(sql)
    }
    return Promise.resolve(
      sql.includes('_prisma_migrations') ? [MIGRATION_ROW] : [DATABASE_ROW],
    )
  })
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService
  const config = {
    get: () => ({
      driver: 'cos',
      storageEnvironment: 'test',
      contentDeliveryMode: 'application',
      storageRoot: '/var/lib/qianshu-dms/media',
    }),
  } as unknown as ConfigService
  const resources = {
    sample: jest.fn().mockResolvedValue(options.resources ?? resourceSnapshot()),
  } as unknown as SystemResourceSampler
  const performance = {
    snapshot: jest.fn().mockReturnValue(
      options.performance ?? performanceSnapshot(),
    ),
  } as unknown as RequestPerformanceMetrics
  const collectMediaHealth = options.collectMediaHealth
    ?? jest.fn().mockResolvedValue(MEDIA_HEALTHY)
  const mediaHealth = {
    collect: collectMediaHealth,
  } as unknown as MediaHealthCollector
  const service = new SystemStatusService(
    config,
    prisma,
    resources,
    performance,
    mediaHealth,
  )
  return {
    service,
    dependencies: {
      collectMediaHealth,
      config,
      performance,
      prisma,
      resources,
    },
  }
}

describe('SystemStatusService', () => {
  const originalAppEnv = process.env.APP_ENV

  beforeEach(() => {
    process.env.APP_ENV = 'test'
  })

  afterAll(() => {
    if (originalAppEnv === undefined) {
      delete process.env.APP_ENV
    }
    else {
      process.env.APP_ENV = originalAppEnv
    }
  })

  it('aggregates services, resources, performance and runtime into one snapshot', async () => {
    const { service } = createService()
    const status = await service.getStatus()

    expect(status.overallStatus).toBe('ok')
    expect(status.checks).toHaveLength(7)
    expect(status.services.database).toMatchObject({
      status: 'ok',
      version: 'PostgreSQL 16.10',
      timeZone: 'UTC',
      sizeBytes: 123456789,
      connections: 3,
      activeConnections: 1,
    })
    expect(status.services.media).toMatchObject({
      status: 'ok',
      driver: 'cos',
      readStatus: 'up',
      writeStatus: 'up',
      capacityFreePercent: 41.25,
    })
    expect(status.resources.host.loadAverage).toEqual([0.1, 0.2, 0.3])
    expect(status.performance.insufficientData).toBe(false)
    expect(status.runtime).toMatchObject({
      environment: 'test',
      environmentSource: 'APP_ENV',
      mediaDriver: 'cos',
      migration: '20261111160000_notification_priority_fairness',
      databaseTimeZone: 'UTC',
    })
    expect(status.runtime.version).toMatch(/^\d+\.\d+\.\d+$/u)
  })

  it('marks the database critical when the probe fails', async () => {
    const { service } = createService({
      prismaQuery: () => Promise.reject(new Error('db down')),
    })
    const status = await service.getStatus()

    expect(status.services.database.status).toBe('critical')
    expect(status.checks.find(check => check.key === 'database')?.status).toBe('critical')
    expect(status.overallStatus).toBe('critical')
    expect(status.runtime.migration).toBeNull()
  })

  it('does not run the media write probe on every request', async () => {
    const collectMediaHealth = jest.fn().mockResolvedValue(MEDIA_HEALTHY)
    const { service } = createService({ collectMediaHealth })

    await service.getStatus()
    await service.getStatus()

    expect(collectMediaHealth).toHaveBeenCalledTimes(1)
  })

  it('treats insufficient performance samples as unknown without failing the page', async () => {
    const { service } = createService({
      performance: performanceSnapshot({
        windowRequests: 5,
        errorRatePercent: 0,
      }),
    })
    const status = await service.getStatus()

    expect(status.performance.insufficientData).toBe(true)
    expect(status.checks.find(check => check.key === 'performance')?.status).toBe('unknown')
    expect(status.overallStatus).toBe('ok')
  })

  it('escalates OOM kills and low disk space', async () => {
    const oom = createService({
      resources: resourceSnapshot({ memoryOomKillCount: 1 }),
    })
    const oomStatus = await oom.service.getStatus()
    expect(oomStatus.checks.find(check => check.key === 'memory')?.status).toBe('critical')
    expect(oomStatus.checks.find(check => check.key === 'memory')?.message).toBe('容器发生过 OOM Kill')
    expect(oomStatus.overallStatus).toBe('critical')

    const disk = createService({ resources: resourceSnapshot({}, 5) })
    const diskStatus = await disk.service.getStatus()
    expect(diskStatus.checks.find(check => check.key === 'disk')?.status).toBe('critical')
    expect(diskStatus.overallStatus).toBe('critical')
  })

  it('maps degraded media capabilities to warnings with a readable message', async () => {
    const degraded: MediaOperationalHealthResult = {
      status: 'degraded',
      capabilities: {
        read: { status: 'up', code: 'MEDIA_READ_READY' },
        write: { status: 'down', code: 'MEDIA_WRITE_UNAVAILABLE' },
        videoValidator: { status: 'up', code: 'MEDIA_VIDEO_VALIDATOR_READY' },
      },
      capacity: { freePercent: 15, level: 'warning' },
    }
    const { service } = createService({
      collectMediaHealth: jest.fn().mockResolvedValue(degraded),
    })
    const status = await service.getStatus()

    expect(status.services.media.status).toBe('warning')
    expect(status.services.media.message).toContain('媒体写入不可用')
    expect(status.services.media.message).toContain('媒体容量偏低')
    expect(status.overallStatus).toBe('warning')
  })

  it('returns unknown media instead of failing the whole status when the probe fails', async () => {
    const { service } = createService({
      collectMediaHealth: jest.fn().mockRejectedValue(new Error('probe failed')),
    })
    const status = await service.getStatus()

    expect(status.services.media.status).toBe('unknown')
    expect(status.services.media.message).toBe('媒体探针执行失败，稍后重试')
    expect(status.checks.find(check => check.key === 'media')?.status).toBe('unknown')
    expect(status.overallStatus).toBe('warning')
  })
})
