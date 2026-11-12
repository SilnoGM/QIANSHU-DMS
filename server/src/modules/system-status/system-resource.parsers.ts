/**
 * `/proc`、cgroup v2 与 `statfs` 的纯解析函数。
 *
 * 这些函数只接收文本/数字，不访问文件系统，因此可以在不依赖 Linux 宿主的情况下
 * 用固定 fixture 覆盖格式漂移、计数器重置和缺失字段。真正的 IO 在
 * `system-resource-sampler.ts`。
 */

export interface CpuCounters {
  readonly total: bigint
  readonly idle: bigint
}

export interface NetworkCounters {
  readonly rxBytes: bigint
  readonly txBytes: bigint
}

export interface HostMemoryCounters {
  readonly totalBytes: number
  readonly availableBytes: number
}

export interface ContainerCpuStat {
  readonly usageUsec: bigint
  readonly throttledPeriods: number | null
}

export interface ContainerCpuLimit {
  readonly quotaUsec: number | null
  readonly periodUsec: number | null
}

export interface StatFsCounters {
  readonly blockSize: bigint
  readonly blocks: bigint
  readonly freeBlocks: bigint
  readonly availableBlocks: bigint
  readonly files: bigint
  readonly freeFiles: bigint
}

const KIB_BYTES = 1024
// /proc/stat 的 cpu 行至少包含 user..steal 八个字段；guest/guest_nice 已包含在
// user/nice 中，不能再计入 total，否则使用率会被重复计算。
const CPU_FIELDS_IN_TOTAL = 8
const CPU_IDLE_INDEX = 3
const CPU_IOWAIT_INDEX = 4
const NET_RX_BYTES_INDEX = 0
const NET_TX_BYTES_INDEX = 8

function parseNonNegativeBigInt(value: string): bigint | null {
  if (!/^\d+$/u.test(value)) {
    return null
  }
  return BigInt(value)
}

function parseNonNegativeNumber(value: string): number | null {
  if (!/^\d+$/u.test(value)) {
    return null
  }
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function findColonValue(source: string, key: string): string | null {
  for (const line of source.split(/\r?\n/u)) {
    const separator = line.indexOf(':')
    if (separator === -1) {
      continue
    }
    if (line.slice(0, separator).trim() === key) {
      return line.slice(separator + 1).trim()
    }
  }
  return null
}

/**
 * cgroup v2 的 `memory.stat`、`memory.events` 与 `cpu.stat` 使用空格分隔的
 * `key value`，不是 `/proc/meminfo` 的冒号格式。
 */
function findWhitespaceValue(source: string, key: string): string | null {
  for (const line of source.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u)
    if (fields[0] === key && fields.length >= 2) {
      return fields.slice(1).join(' ')
    }
  }
  return null
}

/**
 * 解析 `/proc/stat` 的首行 `cpu` 聚合计数。
 *
 * 容器内看到的是宿主全部 CPU 的累计值；调用方必须把它标注为宿主口径。
 */
export function parseProcStatCpu(source: string): CpuCounters | null {
  const line = source
    .split(/\r?\n/u)
    .find(candidate => /^cpu\s+/u.test(candidate))
  if (line === undefined) {
    return null
  }

  const fields = line.trim().split(/\s+/u).slice(1)
  if (fields.length < CPU_FIELDS_IN_TOTAL) {
    return null
  }

  const counters: bigint[] = []
  for (const field of fields.slice(0, CPU_FIELDS_IN_TOTAL)) {
    const parsed = parseNonNegativeBigInt(field)
    if (parsed === null) {
      return null
    }
    counters.push(parsed)
  }

  const total = counters.reduce((sum, value) => sum + value, 0n)
  const idle = counters[CPU_IDLE_INDEX] + counters[CPU_IOWAIT_INDEX]
  if (total <= 0n || idle > total) {
    return null
  }
  return { total, idle }
}

export function parseProcLoadAverage(
  source: string,
): [number, number, number] | null {
  const fields = source.trim().split(/\s+/u).slice(0, 3).map(Number)
  if (
    fields.length !== 3
    || fields.some(value => !Number.isFinite(value) || value < 0)
  ) {
    return null
  }
  return [fields[0], fields[1], fields[2]]
}

/** 解析 `MemTotal` 与 `MemAvailable`，统一换算为字节。 */
export function parseProcMemInfo(source: string): HostMemoryCounters | null {
  const totalKib = findColonValue(source, 'MemTotal')
  const availableKib = findColonValue(source, 'MemAvailable')
  if (totalKib === null || availableKib === null) {
    return null
  }

  const totalMatch = totalKib.match(/^(\d+)\s+kB$/u)
  const availableMatch = availableKib.match(/^(\d+)\s+kB$/u)
  if (totalMatch === null || availableMatch === null) {
    return null
  }

  const total = Number(totalMatch[1]) * KIB_BYTES
  const available = Number(availableMatch[1]) * KIB_BYTES
  if (
    !Number.isSafeInteger(total)
    || !Number.isSafeInteger(available)
    || total <= 0
    || available < 0
    || available > total
  ) {
    return null
  }
  return { totalBytes: total, availableBytes: available }
}

