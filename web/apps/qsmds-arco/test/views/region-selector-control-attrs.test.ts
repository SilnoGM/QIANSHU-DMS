import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 真实控件 bridge 使用无浏览器依赖的 DOM 契约桩验证。
import test from 'node:test'

import {
  createRegionSelectorControlBridge,
  splitRegionSelectorAttrs,
} from '../../src/components/business/QsRegionSelector/control-attrs'

class FakeElement extends EventTarget {
  readonly attributes = new Map<string, string>()

  constructor(readonly tagName: string) {
    super()
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value))
  }
}

class FakeForm extends EventTarget {}

class FakeInput extends FakeElement {
  blurCount = 0
  customValidity = ''
  focusCount = 0
  form: FakeForm | null = null
  value = ''

  constructor() {
    super('INPUT')
  }

  blur(): void {
    this.blurCount += 1
    this.dispatchEvent(new Event('blur'))
  }

  focus(): void {
    this.focusCount += 1
    this.dispatchEvent(new Event('focus'))
  }

  setCustomValidity(message: string): void {
    this.customValidity = message
  }
}

class FakeRoot {
  queryCount = 0

  constructor(readonly inputs: FakeInput[]) {}

  querySelectorAll(selector: string): FakeInput[] {
    assert.equal(selector, 'input')
    this.queryCount += 1
    return this.inputs
  }
}

function asElement(value: FakeElement): HTMLElement {
  return value as unknown as HTMLElement
}

function asRoot(value: FakeRoot): HTMLElement {
  return value as unknown as HTMLElement
}

function createFormDataEvent(): Event & { formData: FormData } {
  const event = new Event('formdata')
  Object.defineProperty(event, 'formData', {
    configurable: false,
    enumerable: true,
    value: new FormData(),
  })
  return event as Event & { formData: FormData }
}

