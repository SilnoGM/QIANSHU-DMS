import { readFile, statfs } from 'node:fs/promises'
import {
  availableParallelism,
  cpus,
  freemem,
  totalmem,
} from 'node:os'

import { Injectable, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import {
  DEFAULT_MEDIA_STORAGE_ROOT,
  type MediaConfiguration,
} from '../../config/media.config'
import {
  computeCpuUsagePercent,
  computePercent,
  computeRatePerSecond,
  computeStatFsPercent,
  parseByteValue,
  parseCgroupCpuMax,
  parseCgroupCpuStat,
  parseMemoryEventsValue,
  parseMemoryStatValue,
  parsePidMax,
  parseProcLoadAverage,
  parseProcMemInfo,
  parseProcNetDev,
  parseProcStatCpu,
  toSafeNumber,
  type ContainerCpuStat,
  type CpuCounters,
  type NetworkCounters,
  type StatFsCounters,
} from './system-resource.parsers'
import type { SystemResourceSnapshot } from './system-resource.types'

const PROC_ROOT = '/proc'
const CGROUP_ROOT = '/sys/fs/cgroup'
const SAMPLE_CACHE_MS = 5_000
const MICROSECONDS_PER_SECOND = 1_000_000

interface PreviousResourceSample {
  readonly at: number
  readonly containerUsageUsec: bigint | null
  readonly cpu: CpuCounters | null
  readonly network: NetworkCounters | null
}

/**
 * 只读 IO 适配器。单独抽出来让采样器可以在普通单测里注入固定文本，
 * 不需要真的运行在 Linux 容器内。
 */
@Injectable()
export class SystemResourceIo {
  async readText(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8')
    }
    catch {
      return null
    }
  }

  async statfs(path: string): Promise<StatFsCounters | null> {
    try {
      const value = await statfs(path, { bigint: true })
      return {
        blockSize: value.bsize,
        blocks: value.blocks,
        freeBlocks: value.bfree,
        availableBlocks: value.bavail,
        files: value.files,
        freeFiles: value.ffree,
      }
    }
    catch {
      return null
    }
  }
}

/**
 * 采集 Server 容器可读的宿主/容器资源快照。
 *
 * - `/proc` 与 `os` 反映宿主（容器共享宿主内核视图）；
 * - `/sys/fs/cgroup` 反映本容器；
 * - `statfs(MEDIA_STORAGE_ROOT)` 反映媒体绑定目录所在的宿主文件系统。
 *
 * 所有 IO 失败都降级为 null，不抛出、不伪造 0；页面据此显示“未知”。首次采样
 * 没有 CPU/网络基线，相关速率自然为 null，由 `OnModuleInit` 预热。
 */
@Injectable()
export class SystemResourceSampler implements OnModuleInit {
  private cached: SystemResourceSnapshot | null = null
  private cachedAt = 0
  private inFlight: Promise<SystemResourceSnapshot> | null = null
  private previous: PreviousResourceSample | null = null

  constructor(
    private readonly io: SystemResourceIo,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // 预热一次，让页面在应用刚启动时也能算出第一份 CPU/网络速率基线。
    void this.sample().catch(() => undefined)
  }

