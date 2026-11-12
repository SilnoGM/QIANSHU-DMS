import { Injectable, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import type { MediaConfiguration } from '../../config/media.config'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import type { MediaOperationalHealthResult } from '../media/media-operational-health'
import { MediaHealthCollector } from './media-health.collector'
import {
  CONTAINER_MEMORY_CRITICAL_PERCENT,
  CONTAINER_MEMORY_WARNING_PERCENT,
  DISK_CRITICAL_FREE_PERCENT,
  DISK_WARNING_FREE_PERCENT,
  HOST_CPU_CRITICAL_PERCENT,
  HOST_CPU_WARNING_PERCENT,
  MEDIA_PROBE_FIRST_WAIT_MS,
  MEDIA_PROBE_RETRY_MS,
  MEDIA_PROBE_TTL_MS,
  PERFORMANCE_CRITICAL_ERROR_RATE,
  PERFORMANCE_MIN_SAMPLES,
  PERFORMANCE_WARNING_ERROR_RATE,
} from './system-status.constants'
import {
  type SystemDatabaseServiceDto,
  type SystemMediaServiceDto,
  type SystemPerformanceDto,
  type SystemResourceDto,
  type SystemRuntimeDto,
  type SystemStatusCheckDto,
  type SystemStatusLevel,
  type SystemStatusResponseDto,
} from './dto/system-status-response.dto'
import {
  RequestPerformanceMetrics,
  type PerformanceSnapshot,
} from './request-performance-metrics'
import {
  SystemResourceSampler,
} from './system-resource-sampler'
import type { SystemResourceSnapshot } from './system-resource.types'
import {
  readServerVersion,
  resolveDeploymentEnvironment,
} from './system-runtime'

interface DatabaseRow {
  readonly activeConnections: unknown
  readonly connections: unknown
  readonly databaseSize: unknown
  readonly startedAt: unknown
  readonly timeZone: unknown
  readonly version: unknown
}

interface MigrationRow {
  readonly migrationName: unknown
}

interface MediaCacheEntry {
  readonly at: number
  readonly result: MediaOperationalHealthResult
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'bigint') {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toIntegerOrNull(value: unknown): number | null {
  const parsed = toFiniteNumber(value)
  return parsed === null || !Number.isInteger(parsed) ? null : parsed
}

function toIsoStringOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function elapsedMilliseconds(startedAt: bigint): number {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1e3) / 1e3
}

function levelFromUsage(
  value: number | null,
  warning: number,
  critical: number,
): SystemStatusLevel {
  if (value === null) {
    return 'unknown'
  }
  if (value >= critical) {
    return 'critical'
  }
  return value >= warning ? 'warning' : 'ok'
}

function levelFromFreePercent(value: number | null): SystemStatusLevel {
  if (value === null) {
    return 'unknown'
  }
  if (value < DISK_CRITICAL_FREE_PERCENT) {
    return 'critical'
  }
  return value < DISK_WARNING_FREE_PERCENT ? 'warning' : 'ok'
}

function resolveOverallStatus(
  checks: readonly SystemStatusCheckDto[],
): SystemStatusLevel {
  if (checks.some(check => check.status === 'critical')) {
    return 'critical'
  }
  if (checks.some(check => check.status === 'warning')) {
    return 'warning'
  }
  // 性能样本不足不是故障；只有服务/资源未知才把整体标成需关注。
  if (checks.some(check => check.status === 'unknown' && check.category !== 'performance')) {
    return 'warning'
  }
  return 'ok'
}

/**
 * 系统状态聚合读取。
 *
 * 所有检查都返回固定字段，不拼接底层异常、SQL、连接串或文件路径；数据库/媒体
 * 探针失败时用 null + 固定中文说明降级，由页面显示“未知/异常”，不伪造正常值。
 */
@Injectable()
export class SystemStatusService implements OnModuleInit {
  private mediaCache: MediaCacheEntry | null = null
  private mediaInFlight: Promise<MediaOperationalHealthResult | null> | null = null
  private mediaNextAttemptAt = 0
  private mediaRefreshFailed = false

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly resources: SystemResourceSampler,
    private readonly performance: RequestPerformanceMetrics,
    private readonly mediaHealth: MediaHealthCollector,
  ) {}

  onModuleInit(): void {
    // 启动时预热媒体探针；不阻塞启动，首次进入页面通常已有缓存。
    this.startMediaProbe()
  }

  async getStatus(): Promise<SystemStatusResponseDto> {
    const now = Date.now()
    const [resources, database, media] = await Promise.all([
      this.resources.sample(now),
      this.readDatabase(),
      this.readMedia(now),
    ])
    const migration = database.status === 'ok'
      ? await this.readLatestMigration()
      : null
    const performanceSnapshot = this.performance.snapshot(now)
    const performance = this.toPerformanceDto(performanceSnapshot)
    const checks = this.buildChecks(resources, database, media, performance)
    const generatedAt = new Date().toISOString()

    return {
      overallStatus: resolveOverallStatus(checks),
      generatedAt,
      checks,
      services: {
        backend: {
          status: 'ok',
          latencyMs: null,
          checkedAt: generatedAt,
        },
        database,
        media,
      },
      resources: this.toResourceDto(resources),
      performance,
      runtime: this.buildRuntime(resources, database, migration),
    }
  }

  private async readDatabase(): Promise<SystemDatabaseServiceDto> {
    const startedAt = process.hrtime.bigint()
    const checkedAt = new Date().toISOString()
    try {
      const rows = await this.prisma.$queryRaw<DatabaseRow[]>`
        SELECT current_setting('TimeZone') AS "timeZone",
               version() AS "version",
               pg_database_size(current_database()) AS "databaseSize",
               pg_postmaster_start_time() AS "startedAt",
               (
                 SELECT count(*)::int
                 FROM pg_stat_activity
                 WHERE datname = current_database()
               ) AS "connections",
               (
                 SELECT count(*)::int
                 FROM pg_stat_activity
                 WHERE datname = current_database()
                   AND state = 'active'
               ) AS "activeConnections"
      `
      const row = rows[0]
      if (row === undefined) {
        throw new Error('Database probe returned no rows')
      }
      return {
        status: 'ok',
        latencyMs: elapsedMilliseconds(startedAt),
        checkedAt: new Date().toISOString(),
        version: toStringOrNull(row.version),
        timeZone: toStringOrNull(row.timeZone),
        startedAt: toIsoStringOrNull(row.startedAt),
        sizeBytes: toFiniteNumber(row.databaseSize),
        connections: toIntegerOrNull(row.connections),
        activeConnections: toIntegerOrNull(row.activeConnections),
      }
    }
    catch {
      return {
        status: 'critical',
        latencyMs: elapsedMilliseconds(startedAt),
        checkedAt,
        version: null,
        timeZone: null,
        startedAt: null,
        sizeBytes: null,
        connections: null,
        activeConnections: null,
      }
    }
  }

  /**
   * `_prisma_migrations` 是 Prisma 的迁移账本，不是业务表；查询失败只让迁移字段
   * 为空，不能把已经连通的数据库判成异常。
   */
  private async readLatestMigration(): Promise<string | null> {
    try {
      const rows = await this.prisma.$queryRaw<MigrationRow[]>`
        SELECT migration_name AS "migrationName"
        FROM _prisma_migrations
        WHERE finished_at IS NOT NULL
        ORDER BY finished_at DESC
        LIMIT 1
      `
      return toStringOrNull(rows[0]?.migrationName)
    }
    catch {
      return null
    }
  }

  private async readMedia(now: number): Promise<SystemMediaServiceDto> {
    const mediaConfig = this.config.get<MediaConfiguration>('media')
    if (mediaConfig === undefined) {
      return this.unknownMedia('unknown', 'unknown', '媒体配置不可用')
    }

    if (this.mediaCache !== null) {
      if (now - this.mediaCache.at >= MEDIA_PROBE_TTL_MS) {
        this.startMediaProbe()
      }
      if (this.mediaRefreshFailed) {
        return this.toMediaDto(
          this.mediaCache,
          'warning',
          '媒体探针刷新失败，显示上次结果',
        )
      }
      return this.toMediaDto(this.mediaCache)
    }

    this.startMediaProbe()
    const result = await this.waitForMediaProbe()
    if (this.mediaCache !== null) {
      return this.toMediaDto(this.mediaCache)
    }
    if (result !== null) {
      return this.toMediaDto({ at: Date.now(), result })
    }
    return this.unknownMedia(
      mediaConfig.driver,
      mediaConfig.storageEnvironment,
      this.mediaRefreshFailed
        ? '媒体探针执行失败，稍后重试'
        : '媒体探针进行中',
    )
  }

  /**
   * 媒体探针在后台执行；冷缓存时 `readMedia` 最多等待
   * `MEDIA_PROBE_FIRST_WAIT_MS`，避免 COS 的 60 秒超时拖住整个状态接口。
   */
  private startMediaProbe(): void {
    const mediaConfig = this.config.get<MediaConfiguration>('media')
    if (
      mediaConfig === undefined
      || this.mediaInFlight !== null
      || Date.now() < this.mediaNextAttemptAt
    ) {
      return
    }

    this.mediaInFlight = this.mediaHealth.collect(mediaConfig)
      .then((result) => {
        this.mediaCache = { at: Date.now(), result }
        this.mediaNextAttemptAt = 0
        this.mediaRefreshFailed = false
        return result
      })
      .catch(() => {
        this.mediaRefreshFailed = true
        this.mediaNextAttemptAt = Date.now() + MEDIA_PROBE_RETRY_MS
        return null
      })
      .finally(() => {
        this.mediaInFlight = null
      })
  }

  private async waitForMediaProbe(): Promise<MediaOperationalHealthResult | null> {
    const pending = this.mediaInFlight
    if (pending === null) {
      return null
    }

    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), MEDIA_PROBE_FIRST_WAIT_MS)
      // 测试或进程退出时不要因为一个等待计时器阻止 worker 结束。
      timer.unref()
    })
    try {
      return await Promise.race([pending, timeout])
    }
    finally {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }

  private toMediaDto(
    entry: MediaCacheEntry,
    overrideStatus?: SystemStatusLevel,
    overrideMessage?: string,
  ): SystemMediaServiceDto {
    const { result } = entry
    const failed: string[] = []
    if (result.capabilities.read.status === 'down') {
      failed.push('媒体读取不可用')
    }
    if (result.capabilities.write.status === 'down') {
      failed.push('媒体写入不可用')
    }
    if (result.capabilities.videoValidator.status === 'down') {
      failed.push('视频校验不可用')
    }
    if (result.capacity.level === 'critical') {
      failed.push('媒体容量不足')
    }
    else if (result.capacity.level === 'warning') {
      failed.push('媒体容量偏低')
    }

    return {
      status: overrideStatus ?? (
        result.status === 'healthy'
          ? 'ok'
          : result.status === 'degraded'
            ? 'warning'
            : 'critical'
      ),
      driver: this.config.get<MediaConfiguration>('media')?.driver ?? 'unknown',
      storageEnvironment: this.config.get<MediaConfiguration>('media')?.storageEnvironment
        ?? 'unknown',
      readStatus: result.capabilities.read.status,
      writeStatus: result.capabilities.write.status,
      videoValidatorStatus: result.capabilities.videoValidator.status,
      capacityFreePercent: result.capacity.freePercent,
      capacityLevel: result.capacity.level,
      probedAt: new Date(entry.at).toISOString(),
      message: overrideMessage ?? (failed.length === 0 ? null : failed.join('；')),
    }
  }

  private unknownMedia(
    driver: string,
    storageEnvironment: string,
    message: string,
  ): SystemMediaServiceDto {
    return {
      status: 'unknown',
      driver,
      storageEnvironment,
      readStatus: 'unknown',
      writeStatus: 'unknown',
      videoValidatorStatus: 'unknown',
      capacityFreePercent: null,
      capacityLevel: null,
      probedAt: null,
      message,
    }
  }

  private toPerformanceDto(
    snapshot: PerformanceSnapshot,
  ): SystemPerformanceDto {
    return {
      ...snapshot,
      insufficientData: snapshot.windowRequests < PERFORMANCE_MIN_SAMPLES,
      slowest: snapshot.slowest.map(item => ({ ...item })),
    }
  }

  private toResourceDto(resource: SystemResourceSnapshot): SystemResourceDto {
    return {
      host: {
        ...resource.host,
        loadAverage: resource.host.loadAverage === null
          ? null
          : [...resource.host.loadAverage],
      },
      container: { ...resource.container },
      process: { ...resource.process },
      disk: { ...resource.disk },
      network: { ...resource.network },
      sampledAt: resource.sampledAt,
    }
  }

  private buildRuntime(
    resources: SystemResourceSnapshot,
    database: SystemDatabaseServiceDto,
    migration: string | null,
  ): SystemRuntimeDto {
    const mediaConfig = this.config.get<MediaConfiguration>('media')
    const environment = resolveDeploymentEnvironment(process.env)
    const port = Number(process.env.PORT ?? 3000)
    return {
      version: readServerVersion(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      environment: environment.environment,
      environmentSource: environment.source,
      nodeEnv: process.env.NODE_ENV ?? 'unknown',
      port: Number.isInteger(port) && port > 0 ? port : 3000,
      timeZone: process.env.TZ ?? 'unknown',
      mediaDriver: mediaConfig?.driver ?? 'unknown',
      mediaStorageEnvironment: mediaConfig?.storageEnvironment ?? 'unknown',
      mediaDeliveryMode: mediaConfig?.contentDeliveryMode ?? 'unknown',
      assistantWorkerEnabled: process.env.ASSISTANT_WORKER_ENABLED !== 'false',
      startedAt: new Date(
        Date.now() - resources.process.uptimeSeconds * 1000,
      ).toISOString(),
      uptimeSeconds: Math.floor(resources.process.uptimeSeconds),
      migration,
      databaseVersion: database.version,
      databaseTimeZone: database.timeZone,
    }
  }

  private buildChecks(
    resources: SystemResourceSnapshot,
    database: SystemDatabaseServiceDto,
    media: SystemMediaServiceDto,
    performance: SystemPerformanceDto,
  ): SystemStatusCheckDto[] {
    const memoryStatus = this.resolveMemoryStatus(resources)
    const performanceStatus = performance.insufficientData
      ? 'unknown'
      : levelFromUsage(
          performance.errorRatePercent,
          PERFORMANCE_WARNING_ERROR_RATE,
          PERFORMANCE_CRITICAL_ERROR_RATE,
        )

    return [
      {
        key: 'backend',
        label: '后端进程',
        category: 'service',
        status: 'ok',
        message: null,
      },
      {
        key: 'database',
        label: '数据库',
        category: 'service',
        status: database.status,
        message: database.status === 'ok' ? null : '数据库查询失败',
      },
      {
        key: 'media',
        label: '媒体存储',
        category: 'service',
        status: media.status,
        message: media.message,
      },
      {
        key: 'cpu',
        label: 'CPU',
        category: 'resource',
        status: levelFromUsage(
          resources.host.cpuUsagePercent,
          HOST_CPU_WARNING_PERCENT,
          HOST_CPU_CRITICAL_PERCENT,
        ),
        message: null,
      },
      {
        key: 'memory',
        label: '内存',
        category: 'resource',
        status: memoryStatus,
        message: memoryStatus === 'critical'
          && (resources.container.memoryOomKillCount ?? 0) > 0
          ? '容器发生过 OOM Kill'
          : null,
      },
      {
        key: 'disk',
        label: '磁盘',
        category: 'resource',
        status: levelFromFreePercent(resources.disk.freePercent),
        message: null,
      },
      {
        key: 'performance',
        label: '性能',
        category: 'performance',
        status: performanceStatus,
        message: performance.insufficientData ? '近 5 分钟样本不足' : null,
      },
    ]
  }

  private resolveMemoryStatus(
    resources: SystemResourceSnapshot,
  ): SystemStatusLevel {
    if ((resources.container.memoryOomKillCount ?? 0) > 0) {
      return 'critical'
    }
    const current = resources.container.memoryCurrentBytes
    const limit = resources.container.memoryLimitBytes
    if (current === null || limit === null || limit <= 0) {
      return 'unknown'
    }
    const usagePercent = current / limit * 100
    if (usagePercent >= CONTAINER_MEMORY_CRITICAL_PERCENT) {
      return 'critical'
    }
    return usagePercent >= CONTAINER_MEMORY_WARNING_PERCENT ? 'warning' : 'ok'
  }
}
