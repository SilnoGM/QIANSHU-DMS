import type { PrismaService } from '../../src/infrastructure/database/prisma.service'

/** 本地 Docker 和宿主机可能有秒级偏差。发货用宿主 Date、入仓用数据库时钟；测试统一起点，仅替换 Date，不冻结网络和超时调度。 */
export async function withDatabaseBusinessClock<T>(prisma: PrismaService, action: () => Promise<T>): Promise<T> {
  const [clock] = await prisma.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
  jest.useFakeTimers({
    now: clock.now,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  })
  try {
    return await action()
  }
  finally {
    jest.useRealTimers()
  }
}