  async sample(now = Date.now()): Promise<SystemResourceSnapshot> {
    if (this.cached !== null && now - this.cachedAt < SAMPLE_CACHE_MS) {
      return this.cached
    }
    if (this.inFlight !== null) {
      return this.inFlight
    }

    this.inFlight = this.collect(now)
      .then((snapshot) => {
        this.cached = snapshot
        this.cachedAt = now
        return snapshot
      })
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  private async collect(now: number): Promise<SystemResourceSnapshot> {
    const mediaConfig = this.config.get<MediaConfiguration>('media')
    const storageRoot = mediaConfig?.storageRoot ?? DEFAULT_MEDIA_STORAGE_ROOT
    const [
      procStat,
      loadAverage,
      memInfo,
      netDev,
      memoryCurrent,
      memoryMax,
      memoryPeak,
      memoryStat,
      memoryEvents,
      cpuStatText,
      cpuMaxText,
      pidCurrentText,
      pidMaxText,
      diskCounters,
    ] = await Promise.all([
      this.io.readText(`${PROC_ROOT}/stat`),
      this.io.readText(`${PROC_ROOT}/loadavg`),
      this.io.readText(`${PROC_ROOT}/meminfo`),
      this.io.readText(`${PROC_ROOT}/net/dev`),
      this.io.readText(`${CGROUP_ROOT}/memory.current`),
      this.io.readText(`${CGROUP_ROOT}/memory.max`),
      this.io.readText(`${CGROUP_ROOT}/memory.peak`),
      this.io.readText(`${CGROUP_ROOT}/memory.stat`),
      this.io.readText(`${CGROUP_ROOT}/memory.events`),
      this.io.readText(`${CGROUP_ROOT}/cpu.stat`),
      this.io.readText(`${CGROUP_ROOT}/cpu.max`),
      this.io.readText(`${CGROUP_ROOT}/pids.current`),
      this.io.readText(`${CGROUP_ROOT}/pids.max`),
      this.io.statfs(storageRoot),
    ])

    const previous = this.previous
    const cpu = procStat === null ? null : parseProcStatCpu(procStat)
    const network = netDev === null ? null : parseProcNetDev(netDev)
    const hostMemory = memInfo === null ? null : parseProcMemInfo(memInfo)
    const containerCpu = cpuStatText === null
      ? null
      : parseCgroupCpuStat(cpuStatText)
    const cpuLimit = cpuMaxText === null
      ? null
      : parseCgroupCpuMax(cpuMaxText)
    const elapsedMs = previous === null ? 0 : now - previous.at
    const cpuCount = availableParallelism?.() ?? cpus().length

    const hostCpuUsagePercent = previous?.cpu && cpu
      ? computeCpuUsagePercent(previous.cpu, cpu)
      : null
    const containerCpuUsageCores = this.computeContainerCpuCores(
      previous,
      containerCpu,
      elapsedMs,
    )
    const containerCpuPercentOfHost = containerCpuUsageCores === null
      ? null
      : computePercent(containerCpuUsageCores, cpuCount)
    const cpuQuotaCores = cpuLimit?.quotaUsec
      && cpuLimit.periodUsec
      ? cpuLimit.quotaUsec / cpuLimit.periodUsec
      : null

    const memoryCurrentBytes = parseByteValue(memoryCurrent ?? '')
    const memoryLimitBytes = parseByteValue(memoryMax ?? '')
    const memoryPeakBytes = parseByteValue(memoryPeak ?? '')
    const memoryAnonBytes = parseMemoryStatValue(memoryStat ?? '', 'anon')
    const memoryOomKillCount = parseMemoryEventsValue(memoryEvents ?? '', 'oom_kill')
    const pidCount = parseByteValue(pidCurrentText ?? '')
    const pidLimit = pidMaxText === null ? null : parsePidMax(pidMaxText)

    const processMemory = process.memoryUsage()
    const disk = this.buildDisk(diskCounters)
    const rxBytesPerSecond = previous?.network && network
      ? computeRatePerSecond(
          previous.network.rxBytes,
          network.rxBytes,
          elapsedMs,
        )
      : null
    const txBytesPerSecond = previous?.network && network
      ? computeRatePerSecond(
          previous.network.txBytes,
          network.txBytes,
          elapsedMs,
        )
      : null

    this.previous = {
      at: now,
      containerUsageUsec: containerCpu?.usageUsec ?? null,
      cpu,
      network,
    }

    return {
      sampledAt: new Date(now).toISOString(),
      host: {
        cpuCount,
        cpuUsagePercent: hostCpuUsagePercent,
        loadAverage: loadAverage === null
          ? null
          : parseProcLoadAverage(loadAverage),
        memoryTotalBytes: hostMemory?.totalBytes ?? totalmem(),
        memoryAvailableBytes: hostMemory?.availableBytes ?? freemem(),
      },
      container: {
        cpuUsageCores: containerCpuUsageCores,
        cpuUsagePercentOfHost: containerCpuPercentOfHost,
        cpuQuotaCores,
        cpuThrottledPeriods: containerCpu?.throttledPeriods ?? null,
        memoryCurrentBytes,
        memoryLimitBytes,
        memoryPeakBytes,
        memoryAnonBytes,
        memoryOomKillCount,
        pidCount,
        pidLimit,
      },
      process: {
        rssBytes: processMemory.rss,
        heapUsedBytes: processMemory.heapUsed,
        uptimeSeconds: process.uptime(),
      },
      disk,
      network: {
        rxBytesPerSecond,
        txBytesPerSecond,
      },
    }
  }

  private computeContainerCpuCores(
    previous: PreviousResourceSample | null,
    current: ContainerCpuStat | null,
    elapsedMs: number,
  ): number | null {
    if (
      previous?.containerUsageUsec === null
      || previous?.containerUsageUsec === undefined
      || current === null
    ) {
      return null
    }
    const microsPerSecond = computeRatePerSecond(
      previous.containerUsageUsec,
      current.usageUsec,
      elapsedMs,
    )
    if (microsPerSecond === null) {
      return null
    }
    return microsPerSecond / MICROSECONDS_PER_SECOND
  }

  private buildDisk(diskCounters: StatFsCounters | null): SystemResourceSnapshot['disk'] {
    if (diskCounters === null) {
      return {
        totalBytes: null,
        freeBytes: null,
        availableBytes: null,
        freePercent: null,
        inodeTotal: null,
        inodeFree: null,
        inodeUsedPercent: null,
      }
    }

    const totalBytes = toSafeNumber(diskCounters.blocks * diskCounters.blockSize)
    const freeBytes = toSafeNumber(diskCounters.freeBlocks * diskCounters.blockSize)
    const availableBytes = toSafeNumber(
      diskCounters.availableBlocks * diskCounters.blockSize,
    )
    const inodeTotal = toSafeNumber(diskCounters.files)
    const inodeFree = toSafeNumber(diskCounters.freeFiles)
    return {
      totalBytes,
      freeBytes,
      availableBytes,
      freePercent: computeStatFsPercent(
        diskCounters.availableBlocks,
        diskCounters.blocks,
      ),
      inodeTotal,
      inodeFree,
      inodeUsedPercent: inodeTotal === null || inodeFree === null
        ? null
        : computePercent(inodeTotal - inodeFree, inodeTotal),
    }
  }
}
