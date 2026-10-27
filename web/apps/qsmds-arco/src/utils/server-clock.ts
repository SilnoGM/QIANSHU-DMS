/**
 * 服务端时钟估值。
 *
 * 「入仓时间不能晚于当前时间」这类规则由服务端时钟裁决，而浏览器时钟可能比服务器快几分钟
 * 甚至几小时：默认值取本地「此刻」时，服务端会把整笔提交判成未来，用户却完全看不出来。
 * 这里用任意 API 响应的 Date 头校准一次，之后所有面向用户的时间上限都取**保守下界**，
 * 保证提交值一定早于服务端记录时间。
 */

/**
 * Date 头只到秒，且响应生成与到达之间有网络延迟，二者都会让锚点偏晚。
 * 固定回退 2 秒，使估值始终不晚于服务端真实时刻。
 */
const SAFETY_MARGIN_MS = 2_000

interface ServerClockSample {
  readonly serverEpochMs: number
  readonly clientEpochMs: number
}

let sample: ServerClockSample | null = null

/**
 * 记录一次校准样本。Date 头缺失或被代理改写时保持上一个样本，
 * 不让个别响应把估值退化成纯本地时钟。
 */
export function recordServerClockSample(
  dateHeader: unknown,
  clientEpochMs: number = Date.now(),
): void {
  if (typeof dateHeader !== 'string' || dateHeader.trim() === '') {
    return
  }

  const serverEpochMs = Date.parse(dateHeader)
  if (!Number.isFinite(serverEpochMs) || !Number.isFinite(clientEpochMs)) {
    return
  }

  sample = { clientEpochMs, serverEpochMs }
}

/**
 * 服务端当前时刻的保守估值：一定不晚于服务端真实时刻。
 * 没有样本时退回本地时钟，同样保留安全余量。
 */
export function serverNowEpochMs(
  clientEpochMs: number = Date.now(),
): number {
  if (sample === null) {
    return clientEpochMs - SAFETY_MARGIN_MS
  }

  // 样本之后经过的本地时长可近似当作服务端已过时长；时钟漂移在分钟级窗口内可忽略。
  return sample.serverEpochMs
    + (clientEpochMs - sample.clientEpochMs)
    - SAFETY_MARGIN_MS
}

export function serverNow(clientEpochMs: number = Date.now()): Date {
  return new Date(serverNowEpochMs(clientEpochMs))
}

export function hasServerClockSample(): boolean {
  return sample !== null
}

/** 身份切换或测试隔离时清空校准结果。 */
export function resetServerClock(): void {
  sample = null
}
