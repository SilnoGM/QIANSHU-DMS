import type { QsToastType } from '@/components/base/QsToast/types'

export type ToastSoundGroup = 'error' | 'notify' | 'success' | 'warning'
export type UiSoundGroup = ToastSoundGroup | 'toggle'

const TOAST_SOUND_GROUPS: Partial<Record<QsToastType, ToastSoundGroup>> = {
  error: 'error',
  info: 'notify',
  success: 'success',
  warning: 'warning',
}

export function resolveToastSound(type: QsToastType): ToastSoundGroup | null {
  return TOAST_SOUND_GROUPS[type] ?? null
}

export interface UiSoundGateOptions {
  minGapMs?: number
  now?: () => number
  repeatGapMs?: number
}

export interface UiSoundGate {
  tryAcquire: (group: UiSoundGroup) => boolean
}

/**
 * 提示音共享一个全局节流器：短时间内连续出现的提示只保留第一条。
 * 开关音不区分上下行，只受最小间隔约束，避免用户快速切换时被同类冷却吞掉。
 */
export function createUiSoundGate(
  options: UiSoundGateOptions = {},
): UiSoundGate {
  const now = options.now ?? Date.now
  const minGapMs = options.minGapMs ?? 150
  const repeatGapMs = options.repeatGapMs ?? 300
  let lastGroup: UiSoundGroup | null = null
  let lastPlayedAt = Number.NEGATIVE_INFINITY

  return {
    tryAcquire(group) {
      const playedAt = now()
      const elapsed = playedAt - lastPlayedAt
      if (elapsed < minGapMs) {
        return false
      }
      if (group !== 'toggle' && group === lastGroup && elapsed < repeatGapMs) {
        return false
      }

      lastGroup = group
      lastPlayedAt = playedAt
      return true
    },
  }
}

/**
 * FaSwitch 底层是 Reka SwitchRoot，状态更新前读取 aria-checked 即可得到旧值。
 * data-state 只作为缺少 aria-checked 时的兼容回退。
 */
export function resolveSwitchChecked(
  ariaChecked: string | null,
  dataState: string | null,
): boolean | null {
  if (ariaChecked === 'true' || ariaChecked === 'false') {
    return ariaChecked === 'true'
  }
  if (dataState === 'checked' || dataState === 'unchecked') {
    return dataState === 'checked'
  }
  return null
}

export function shouldPlayUiSound(
  visibilityState: string,
  hasFocus: boolean,
): boolean {
  return visibilityState === 'visible' && hasFocus
}
