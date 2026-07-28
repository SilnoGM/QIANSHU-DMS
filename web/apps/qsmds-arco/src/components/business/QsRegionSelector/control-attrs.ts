export type RegionSelectorRawAttrs = Readonly<Record<string, unknown>>

export interface RegionSelectorAttrGroups {
  /**
   * 只允许布局、样式与测试标记落到业务组件 wrapper。
   * 控件语义必须由 bridge 写入 Cascader 的真实 input。
   */
  readonly wrapperAttrs: Readonly<Record<string, unknown>>
  readonly controlAttrs: Readonly<Record<string, unknown>>
}

export interface RegionSelectorControlBridgeOptions {
  readonly onBlur?: (event: FocusEvent) => void
  readonly onClear?: () => void
  readonly onFocus?: (event: FocusEvent) => void
}

export interface RegionSelectorControlBridgeUpdate {
  readonly attrs: RegionSelectorRawAttrs
  readonly busy: boolean
  readonly clearControl: HTMLElement | null
  readonly describedBy?: readonly (null | string | undefined)[]
  readonly expanded: boolean
  /**
   * 仅由组件经过严格三级 path 校验后置为 true；不能从 raw modelValue 是否非空推导。
   */
  readonly hasValidCitySelection: boolean
  readonly invalid: boolean
  readonly modelValue: null | string
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
  readonly focus: () => void
  readonly update: (state: RegionSelectorControlBridgeUpdate) => void
}

const CONTROL_ATTR_NAMES = new Set([
  'autocomplete',
  'id',
  'name',
  'required',
  'tabindex',
])

const BRIDGE_ARIA_ATTR_NAMES = new Set([
  'aria-busy',
  'aria-describedby',
  'aria-expanded',
  'aria-haspopup',
  'aria-invalid',
  'aria-readonly',
  'aria-required',
])

const CLEAR_CONTROL_ATTRS = new Map([
  ['aria-label', '清空地区选择'],
  ['role', 'button'],
  ['tabindex', '0'],
])

const REQUIRED_VALIDITY_MESSAGE = '请选择地区'

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

  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class' || name === 'style' || isDataAttribute(name)) {
      wrapperAttrs[name] = value
      continue
    }

    if (CONTROL_ATTR_NAMES.has(name) || isAriaAttribute(name)) {
      controlAttrs[name] = value
    }
  }

  return {
    controlAttrs,
    wrapperAttrs,
  }
}

function normalizeTextAttribute(value: unknown): null | string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }
  return null
}

