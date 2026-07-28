import type { RegionLevel } from './types'

export type RegionSelectorRawAttrs = Readonly<Record<string, unknown>>

export interface RegionSelectorAttrGroups {
  /**
   * 布局、测试标记和复合控件级可访问名称保留在 wrapper。
   */
  readonly wrapperAttrs: Readonly<Record<string, unknown>>
  /**
   * ID、tabindex 与状态型 ARIA 由 bridge 写入三个 FaSelect trigger。
   */
  readonly controlAttrs: Readonly<Record<string, unknown>>
  /**
   * 原生表单属性只落到组件私有 proxy input；`name` 继续提交 CITY UUID。
   */
  readonly formAttrs: Readonly<Record<string, unknown>>
}

export interface RegionSelectorControlIds {
  readonly COUNTRY_REGION: string
  readonly PROVINCE_STATE: string
  readonly CITY: string
}

export interface RegionSelectorControlBridgeUpdate {
  readonly attrs: RegionSelectorRawAttrs
  readonly busy: Readonly<Record<RegionLevel, boolean>>
  readonly controlIds: RegionSelectorControlIds
  readonly describedBy?: readonly (null | string | undefined)[]
  readonly invalid: boolean
  readonly readonly: boolean
  /**
   * 传入 QsRegionSelector 自己的局部 wrapper，不接受 document 等全局查询根。
   * `null` 仅用于组件尚未挂载或正在卸载的阶段。
   */
  readonly root: HTMLElement | null
}

export interface RegionSelectorControlBridge {
  readonly blur: () => void
  readonly dispose: () => void
  readonly focus: (level?: RegionLevel) => void
  readonly update: (state: RegionSelectorControlBridgeUpdate) => void
}

const CONTROL_ATTR_NAMES = new Set([
  'id',
  'tabindex',
])

const CONTROL_ARIA_ATTR_NAMES = new Set([
  'aria-describedby',
  'aria-invalid',
  'aria-required',
])

const FORM_ATTR_NAMES = new Set([
  'form',
  'name',
  'required',
])

const TRIGGER_SELECTORS: Readonly<Record<RegionLevel, string>> = Object.freeze({
  COUNTRY_REGION:
    '[data-region-level="COUNTRY_REGION"] [data-slot="select-trigger"]',
  PROVINCE_STATE:
    '[data-region-level="PROVINCE_STATE"] [data-slot="select-trigger"]',
  CITY:
    '[data-region-level="CITY"] [data-slot="select-trigger"]',
})

const READONLY_SELECTOR = '[data-slot="qs-region-selector-readonly"]'
const LEVELS = Object.freeze([
  'COUNTRY_REGION',
  'PROVINCE_STATE',
  'CITY',
] as const)

function createAttributeRecord(): Record<string, unknown> {
  // 无原型记录可避免 `__proto__` 等特殊名称污染 v-bind 的属性容器。
  return Object.create(null) as Record<string, unknown>
}

function isAriaAttribute(name: string): boolean {
  return /^aria-[a-z][a-z0-9-]*$/u.test(name)
}

function isDataAttribute(name: string): boolean {
  return /^data-[a-z][a-z0-9_.:-]*$/u.test(name)
}

/**
 * Vue 的 `$attrs` 仍可能包含事件、未知 HTML 属性或内核私有参数。
 * 这里显式分组，确保只有已确认的公共 attrs 能穿过组件边界。
 */