function createKeyboardEvent(key: string): KeyboardEvent {
  const event = new Event('keydown', {
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, 'key', {
    configurable: false,
    enumerable: true,
    value: key,
  })
  return event as KeyboardEvent
}

const baseState = {
  busy: false,
  describedBy: [] as string[],
  expanded: false,
  hasValidCitySelection: false,
  invalid: false,
  modelValue: null,
  readonly: false,
}

test('attrs 只把布局与测试标记交给 wrapper，把真实控件白名单交给 input', () => {
  const style = { minWidth: 0 }
  const groups = splitRegionSelectorAttrs({
    'aria-describedby': 'caller-help',
    'aria-label': '收货城市',
    'autocomplete': 'address-level2',
    'class': ['w-full', 'min-w-0'],
    'data-testid': 'region-selector',
    'id': 'shipping-region',
    'name': 'cityId',
    'onClick': () => {},
    'required': true,
    'style': style,
    'tabindex': 3,
    'title': '不得透传',
  })

  assert.deepEqual({ ...groups.wrapperAttrs }, {
    'class': ['w-full', 'min-w-0'],
    'data-testid': 'region-selector',
    'style': style,
  })
  assert.deepEqual({ ...groups.controlAttrs }, {
    'aria-describedby': 'caller-help',
    'aria-label': '收货城市',
    'autocomplete': 'address-level2',
    'id': 'shipping-region',
    'name': 'cityId',
    'required': true,
    'tabindex': 3,
  })
  assert.equal(Object.getPrototypeOf(groups.wrapperAttrs), null)
  assert.equal(Object.getPrototypeOf(groups.controlAttrs), null)
})

test('bridge 只从局部 root 获取精确一个真实 INPUT，上游 DOM 漂移时立即失败', () => {
  const bridge = createRegionSelectorControlBridge()

  assert.throws(
    () => bridge.update({
      ...baseState,
      attrs: {},
      clearControl: null,
      root: asRoot(new FakeRoot([])),
    }),
    /必须包含且仅包含一个真实 input/u,
  )
  assert.throws(
    () => bridge.update({
      ...baseState,
      attrs: {},
      clearControl: null,
      root: asRoot(new FakeRoot([new FakeInput(), new FakeInput()])),
    }),
    /必须包含且仅包含一个真实 input/u,
  )

  const source = readFileSync(
    new URL(
      '../../src/components/business/QsRegionSelector/control-attrs.ts',
      import.meta.url,
    ),
    'utf8',
  )
  assert.doesNotMatch(source, /document\.(?:querySelector|getElementById)/u)
})

test('真实 input 同步白名单与 combobox 状态，更新时清理已移除属性', () => {
  const input = new FakeInput()
  input.value = '搜索草稿不能代替城市'
  const root = new FakeRoot([input])
  const bridge = createRegionSelectorControlBridge()

  bridge.update({
    attrs: {
      'aria-controls': 'region-menu',
      'aria-describedby': 'caller-help shared-status',
      'aria-label': '收货城市',
      'autocomplete': 'address-level2',
      'class': 'wrapper-only',
      'data-testid': 'wrapper-only',
      'id': 'shipping-region',
      'name': 'cityId',
      'required': '',
      'style': { width: '100%' },
      'tabindex': 2,
      'title': 'drop-me',
    },
    busy: true,
    clearControl: null,
    describedBy: ['loading-status', 'shared-status', 'error-status'],
    expanded: true,
    invalid: false,
    modelValue: null,
    readonly: true,
    root: asRoot(root),
  })

  assert.deepEqual(
    Object.fromEntries(input.attributes),
    {
      'aria-busy': 'true',
      'aria-controls': 'region-menu',
      'aria-describedby':
        'caller-help shared-status loading-status error-status',
      'aria-expanded': 'true',
      'aria-haspopup': 'menu',
      'aria-invalid': 'false',
      'aria-label': '收货城市',
      'aria-readonly': 'true',
      'aria-required': 'true',
      'autocomplete': 'address-level2',
      'id': 'shipping-region',
      'name': 'cityId',
      'required': '',
      'role': 'combobox',
      'tabindex': '2',
    },
  )
  assert.equal(input.customValidity, '请选择地区')
  assert.equal(input.hasAttribute('class'), false)
  assert.equal(input.hasAttribute('data-testid'), false)
  assert.equal(input.hasAttribute('style'), false)
  assert.equal(input.hasAttribute('title'), false)

  bridge.update({
    attrs: {
      'aria-describedby': 'replacement-help',
      'required': true,
    },
    busy: false,
    clearControl: null,
    describedBy: ['ready-status'],
    expanded: false,
    hasValidCitySelection: true,
    invalid: true,
    modelValue: '78f9134e-3d72-5f6e-9897-ca7e50004229',
    readonly: false,
    root: asRoot(root),
  })

  assert.deepEqual(
    Object.fromEntries(input.attributes),
    {
      'aria-busy': 'false',
      'aria-describedby': 'replacement-help ready-status',
      'aria-expanded': 'false',
      'aria-haspopup': 'menu',
      'aria-invalid': 'true',
      'aria-readonly': 'false',
      'aria-required': 'true',
      'role': 'combobox',
    },
  )
  assert.equal(input.customValidity, '')

  bridge.update({
    ...baseState,
    attrs: {},
    clearControl: null,
    root: asRoot(root),
  })
  assert.equal(input.hasAttribute('aria-required'), false)
  assert.equal(input.customValidity, '')
})

test('调用方 aria-invalid=true 会并入最终错误态，内部状态不允许被 false 覆盖', () => {
  const input = new FakeInput()
  const root = asRoot(new FakeRoot([input]))
  const bridge = createRegionSelectorControlBridge()

  bridge.update({
    ...baseState,
    attrs: { 'aria-invalid': 'true' },
    clearControl: null,
    root,
  })
  assert.equal(input.getAttribute('aria-invalid'), 'true')

  bridge.update({
    ...baseState,
    attrs: { 'aria-invalid': 'false' },
    clearControl: null,
    invalid: true,
    root,
  })
  assert.equal(input.getAttribute('aria-invalid'), 'true')
})

test('required 只认可最终 CITY value，FormData 始终覆盖为 city UUID 而非搜索词', () => {
  const form = new FakeForm()
  const input = new FakeInput()
  input.form = form
  input.value = '高雄'
  const root = asRoot(new FakeRoot([input]))
  const bridge = createRegionSelectorControlBridge()

  bridge.update({
    ...baseState,
    attrs: { name: 'cityId', required: true },
    clearControl: null,
    root,
  })
  assert.equal(input.hasAttribute('required'), true)
  assert.equal(input.customValidity, '请选择地区')

  const emptyEvent = createFormDataEvent()
  form.dispatchEvent(emptyEvent)
  assert.equal(emptyEvent.formData.get('cityId'), '')

  const cityId = '78f9134e-3d72-5f6e-9897-ca7e50004229'
  bridge.update({
    ...baseState,
    attrs: { name: 'cityId', required: true },
    clearControl: null,
    hasValidCitySelection: true,
    modelValue: cityId,
    root,
  })
  assert.equal(input.hasAttribute('required'), false)
  assert.equal(input.customValidity, '')

  const selectedEvent = createFormDataEvent()
  selectedEvent.formData.set('cityId', 'search-draft')
  form.dispatchEvent(selectedEvent)
  assert.equal(selectedEvent.formData.get('cityId'), cityId)

  bridge.update({
    ...baseState,
    attrs: { name: 'deliveryCityId' },
    clearControl: null,
    hasValidCitySelection: true,
    modelValue: cityId,
    root,
  })
  const renamedEvent = createFormDataEvent()
  form.dispatchEvent(renamedEvent)
  assert.equal(renamedEvent.formData.get('cityId'), null)
  assert.equal(renamedEvent.formData.get('deliveryCityId'), cityId)

  bridge.update({
    ...baseState,
    attrs: {},
    clearControl: null,
    hasValidCitySelection: true,
    modelValue: cityId,
    root,
  })
  const unnamedEvent = createFormDataEvent()
  form.dispatchEvent(unnamedEvent)
  assert.equal([...unnamedEvent.formData.entries()].length, 0)
})

test('raw 历史 UUID 在回显确认前继续写入 FormData，但 required 仍保持无效', () => {
  const form = new FakeForm()
  const input = new FakeInput()
  input.form = form
  const root = asRoot(new FakeRoot([input]))
  const bridge = createRegionSelectorControlBridge()
  const rawCityId = '78f9134e-3d72-5f6e-9897-ca7e50004229'

  bridge.update({
    ...baseState,
    attrs: { name: 'cityId' },
    clearControl: null,
    modelValue: rawCityId,
    root,
  })
  const optionalEvent = createFormDataEvent()
  form.dispatchEvent(optionalEvent)
  assert.equal(optionalEvent.formData.get('cityId'), rawCityId)
  assert.equal(input.hasAttribute('required'), false)
  assert.equal(input.customValidity, '')

  bridge.update({
    ...baseState,
    attrs: { name: 'cityId', required: true },
    clearControl: null,
    modelValue: rawCityId,
    root,
  })
  const requiredEvent = createFormDataEvent()
  form.dispatchEvent(requiredEvent)
  assert.equal(requiredEvent.formData.get('cityId'), rawCityId)
  assert.equal(input.hasAttribute('required'), true)
  assert.equal(input.customValidity, '请选择地区')

  bridge.dispose()
})

test('focus/blur 操作真实 input，重复 update 不重复监听，切换与 dispose 会完整清理', () => {
  const firstInput = new FakeInput()
  const secondInput = new FakeInput()
  let focusCount = 0
  let blurCount = 0
  const bridge = createRegionSelectorControlBridge({
    onBlur: () => {
      blurCount += 1
    },
    onFocus: () => {
      focusCount += 1
    },
  })

  const firstUpdate = {
    ...baseState,
    attrs: { id: 'first-control' },
    clearControl: null,
    root: asRoot(new FakeRoot([firstInput])),
  }
  bridge.update(firstUpdate)
  bridge.update(firstUpdate)
  bridge.focus()
  bridge.blur()
  assert.deepEqual(
    {
      blurCount,
      inputBlurCount: firstInput.blurCount,
      inputFocusCount: firstInput.focusCount,
      focusCount,
    },
    {
      blurCount: 1,
      inputBlurCount: 1,
      inputFocusCount: 1,
      focusCount: 1,
    },
  )

  bridge.update({
    ...baseState,
    attrs: { id: 'second-control' },
    clearControl: null,
    root: asRoot(new FakeRoot([secondInput])),
  })
  assert.equal(firstInput.hasAttribute('id'), false)
  firstInput.dispatchEvent(new Event('focus'))
  assert.equal(focusCount, 1)
  secondInput.dispatchEvent(new Event('focus'))
  assert.equal(focusCount, 2)

  bridge.dispose()
  assert.equal(secondInput.hasAttribute('id'), false)
  assert.equal(secondInput.hasAttribute('role'), false)
  secondInput.dispatchEvent(new Event('blur'))
  assert.equal(blurCount, 1)
  bridge.focus()
  bridge.blur()
  assert.equal(secondInput.focusCount, 0)
  assert.equal(secondInput.blurCount, 0)
})

test('局部 clear span 具备按钮语义，点击、Enter 与 Space 清空且切换后无残留', () => {
  const input = new FakeInput()
  const root = asRoot(new FakeRoot([input]))
  const firstClear = new FakeElement('SPAN')
  const secondClear = new FakeElement('SPAN')
  let clearCount = 0
  const bridge = createRegionSelectorControlBridge({
    onClear: () => {
      clearCount += 1
    },
  })

  const firstUpdate = {
    ...baseState,
    attrs: {},
    clearControl: asElement(firstClear),
    root,
  }
  bridge.update(firstUpdate)
  bridge.update(firstUpdate)
  assert.deepEqual(Object.fromEntries(firstClear.attributes), {
    'aria-label': '清空地区选择',
    'role': 'button',
    'tabindex': '0',
  })

  const click = new Event('click', { bubbles: true, cancelable: true })
  firstClear.dispatchEvent(click)
  assert.equal(click.defaultPrevented, true)
  assert.equal(clearCount, 1)

  const enter = createKeyboardEvent('Enter')
  firstClear.dispatchEvent(enter)
  assert.equal(enter.defaultPrevented, true)
  assert.equal(clearCount, 2)

  const space = createKeyboardEvent(' ')
  firstClear.dispatchEvent(space)
  assert.equal(space.defaultPrevented, true)
  assert.equal(clearCount, 3)

  const escape = createKeyboardEvent('Escape')
  firstClear.dispatchEvent(escape)
  assert.equal(escape.defaultPrevented, false)
  assert.equal(clearCount, 3)

  bridge.update({
    ...baseState,
    attrs: {},
    clearControl: asElement(secondClear),
    root,
  })
  assert.deepEqual(Object.fromEntries(firstClear.attributes), {})
  firstClear.dispatchEvent(new Event('click', { cancelable: true }))
  assert.equal(clearCount, 3)

  bridge.dispose()
  assert.deepEqual(Object.fromEntries(secondClear.attributes), {})
  secondClear.dispatchEvent(new Event('click', { cancelable: true }))
  assert.equal(clearCount, 3)
})

test('form、name 与 input 切换后旧 formdata listener 不再写入，dispose 也不残留', () => {
  const firstForm = new FakeForm()
  const secondForm = new FakeForm()
  const firstInput = new FakeInput()
  const secondInput = new FakeInput()
  firstInput.form = firstForm
  secondInput.form = secondForm
  const bridge = createRegionSelectorControlBridge()
  const cityId = 'a4b24ca9-0704-564b-9de7-9ee28300b958'

  bridge.update({
    ...baseState,
    attrs: { name: 'cityId' },
    clearControl: null,
    hasValidCitySelection: true,
    modelValue: cityId,
    root: asRoot(new FakeRoot([firstInput])),
  })
  bridge.update({
    ...baseState,
    attrs: { name: 'cityId' },
    clearControl: null,
    hasValidCitySelection: true,
    modelValue: cityId,
    root: asRoot(new FakeRoot([secondInput])),
  })

  const staleEvent = createFormDataEvent()
  firstForm.dispatchEvent(staleEvent)
  assert.equal(staleEvent.formData.get('cityId'), null)
  const activeEvent = createFormDataEvent()
  secondForm.dispatchEvent(activeEvent)
  assert.equal(activeEvent.formData.get('cityId'), cityId)

  bridge.dispose()
  const disposedEvent = createFormDataEvent()
  secondForm.dispatchEvent(disposedEvent)
  assert.equal(disposedEvent.formData.get('cityId'), null)
})