function normalizeAriaAttribute(value: unknown): null | string {
  if (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
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

function setOrDelete(
  attributes: Map<string, string>,
  name: string,
  value: null | string,
) {
  if (value === null) {
    attributes.delete(name)
  }
  else {
    attributes.set(name, value)
  }
}

function resolveLocalInput(root: HTMLElement | null): HTMLInputElement | null {
  if (root === null) {
    return null
  }

  const inputs = Array.from(root.querySelectorAll('input'))
  if (
    inputs.length !== 1
    || String(inputs[0]?.tagName).toUpperCase() !== 'INPUT'
  ) {
    throw new Error(
      'QsRegionSelector 的 Cascader root 必须包含且仅包含一个真实 input',
    )
  }

  return inputs[0]
}

/**
 * 对 ACascader@2.58 的真实 input 做版本受控桥接。
 *
 * Bridge 只持有调用方传入的局部 DOM 引用；当 Arco 内部结构变化而不再只有一个
 * input 时直接失败，使升级风险在测试阶段暴露，而不是静默把表单属性放错元素。
 */
export function createRegionSelectorControlBridge(
  options: RegionSelectorControlBridgeOptions = {},
): RegionSelectorControlBridge {
  let currentClearControl: HTMLElement | null = null
  let currentForm: HTMLFormElement | null = null
  let currentFormName: null | string = null
  let currentInput: HTMLInputElement | null = null
  let currentModelValue: null | string = null
  let disposed = false
  let managedInputAttrs = new Set<string>()

  const handleFocus = (event: Event) => {
    options.onFocus?.(event as FocusEvent)
  }

  const handleBlur = (event: Event) => {
    options.onBlur?.(event as FocusEvent)
  }

  const runClear = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    options.onClear?.()
  }

  const handleClearKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }
    runClear(event)
  }

  const handleFormData = (event: Event) => {
    const formData = (
      event as Event & { readonly formData?: Pick<FormData, 'set'> }
    ).formData
    if (!formData || currentFormName === null) {
      return
    }

    // Cascader input.value 是搜索草稿；原生表单必须提交稳定的 CITY UUID。
    formData.set(currentFormName, currentModelValue ?? '')
  }

  function detachFormListener() {
    currentForm?.removeEventListener('formdata', handleFormData)
    currentForm = null
    currentFormName = null
  }

  function syncFormListener(input: HTMLInputElement) {
    const nextForm = input.form
    const nextName = input.getAttribute('name')
    const usableName = nextName && nextName.length > 0 ? nextName : null

    if (currentForm === nextForm && currentFormName === usableName) {
      return
    }

    detachFormListener()
    if (nextForm && usableName) {
      currentForm = nextForm
      currentFormName = usableName
      currentForm.addEventListener('formdata', handleFormData)
    }
  }

  function cleanInput(input: HTMLInputElement) {
    input.removeEventListener('focus', handleFocus)
    input.removeEventListener('blur', handleBlur)
    for (const name of managedInputAttrs) {
      input.removeAttribute(name)
    }
    input.setCustomValidity('')
    managedInputAttrs = new Set()
  }

  function detachInput() {
    detachFormListener()
    if (currentInput) {
      cleanInput(currentInput)
    }
    currentInput = null
  }

  function attachInput(input: HTMLInputElement) {
    currentInput = input
    currentInput.addEventListener('focus', handleFocus)
    currentInput.addEventListener('blur', handleBlur)
  }

  function detachClearControl() {
    if (!currentClearControl) {
      return
    }
    currentClearControl.removeEventListener('click', runClear)
    currentClearControl.removeEventListener(
      'keydown',
      handleClearKeydown as EventListener,
    )
    for (const name of CLEAR_CONTROL_ATTRS.keys()) {
      currentClearControl.removeAttribute(name)
    }
    currentClearControl = null
  }

  function syncClearControl(nextClearControl: HTMLElement | null) {
    if (currentClearControl !== nextClearControl) {
      detachClearControl()
      if (nextClearControl) {
        currentClearControl = nextClearControl
        currentClearControl.addEventListener('click', runClear)
        currentClearControl.addEventListener(
          'keydown',
          handleClearKeydown as EventListener,
        )
      }
    }

    if (!currentClearControl) {
      return
    }
    for (const [name, value] of CLEAR_CONTROL_ATTRS) {
      currentClearControl.setAttribute(name, value)
    }
  }

  function syncInputAttributes(
    input: HTMLInputElement,
    state: RegionSelectorControlBridgeUpdate,
    controlAttrs: Readonly<Record<string, unknown>>,
  ) {
    const nextAttrs = new Map<string, string>()

    for (const [name, value] of Object.entries(controlAttrs)) {
      if (!isAriaAttribute(name) || BRIDGE_ARIA_ATTR_NAMES.has(name)) {
        continue
      }
      setOrDelete(nextAttrs, name, normalizeAriaAttribute(value))
    }

    for (const name of ['autocomplete', 'id', 'name', 'tabindex']) {
      setOrDelete(nextAttrs, name, normalizeTextAttribute(controlAttrs[name]))
    }

    const required = hasBooleanAttribute(controlAttrs.required)
    const hasSelectedCity = state.hasValidCitySelection
    const describedBy = mergeDescribedBy(
      controlAttrs['aria-describedby'],
      state.describedBy ?? [],
    )

    nextAttrs.set('role', 'combobox')
    nextAttrs.set('aria-haspopup', 'menu')
    nextAttrs.set('aria-expanded', String(state.expanded))
    nextAttrs.set('aria-busy', String(state.busy))
    nextAttrs.set('aria-readonly', String(state.readonly))
    nextAttrs.set(
      'aria-invalid',
      String(state.invalid || isAriaTrue(controlAttrs['aria-invalid'])),
    )
    setOrDelete(nextAttrs, 'aria-describedby', describedBy)

    if (required) {
      nextAttrs.set('aria-required', 'true')
      if (!hasSelectedCity) {
        nextAttrs.set('required', '')
      }
    }
    else {
      setOrDelete(
        nextAttrs,
        'aria-required',
        normalizeAriaAttribute(controlAttrs['aria-required']),
      )
    }

    for (const name of managedInputAttrs) {
      if (!nextAttrs.has(name)) {
        input.removeAttribute(name)
      }
    }
    for (const [name, value] of nextAttrs) {
      input.setAttribute(name, value)
    }
    managedInputAttrs = new Set(nextAttrs.keys())

    input.setCustomValidity(
      required && !hasSelectedCity ? REQUIRED_VALIDITY_MESSAGE : '',
    )
  }

  function update(state: RegionSelectorControlBridgeUpdate) {
    if (disposed) {
      throw new Error('QsRegionSelector control bridge 已销毁')
    }

    const nextInput = resolveLocalInput(state.root)
    const { controlAttrs } = splitRegionSelectorAttrs(state.attrs)

    if (nextInput !== currentInput) {
      detachInput()
      if (nextInput) {
        attachInput(nextInput)
      }
    }

    currentModelValue = state.modelValue
    syncClearControl(state.clearControl)

    if (!currentInput) {
      return
    }

    syncInputAttributes(currentInput, state, controlAttrs)
    syncFormListener(currentInput)
  }

  function dispose() {
    if (disposed) {
      return
    }
    disposed = true
    detachClearControl()
    detachInput()
    currentModelValue = null
  }

  return {
    blur: () => currentInput?.blur(),
    dispose,
    focus: () => currentInput?.focus(),
    update,
  }
}
