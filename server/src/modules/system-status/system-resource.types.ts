/**
 * 系统资源快照的公共类型。
 *
 * 宿主与容器是两套口径：`host` 来自 `/proc` 与 `os`，反映整台服务器；`container`
 * 来自 cgroup v2，只反映本 Server 容器。页面必须分别标注，不能混用。
 */
export interface SystemHostResource {
  readonly cpuCount: number
  readonly cpuUsagePercent: number | null
  readonly loadAverage: readonly [number, number, number] | null
  readonly memoryTotalBytes: number
  readonly memoryAvailableBytes: number
}

export interface SystemContainerResource {
  readonly cpuUsageCores: number | null
  readonly cpuUsagePercentOfHost: number | null
  readonly cpuQuotaCores: number | null
  readonly cpuThrottledPeriods: number | null
  readonly memoryCurrentBytes: number | null
  readonly memoryLimitBytes: number | null
  readonly memoryPeakBytes: number | null
  readonly memoryAnonBytes: number | null
  readonly memoryOomKillCount: number | null
  readonly pidCount: number | null
  readonly pidLimit: number | null
}

export interface SystemProcessResource {
  readonly rssBytes: number
  readonly heapUsedBytes: number
  readonly uptimeSeconds: number
}

export interface SystemDiskResource {
  readonly totalBytes: number | null
  readonly freeBytes: number | null
  readonly availableBytes: number | null
  readonly freePercent: number | null
  readonly inodeTotal: number | null
  readonly inodeFree: number | null
  readonly inodeUsedPercent: number | null
}

export interface SystemNetworkResource {
  readonly rxBytesPerSecond: number | null
  readonly txBytesPerSecond: number | null
}

export interface SystemResourceSnapshot {
  readonly sampledAt: string
  readonly host: SystemHostResource
  readonly container: SystemContainerResource
  readonly process: SystemProcessResource
  readonly disk: SystemDiskResource
  readonly network: SystemNetworkResource
}
