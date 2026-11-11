import type { ToastSoundGroup } from './ui-sound.logic'
import type { QsToastType } from '@/components/base/QsToast/types'
import { useTiks } from '@fantastic-admin/composables'
import { ref } from 'vue'
import {
  createUiSoundGate,
  resolveSwitchChecked,
  resolveToastSound,
  shouldPlayUiSound,
} from './ui-sound.logic'

const UI_SOUND_STORAGE_KEY = 'uiSoundEnabled'

const tiks = useTiks({
  respectReducedMotion: true,
  theme: 'soft',
  volume: 0.3,
})
const soundGate = createUiSoundGate()
const soundEnabled = ref(true)

let preferenceLoaded = false
let listenersInstalled = false

function readPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(UI_SOUND_STORAGE_KEY) !== '0'
  }
  catch {
    // 浏览器禁用存储时按默认开启处理，不影响当前会话。
    return true
  }
}

function persistPreference(enabled: boolean): void {
  try {
    localStorage.setItem(UI_SOUND_STORAGE_KEY, enabled ? '1' : '0')
  }
  catch {
    // 存储失败只影响下次进入页面是否记住开关状态。
  }
}

function applyPreference(enabled: boolean): void {
  soundEnabled.value = enabled
  if (enabled) {
    tiks.unmute()
  }
  else {
    tiks.mute()
  }
}

function ensurePreference(): void {
  if (preferenceLoaded) {
    return
  }
  preferenceLoaded = true
  applyPreference(readPreference())
}

function canPlayNow(): boolean {
  if (typeof document === 'undefined') {
    return false
  }
  return shouldPlayUiSound(document.visibilityState, document.hasFocus())
}

function playGroup(group: ToastSoundGroup): void {
  ensurePreference()
  if (!soundEnabled.value || !canPlayNow() || !soundGate.tryAcquire(group)) {
    return
  }

  try {
    switch (group) {
      case 'error':
        tiks.error()
        break
      case 'notify':
        tiks.notify()
        break
      case 'success':
        tiks.success()
        break
      case 'warning':
        tiks.warning()
        break
    }
  }
  catch {
    // 音效是增强反馈，失败不得影响提示队列和业务动作。
  }
}

/**
 * QsToast 的唯一音效入口。loading/default 不发声，异步任务只播放最终结果音。
 */
export function playToastSound(type: QsToastType): void {
  const group = resolveToastSound(type)
  if (group !== null) {
    playGroup(group)
  }
}

export function playToggleSound(checked: boolean): void {
  ensurePreference()
  if (!soundEnabled.value || !canPlayNow() || !soundGate.tryAcquire('toggle')) {
    return
  }
  try {
    tiks.toggle(checked)
  }
  catch {
    // 音效是增强反馈，失败不得影响开关自身状态。
  }
}

export function setUiSoundEnabled(enabled: boolean): void {
  preferenceLoaded = true
  applyPreference(enabled)
  persistPreference(enabled)
}

export function useUiSound() {
  ensurePreference()
  return {
    enabled: soundEnabled,
    setEnabled: setUiSoundEnabled,
  }
}

function resolveSwitchFromEvent(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null
  }
  const element = target.closest<HTMLElement>('[role="switch"]')
  if (element === null || element.getAttribute('aria-disabled') === 'true') {
    return null
  }
  if (element instanceof HTMLButtonElement && element.disabled) {
    return null
  }
  return element
}

/**
 * 在 capture 阶段读取切换前状态：FaSwitch 自身的 click 尚未执行，可稳定取得旧值。
 * Space 走原生 click，不额外监听 keydown，避免一次切换播放两次。
 */
function handleSwitchClick(event: MouseEvent): void {
  const element = resolveSwitchFromEvent(event.target)
  if (element === null) {
    return
  }
  const checked = resolveSwitchChecked(
    element.getAttribute('aria-checked'),
    element.getAttribute('data-state'),
  )
  if (checked !== null) {
    playToggleSound(!checked)
  }
}

function handleSwitchKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.repeat) {
    return
  }
  const element = resolveSwitchFromEvent(event.target)
  if (element === null) {
    return
  }
  const checked = resolveSwitchChecked(
    element.getAttribute('aria-checked'),
    element.getAttribute('data-state'),
  )
  if (checked !== null) {
    playToggleSound(!checked)
  }
}

function handleStorage(event: StorageEvent): void {
  if (event.key !== null && !event.key.endsWith(UI_SOUND_STORAGE_KEY)) {
    return
  }
  preferenceLoaded = true
  applyPreference(event.newValue !== '0')
}

export function installUiSound(): () => void {
  if (typeof document === 'undefined' || listenersInstalled) {
    return () => {}
  }

  ensurePreference()
  listenersInstalled = true
  document.addEventListener('click', handleSwitchClick, true)
  document.addEventListener('keydown', handleSwitchKeydown, true)
  window.addEventListener('storage', handleStorage)

  return () => {
    listenersInstalled = false
    document.removeEventListener('click', handleSwitchClick, true)
    document.removeEventListener('keydown', handleSwitchKeydown, true)
    window.removeEventListener('storage', handleStorage)
  }
}