/**
 * 解析 `/proc/net/dev`。
 *
 * 优先使用 `eth0`；没有 `eth0` 时汇总所有非 `lo` 接口。容器网络命名空间只包含
 * 自身接口，因此结果不能当作宿主网卡或公网带宽。
 */
export function parseProcNetDev(source: string): NetworkCounters | null {
  const interfaces = new Map<string, NetworkCounters>()

  for (const line of source.split(/\r?\n/u)) {
    const separator = line.indexOf(':')
    if (separator === -1) {
      continue
    }
    const name = line.slice(0, separator).trim()
    const fields = line.slice(separator + 1).trim().split(/\s+/u)
    if (name === '' || fields.length <= NET_TX_BYTES_INDEX) {
      continue
    }
    const rxBytes = parseNonNegativeBigInt(fields[NET_RX_BYTES_INDEX])
    const txBytes = parseNonNegativeBigInt(fields[NET_TX_BYTES_INDEX])
    if (rxBytes === null || txBytes === null) {
      continue
    }
    interfaces.set(name, { rxBytes, txBytes })
  }

  const preferred = interfaces.get('eth0')
  if (preferred !== undefined) {
    return preferred
  }

  let rxBytes = 0n
  let txBytes = 0n
  for (const [name, counters] of interfaces) {
    if (name === 'lo') {
      continue
    }
    rxBytes += counters.rxBytes
    txBytes += counters.txBytes
  }
  if (rxBytes === 0n && txBytes === 0n) {
    return null
  }
  return { rxBytes, txBytes }
}

/** 读取 cgroup 单值文件；`max` 表示无上限。 */
export function parseByteValue(source: string): number | null {
  const value = source.trim()
  if (value === '' || value === 'max') {
    return null
  }
  return parseNonNegativeNumber(value)
}

/** 读取 `memory.stat` 的指定 key，例如 `anon`。 */
export function parseMemoryStatValue(
  source: string,
  key: string,
): number | null {
  const value = findWhitespaceValue(source, key)
  if (value === null) {
    return null
  }
  return parseNonNegativeNumber(value)
}

/** 读取 `memory.events` 的指定 key，例如 `oom_kill`。 */
export function parseMemoryEventsValue(
  source: string,
  key: string,
): number | null {
  const value = findWhitespaceValue(source, key)
  if (value === null) {
    return null
  }
  return parseNonNegativeNumber(value)
}

export function parseCgroupCpuStat(source: string): ContainerCpuStat | null {
  const usage = findWhitespaceValue(source, 'usage_usec')
  if (usage === null) {
    return null
  }
  const usageUsec = parseNonNegativeBigInt(usage)
  if (usageUsec === null) {
    return null
  }
  const throttled = findWhitespaceValue(source, 'nr_throttled')
  return {
    usageUsec,
    throttledPeriods: throttled === null
      ? null
      : parseNonNegativeNumber(throttled),
  }
}

/**
 * 解析 `cpu.max`：`max 100000` 表示无配额；`50000 100000` 表示 0.5 核。
 */
export function parseCgroupCpuMax(source: string): ContainerCpuLimit | null {
  const fields = source.trim().split(/\s+/u)
  if (fields.length !== 2) {
    return null
  }
  const [quota, period] = fields
  const periodUsec = parseNonNegativeNumber(period)
  if (periodUsec === null || periodUsec <= 0) {
    return null
  }
  if (quota === 'max') {
    return { quotaUsec: null, periodUsec }
  }
  const quotaUsec = parseNonNegativeNumber(quota)
  if (quotaUsec === null || quotaUsec <= 0) {
    return null
  }
  return { quotaUsec, periodUsec }
}

/** `pids.max` 为 `max` 时返回 null，表示不限制。 */
export function parsePidMax(source: string): number | null {
  const value = source.trim()
  if (value === 'max') {
    return null
  }
  return parseNonNegativeNumber(value)
}

export function computeCpuUsagePercent(
  previous: CpuCounters,
  current: CpuCounters,
): number | null {
  const totalDelta = current.total - previous.total
  const idleDelta = current.idle - previous.idle
  if (totalDelta <= 0n || idleDelta < 0n || idleDelta > totalDelta) {
    return null
  }
  const usage = Number(totalDelta - idleDelta) / Number(totalDelta) * 100
  return clampPercent(usage)
}

/**
 * 计数器重置（容器重建）时返回 null，页面显示“未知”，而不是伪造一个负速率。
 */
export function computeRatePerSecond(
  previous: bigint,
  current: bigint,
  elapsedMs: number,
): number | null {
  if (elapsedMs <= 0 || current < previous) {
    return null
  }
  return Number(current - previous) / (elapsedMs / 1000)
}

export function computePercent(
  value: number | null,
  total: number | null,
): number | null {
  if (value === null || total === null || total <= 0 || value < 0) {
    return null
  }
  return clampPercent(value / total * 100)
}

export function computeStatFsPercent(
  availableBlocks: bigint,
  totalBlocks: bigint,
): number | null {
  if (totalBlocks <= 0n || availableBlocks < 0n || availableBlocks > totalBlocks) {
    return null
  }
  return Number(availableBlocks) / Number(totalBlocks) * 100
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.round(value * 100) / 100))
}

export function toSafeNumber(value: bigint): number | null {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null
  }
  return Number(value)
}
