import {
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
} from 'vue'

import { serverNowEpochMs } from '@/utils/server-clock'

/**
 * 页面级共享时钟。
 *
 * - 只有一个 interval；所有卡片消费同一个 `nowMs`。
 * - 每 tick 用 server-clock 重新取绝对时间，不累加，后台恢复后不会漂移。
 * - 页面隐藏或 KeepAlive 停用时停止，恢复时立即重算。
 */
export function useNowTicker(intervalMs = 1_000) {
  const nowMs = ref(serverNowEpochMs())
  let timer: number | undefined
  let enabled = true

  function tick(): void {
    nowMs.value = serverNowEpochMs()
  }

  function start(): void {
    if (timer !== undefined) {
      return
    }
    tick()
    timer = window.setInterval(tick, intervalMs)
  }

  function stop(): void {
    if (timer === undefined) {
      return
    }
    window.clearInterval(timer)
    timer = undefined
  }

  function sync(): void {
    if (enabled && document.visibilityState !== 'hidden') {
      start()
    }
    else {
      stop()
    }
  }

  function handleVisibility(): void {
    sync()
  }

  onMounted(() => {
    enabled = true
    sync()
    document.addEventListener('visibilitychange', handleVisibility)
  })

  onActivated(() => {
    enabled = true
    sync()
  })

  onDeactivated(() => {
    enabled = false
    stop()
  })

  onUnmounted(() => {
    enabled = false
    stop()
    document.removeEventListener('visibilitychange', handleVisibility)
  })

  return {
    nowMs,
  }
}