export function splitRegionSelectorAttrs(
  attrs: RegionSelectorRawAttrs,
): RegionSelectorAttrGroups {
  const wrapperAttrs = createAttributeRecord()
  const controlAttrs = createAttributeRecord()
  const formAttrs = createAttributeRecord()

  for (const [name, value] of Object.entries(attrs)) {
    if (
      name === 'class'
      || name === 'style'
      || isDataAttribute(name)
      || (
        isAriaAttribute(name)
        && !CONTROL_ARIA_ATTR_NAMES.has(name)
      )
    ) {
      wrapperAttrs[name] = value
      continue
    }

    if (
      CONTROL_ATTR_NAMES.has(name)
      || CONTROL_ARIA_ATTR_NAMES.has(name)
    ) {
      controlAttrs[name] = value
      continue
    }

    if (FORM_ATTR_NAMES.has(name)) {
      formAttrs[name] = value
    }
  }

  return {
    controlAttrs,
    formAttrs,
    wrapperAttrs,
  }
}

function normalizeTextAttribute(value: unknown): null | string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }
  return null
}

function hasBooleanAttribute(value: unknown): boolean {
  return value !== false && value !== null && value !== undefined
}

function isAriaTrue(value: unknown): boolean {
  return value === true
    || value === ''
    || (typeof value === 'string' && value.toLowerCase() === 'true')
}

function mergeDescribedBy(
  callerValue: unknown,
  internalValues: readonly (null | string | undefined)[],
): null | string {
  const tokens: string[] = []
  const seen = new Set<string>()

  function append(value: unknown) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return
    }
    for (const token of String(value).split(/\s+/u)) {
      if (token && !seen.has(token)) {
        seen.add(token)
        tokens.push(token)
      }
    }
  }

  append(callerValue)
  for (const value of internalValues) {
    append(value)
  }

  return tokens.length > 0 ? tokens.join(' ') : null
}

function setManagedAttribute(
  element: HTMLElement,
  name: string,
  value: null | string,
) {
  if (value === null) {
    element.removeAttribute(name)
  }
  else {
    element.setAttribute(name, value)
  }
}

function isButton(element: Element | null): element is HTMLButtonElement {
  return element !== null
    && String(element.tagName).toUpperCase() === 'BUTTON'
}

function isHTMLElement(value: unknown): value is HTMLElement {
  return typeof value === 'object'
    && value !== null
    && 'setAttribute' in value
    && 'removeAttribute' in value
    && 'focus' in value
}

/**
 * 精确解析组件局部的三个 FaSelect trigger。
 *
 * `data-region-level` 由 QsRegionSelector 自己渲染，`data-slot=select-trigger`
 * 来自受控 FaSelect。任一级缺失或重复都立即失败，避免升级后静默把 ARIA 写错控件。
 */
function resolveLocalTriggers(
  root: HTMLElement,
): Readonly<Record<RegionLevel, HTMLButtonElement>> {
  const triggers = createAttributeRecord() as Record<
    RegionLevel,
    HTMLButtonElement
  >

  for (const level of LEVELS) {
    const matches = root.querySelectorAll(TRIGGER_SELECTORS[level])
    const trigger = matches[0] ?? null
    if (matches.length !== 1 || !isButton(trigger)) {
      throw new Error(
        'QsRegionSelector 必须包含三个 FaSelect trigger，且每一级只能有一个',
      )
    }
    triggers[level] = trigger
  }

  return triggers
}

const MANAGED_TRIGGER_ATTRS = Object.freeze([
  'aria-busy',
  'aria-describedby',
  'aria-invalid',
  'aria-required',
  'id',
  'tabindex',
])

function cleanTrigger(trigger: HTMLElement): void {
  for (const name of MANAGED_TRIGGER_ATTRS) {
    trigger.removeAttribute(name)
  }
}

