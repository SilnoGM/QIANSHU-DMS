import { nextTick, readonly, ref } from 'vue'

const STARTUP_MINIMUM_MS = 1500
const STARTUP_MAXIMUM_MS = 2000
const STARTUP_FADE_MS = 180

const visible = ref(false)
const leaving = ref(false)
let running = false

/**
 * 登录成功后的启动页是“最短停留 + 实际导航完成”的组合：
 * 先保证随机 1500–2000ms 的品牌展示，再以真实导航耗时为准；导航更慢时不会提前撤场。
 */
export function createStartupMinimumDuration(random: () => number = Math.random): number {
  const sample = Math.min(Math.max(random(), 0), 1)
  return STARTUP_MINIMUM_MS + Math.floor(sample * (STARTUP_MAXIMUM_MS - STARTUP_MINIMUM_MS))
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms)
  })
}

export function useAppStartup() {
  async function run(
    navigate: () => Promise<unknown> | unknown,
    options: { minimumMs?: number } = {},
  ): Promise<void> {
    if (running) {
      return
    }

    running = true
    visible.value = true
    leaving.value = false

    // 先让启动页进入 DOM，再开始真实导航；导航期间登录页即使卸载，App 根层的启动页仍保留。
    await nextTick()

    try {
      await Promise.allSettled([
        Promise.resolve().then(navigate),
        wait(options.minimumMs ?? createStartupMinimumDuration()),
      ])
    }
    finally {
      leaving.value = true
      await wait(STARTUP_FADE_MS)
      visible.value = false
      leaving.value = false
      running = false
    }
  }

  return {
    visible: readonly(visible),
    leaving: readonly(leaving),
    run,
  }
}
