import {
  clampPercent,
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
} from './system-resource.parsers'

const PROC_STAT = `cpu  5033568 16355 3541130 579226513 667827 0 148258 0 0 0
cpu0 2516981 8576 1772940 289646270 342443 0 70982 0 0 0
cpu1 2516587 7778 1768190 289580243 325384 0 77276 0 0 0
`
const PROC_MEMINFO = `MemTotal:        3813260 kB
MemFree:          434972 kB
MemAvailable:    2919744 kB
`
const PROC_NETDEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 20833088  176276    0    0    0     0          0         0 20833088  176276    0    0    0     0       0          0
  eth0: 23804421  149696    0    0    0     0          0         0 20736475  212660    0    0    0     0       0          0
`

describe('system resource parsers', () => {
  it('parses aggregate cpu counters and keeps guest fields out of the total', () => {
    const counters = parseProcStatCpu(PROC_STAT)
    expect(counters).not.toBeNull()
    expect(counters?.total).toBe(
      5033568n + 16355n + 3541130n + 579226513n + 667827n + 0n + 148258n + 0n,
    )
    expect(counters?.idle).toBe(579226513n + 667827n)
  })

  it('rejects malformed cpu lines instead of treating them as zero', () => {
    expect(parseProcStatCpu('cpu  1 2 3\n')).toBeNull()
    expect(parseProcStatCpu('intr 1 2 3\n')).toBeNull()
  })

  it('parses load average and memory counters', () => {
    expect(parseProcLoadAverage('0.10 0.03 0.01 2/313 86027\n')).toEqual([0.1, 0.03, 0.01])
    expect(parseProcLoadAverage('bad')).toBeNull()
    expect(parseProcMemInfo(PROC_MEMINFO)).toEqual({
      totalBytes: 3813260 * 1024,
      availableBytes: 2919744 * 1024,
    })
  })

  it('prefers eth0 and falls back to aggregating non-loopback interfaces', () => {
    expect(parseProcNetDev(PROC_NETDEV)).toEqual({
      rxBytes: 23804421n,
      txBytes: 20736475n,
    })
    const fallback = `eth1: 100 1 0 0 0 0 0 0 200 1 0 0 0 0 0 0
eth2: 300 1 0 0 0 0 0 0 400 1 0 0 0 0 0 0
lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0
`
    expect(parseProcNetDev(fallback)).toEqual({ rxBytes: 400n, txBytes: 600n })
    expect(parseProcNetDev('no interfaces')).toBeNull()
  })

  it('parses cgroup byte values, memory stat, events and cpu limits', () => {
    expect(parseByteValue('322351104\n')).toBe(322351104)
    expect(parseByteValue('max\n')).toBeNull()
    expect(parseMemoryStatValue('anon 161193984\nfile 149782528\n', 'anon')).toBe(161193984)
    expect(parseMemoryEventsValue('low 0\nhigh 0\nmax 0\noom 0\noom_kill 2\n', 'oom_kill')).toBe(2)
    expect(parseCgroupCpuStat('usage_usec 425386563\nnr_periods 0\nnr_throttled 3\n')).toEqual({
      usageUsec: 425386563n,
      throttledPeriods: 3,
    })
    expect(parseCgroupCpuMax('max 100000\n')).toEqual({
      quotaUsec: null,
      periodUsec: 100000,
    })
    expect(parseCgroupCpuMax('50000 100000\n')).toEqual({
      quotaUsec: 50000,
      periodUsec: 100000,
    })
    expect(parsePidMax('max\n')).toBeNull()
    expect(parsePidMax('4370\n')).toBe(4370)
  })

  it('computes cpu usage and rates without inventing values on reset', () => {
    const previous = { total: 1000n, idle: 800n }
    const current = { total: 1200n, idle: 900n }
    expect(computeCpuUsagePercent(previous, current)).toBe(50)
    expect(computeCpuUsagePercent(current, previous)).toBeNull()
    expect(computeRatePerSecond(100n, 200n, 1000)).toBe(100)
    expect(computeRatePerSecond(200n, 100n, 1000)).toBeNull()
    expect(computeRatePerSecond(100n, 200n, 0)).toBeNull()
    expect(computePercent(50, 200)).toBe(25)
    expect(computePercent(50, 0)).toBeNull()
    expect(computeStatFsPercent(300n, 1000n)).toBe(30)
    expect(computeStatFsPercent(1001n, 1000n)).toBeNull()
    expect(clampPercent(120)).toBe(100)
    expect(clampPercent(-1)).toBe(0)
    expect(toSafeNumber(123n)).toBe(123)
    expect(toSafeNumber(-1n)).toBeNull()
  })
})