export function createRegionSelectorControlBridge(): RegionSelectorControlBridge {
  let currentTargets: Partial<Record<RegionLevel, HTMLElement>> = {}
  let currentReadonlyTarget: HTMLElement | null = null
  let lastFocusedTarget: HTMLElement | null = null
  let disposed = false

  const rememberFocusedTarget = (event: Event) => {
    if (isHTMLElement(event.currentTarget)) {
      lastFocusedTarget = event.currentTarget
    }
  }

  function detachTargets(): void {
    for (const target of Object.values(currentTargets)) {
      target?.removeEventListener('focus', rememberFocusedTarget)
      if (target) {
        cleanTrigger(target)
      }
    }
    currentReadonlyTarget?.removeEventListener(
      'focus',
      rememberFocusedTarget,
    )
    currentTargets = {}
    currentReadonlyTarget = null
    lastFocusedTarget = null
  }

  function update(state: RegionSelectorControlBridgeUpdate): void {
    if (disposed) {
      throw new Error('QsRegionSelector control bridge 已销毁')
    }

    // loading、错误和 attrs 变化会在同一批 DOM trigger 上重复执行 update。
    // 只有焦点目标确实被替换时才清空，保证公开 blur() 不因状态同步失效。
    const previousFocusedTarget = lastFocusedTarget
    detachTargets()
    if (!state.root) {
      return
    }

    const { controlAttrs, formAttrs } = splitRegionSelectorAttrs(state.attrs)
    const required = hasBooleanAttribute(formAttrs.required)
      || isAriaTrue(controlAttrs['aria-required'])
    const invalid = state.invalid
      || isAriaTrue(controlAttrs['aria-invalid'])
    const describedBy = mergeDescribedBy(
      controlAttrs['aria-describedby'],
      state.describedBy ?? [],
    )

    if (state.readonly) {
      const readonlyTarget = state.root.querySelector(READONLY_SELECTOR)
      if (!isHTMLElement(readonlyTarget)) {
        throw new Error('QsRegionSelector readonly target 不存在')
      }
      currentReadonlyTarget = readonlyTarget
      currentReadonlyTarget.addEventListener('focus', rememberFocusedTarget)
      if (previousFocusedTarget === currentReadonlyTarget) {
        lastFocusedTarget = previousFocusedTarget
      }
      setManagedAttribute(
        currentReadonlyTarget,
        'id',
        state.controlIds.COUNTRY_REGION,
      )
      setManagedAttribute(
        currentReadonlyTarget,
        'aria-describedby',
        describedBy,
      )
      setManagedAttribute(
        currentReadonlyTarget,
        'aria-invalid',
        String(invalid),
      )
      setManagedAttribute(
        currentReadonlyTarget,
        'aria-required',
        required ? 'true' : null,
      )
      setManagedAttribute(
        currentReadonlyTarget,
        'tabindex',
        normalizeTextAttribute(controlAttrs.tabindex) ?? '0',
      )
      return
    }

    const triggers = resolveLocalTriggers(state.root)
    const triggerTargets: readonly HTMLElement[] = Object.values(triggers)
    currentTargets = triggers
    if (
      previousFocusedTarget
      && triggerTargets.includes(previousFocusedTarget)
    ) {
      lastFocusedTarget = previousFocusedTarget
    }
    for (const level of LEVELS) {
      const trigger = triggers[level]
      trigger.addEventListener('focus', rememberFocusedTarget)
      setManagedAttribute(trigger, 'id', state.controlIds[level])
      setManagedAttribute(trigger, 'aria-describedby', describedBy)
      setManagedAttribute(
        trigger,
        'aria-busy',
        String(state.busy[level]),
      )
      setManagedAttribute(trigger, 'aria-invalid', String(invalid))
      setManagedAttribute(
        trigger,
        'aria-required',
        required ? 'true' : null,
      )
      setManagedAttribute(
        trigger,
        'tabindex',
        level === 'COUNTRY_REGION'
          ? normalizeTextAttribute(controlAttrs.tabindex)
          : null,
      )
    }
  }

  function dispose(): void {
    if (disposed) {
      return
    }
    disposed = true
    detachTargets()
  }

  return {
    blur: () => {
      lastFocusedTarget?.blur()
    },
    dispose,
    focus: (level = 'COUNTRY_REGION') => {
      if (currentReadonlyTarget) {
        currentReadonlyTarget.focus()
        return
      }
      currentTargets[level]?.focus()
    },
    update,
  }
}
