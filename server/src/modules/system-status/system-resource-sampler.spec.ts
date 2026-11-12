import { ConfigService } from '@nestjs/config'

import type { StatFsCounters } from './system-resource.parsers'
import { SystemResourceIo, SystemResourceSampler } from './system-resource-sampler'

const PROC_STAT = (total: number, idle: number): string =>
  `cpu  ${total - idle} 0 0 ${idle} 0 0 0 0 0 0\n`
const PROC_MEMINFO = `MemTotal:        3813260 kB
MemFree:          434972 kB
MemAvailable:    2919744 kB
`
const PROC_NETDEV = (rx: number, tx: number): string =>
  `Inter-|   Receive | Transmit
 face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed
  eth0: ${rx} 1 0 0 0 0 0 0 ${tx} 1 0 0 0 0 0 0
`
const CGROUP_ROOT = '/sys/fs/cgroup'
const PROC_ROOT = '/proc'

class FakeIo extends SystemResourceIo {
  readonly files = new Map<string, string>()
  disk: StatFsCounters | null = {
    blockSize: 4096n,
    blocks: 1000n,
    freeBlocks: 400n,
    availableBlocks: 300n,
    files: 100n,
    freeFiles: 90n,
  }

  override readText(path: string): Promise<string | null> {
    return Promise.resolve(this.files.get(path) ?? null)
  }

  override statfs(): Promise<StatFsCounters | null> {
    return Promise.resolve(this.disk)
  }
}

function createSampler(io: FakeIo): SystemResourceSampler {
  const config = {
    get: () => ({ storageRoot: '/var/lib/qianshu-dms/media' }),
  } as unknown as ConfigService
  return new SystemResourceSampler(io, config)
}

function primeFiles(io: FakeIo, cpuTotal: number, cpuIdle: number, usageUsec: number): void {
  io.files.set(`${PROC_ROOT}/stat`, PROC_STAT(cpuTotal, cpuIdle))
  io.files.set(`${PROC_ROOT}/loadavg`, '0.10 0.03 0.01 2/313 86027\n')
  io.files.set(`${PROC_ROOT}/meminfo`, PROC_MEMINFO)
  io.files.set(`${PROC_ROOT}/net/dev`, PROC_NETDEV(100, 200))
  io.files.set(`${CGROUP_ROOT}/memory.current`, '322351104\n')
  io.files.set(`${CGROUP_ROOT}/memory.max`, '1073741824\n')
  io.files.set(`${CGROUP_ROOT}/memory.peak`, '397090816\n')
  io.files.set(`${CGROUP_ROOT}/memory.stat`, 'anon 161193984\nfile 149782528\n')
  io.files.set(`${CGROUP_ROOT}/memory.events`, 'oom 0\noom_kill 0\n')
  io.files.set(`${CGROUP_ROOT}/cpu.stat`, `usage_usec ${usageUsec}\nnr_periods 0\nnr_throttled 0\n`)
  io.files.set(`${CGROUP_ROOT}/cpu.max`, 'max 100000\n')
  io.files.set(`${CGROUP_ROOT}/pids.current`, '13\n')
  io.files.set(`${CGROUP_ROOT}/pids.max`, '4370\n')
}

describe('SystemResourceSampler', () => {
  it('returns host and container resource snapshots without inventing rates on the first sample', async () => {
    const io = new FakeIo()
    primeFiles(io, 1000, 800, 1_000_000)
    const sampler = createSampler(io)

    const first = await sampler.sample(1_000)
    expect(first.host.cpuUsagePercent).toBeNull()
    expect(first.network).toEqual({ rxBytesPerSecond: null, txBytesPerSecond: null })
    expect(first.host.memoryTotalBytes).toBe(3813260 * 1024)
    expect(first.container.memoryCurrentBytes).toBe(322351104)
    expect(first.container.memoryLimitBytes).toBe(1073741824)
    expect(first.container.memoryOomKillCount).toBe(0)
    expect(first.container.pidCount).toBe(13)
    expect(first.container.pidLimit).toBe(4370)
    expect(first.container.cpuQuotaCores).toBeNull()
    expect(first.disk).toEqual({
      totalBytes: 4_096_000,
      freeBytes: 1_638_400,
      availableBytes: 1_228_800,
      freePercent: 30,
      inodeTotal: 100,
      inodeFree: 90,
      inodeUsedPercent: 10,
    })
  })

  it('computes host cpu, container cores and network rates from deltas', async () => {
    const io = new FakeIo()
    primeFiles(io, 1000, 800, 1_000_000)
    const sampler = createSampler(io)
    await sampler.sample(1_000)

    io.files.set(`${PROC_ROOT}/stat`, PROC_STAT(1200, 900))
    io.files.set(`${PROC_ROOT}/net/dev`, PROC_NETDEV(300, 500))
    io.files.set(`${CGROUP_ROOT}/cpu.stat`, 'usage_usec 1500000\nnr_periods 0\nnr_throttled 0\n')
    // 采样器有 5 秒缓存；跨过缓存窗口后再采样，才能得到真实差分。
    const second = await sampler.sample(6_000)

    expect(second.host.cpuUsagePercent).toBe(50)
    expect(second.container.cpuUsageCores).toBeCloseTo(0.1, 5)
    expect(second.container.cpuUsagePercentOfHost).toBeGreaterThan(0)
    expect(second.network).toEqual({
      rxBytesPerSecond: 40,
      txBytesPerSecond: 60,
    })
  })

  it('degrades missing files to null instead of throwing', async () => {
    const io = new FakeIo()
    io.disk = null
    const sampler = createSampler(io)

    const snapshot = await sampler.sample(1_000)
    expect(snapshot.container.memoryCurrentBytes).toBeNull()
    expect(snapshot.container.cpuUsageCores).toBeNull()
    expect(snapshot.host.cpuUsagePercent).toBeNull()
    expect(snapshot.host.memoryTotalBytes).toBeGreaterThan(0)
    expect(snapshot.disk.totalBytes).toBeNull()
    expect(snapshot.disk.freePercent).toBeNull()
  })
})
