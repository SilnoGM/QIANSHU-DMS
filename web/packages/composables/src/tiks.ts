import type { ThemeName, TiksOptions, TiksTheme } from '@rexa-developer/tiks'
import { TiksEngine } from '@rexa-developer/tiks'

interface TiksSounds {
  click: () => void
  toggle: (on: boolean) => void
  success: () => void
  error: () => void
  warning: () => void
  hover: () => void
  pop: () => void
  swoosh: () => void
  notify: () => void
}

interface UseTiksReturn extends TiksSounds {
  init: (options?: TiksOptions) => void
  mute: () => void
  unmute: () => void
  setVolume: (volume: number) => void
  setTheme: (theme: ThemeName | TiksTheme) => void
}

function canUseTiks() {
  return typeof window !== 'undefined' && typeof AudioContext !== 'undefined'
}

export function useTiks(options?: TiksOptions): UseTiksReturn {
  const engine = new TiksEngine()
  let initialized = false

  function initialize(nextOptions?: TiksOptions) {
    if (!canUseTiks()) {
      return false
    }
    engine.init(nextOptions ?? options)
    initialized = true
    return true
  }

  function init(nextOptions?: TiksOptions) {
    initialize(nextOptions)
  }

  function ensureInit() {
    return initialized || initialize()
  }

  function click() {
    if (!ensureInit()) {
      return
    }
    engine.click()
  }

  function toggle(on: boolean) {
    if (!ensureInit()) {
      return
    }
    engine.toggle(on)
  }

  function success() {
    if (!ensureInit()) {
      return
    }
    engine.success()
  }

  function error() {
    if (!ensureInit()) {
      return
    }
    engine.error()
  }

  function warning() {
    if (!ensureInit()) {
      return
    }
    engine.warning()
  }

  function hover() {
    if (!ensureInit()) {
      return
    }
    engine.hover()
  }

  function pop() {
    if (!ensureInit()) {
      return
    }
    engine.pop()
  }

  function swoosh() {
    if (!ensureInit()) {
      return
    }
    engine.swoosh()
  }

  function notify() {
    if (!ensureInit()) {
      return
    }
    engine.notify()
  }

  function mute() {
    if (!ensureInit()) {
      return
    }
    engine.mute()
  }

  function unmute() {
    if (!ensureInit()) {
      return
    }
    engine.unmute()
  }

  function setVolume(volume: number) {
    if (!ensureInit()) {
      return
    }
    engine.setVolume(volume)
  }

  function setTheme(theme: ThemeName | TiksTheme) {
    if (!ensureInit()) {
      return
    }
    engine.setTheme(theme)
  }

  initialize(options)

  return {
    init,
    click,
    toggle,
    success,
    error,
    warning,
    hover,
    pop,
    swoosh,
    notify,
    mute,
    unmute,
    setVolume,
    setTheme,
  }
}
