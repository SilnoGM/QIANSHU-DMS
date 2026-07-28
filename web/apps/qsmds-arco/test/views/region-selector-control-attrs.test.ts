import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- bridge 通过无浏览器依赖的局部 DOM 契约桩验证。
import test from 'node:test'
import {
  createRegionSelectorControlBridge,
  splitRegionSelectorAttrs,
} from '../../src/components/business/QsRegionSelector/control-attrs'

const SELECTORS = {
  CITY: '[data-region-level="CITY"] [data-slot="select-trigger"]',
  COUNTRY_REGION:
    '[data-region-level="COUNTRY_REGION"] [data-slot="select-trigger"]',
  PROVINCE_STATE:
    '[data-region-level="PROVINCE_STATE"] [data-slot="select-trigger"]',
} as const

class FakeElement extends EventTarget {
  readonly attributes = new Map<string, string>()
  blurCount = 0
  focusCount = 0

  constructor(readonly tagName: string) {
    super()
  }

  blur(): void {
    this.blurCount += 1
  }

  focus(): void {
    this.focusCount += 1
    this.dispatchEvent(new Event('focus'))
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

class FakeRoot {
  readonly readonlyTarget = new FakeElement('DIV')

  constructor(
    readonly triggers: Partial<Record<keyof typeof SELECTORS, FakeElement[]>>,
  ) {}

  querySelector(selector: string): FakeElement | null {
    assert.equal(selector, '[data-slot="qs-region-selector-readonly"]')
    return this.readonlyTarget
  }

  querySelectorAll(selector: string): FakeElement[] {
    const level = Object.entries(SELECTORS).find(
      ([, candidate]) => candidate === selector,
    )?.[0] as keyof typeof SELECTORS | undefined
    assert.ok(level, `unexpected selector: ${selector}`)
    return this.triggers[level] ?? []
  }
}

function asRoot(root: FakeRoot): HTMLElement {
  return root as unknown as HTMLElement
}

function createTriggers() {
  return {
    CITY: new FakeElement('BUTTON'),
    COUNTRY_REGION: new FakeElement('BUTTON'),
    PROVINCE_STATE: new FakeElement('BUTTON'),
  }
}

function createState(root: FakeRoot) {
  return {
    attrs: {
      'aria-describedby': 'caller-help shared-status',
      'aria-invalid': false,
      'id': 'shipping-region',
      'name': 'shippingCityId',
      'required': true,
      'tabindex': 2,
    },
    busy: {
      CITY: false,
      COUNTRY_REGION: true,
      PROVINCE_STATE: false,
    },
    controlIds: {
      CITY: 'shipping-region-city',
      COUNTRY_REGION: 'shipping-region',
      PROVINCE_STATE: 'shipping-region-province-state',
    },
    describedBy: ['loading-status', 'shared-status'],
    invalid: false,
    readonly: false,
    root: asRoot(root),
  } as const
}

test('attrs 分流到 wrapper、三个 trigger 与原生 form proxy', () => {
  const style = { minWidth: 0 }
  const groups = splitRegionSelectorAttrs({
    'aria-describedby': 'caller-help',
    'aria-label': '收货地区',
    'autocomplete': '不得透传',
    'class': ['w-full'],
    'data-testid': 'region-selector',
    'form': 'shipping-form',
    'id': 'shipping-region',
    'name': 'shippingCityId',
    'onClick': () => {},
    'required': true,
    'style': style,
    'tabindex': 3,
    'title': '不得透传',
  })

  assert.deepEqual({ ...groups.wrapperAttrs }, {
    'aria-label': '收货地区',
    'class': ['w-full'],
    'data-testid': 'region-selector',
    'style': style,
  })
  assert.deepEqual({ ...groups.controlAttrs }, {
    'aria-describedby': 'caller-help',
    'id': 'shipping-region',
    'tabindex': 3,
  })
  assert.deepEqual({ ...groups.formAttrs }, {
    form: 'shipping-form',
    name: 'shippingCityId',
    required: true,
  })
  assert.equal(Object.getPrototypeOf(groups.wrapperAttrs), null)
  assert.equal(Object.getPrototypeOf(groups.controlAttrs), null)
  assert.equal(Object.getPrototypeOf(groups.formAttrs), null)
})

test('bridge 只从局部 root 精确解析三个 FaSelect trigger', () => {
  const bridge = createRegionSelectorControlBridge()
  const missing = new FakeRoot({
    CITY: [new FakeElement('BUTTON')],
    COUNTRY_REGION: [new FakeElement('BUTTON')],
  })
  assert.throws(
    () => bridge.update(createState(missing)),
    /必须包含三个 FaSelect trigger/u,
  )

  const duplicate = new FakeRoot({
    CITY: [new FakeElement('BUTTON')],
    COUNTRY_REGION: [
      new FakeElement('BUTTON'),
      new FakeElement('BUTTON'),
    ],
    PROVINCE_STATE: [new FakeElement('BUTTON')],
  })
  assert.throws(
    () => bridge.update(createState(duplicate)),
    /每一级只能有一个/u,
  )

  const wrongTag = new FakeRoot({
    CITY: [new FakeElement('BUTTON')],
    COUNTRY_REGION: [new FakeElement('INPUT')],
    PROVINCE_STATE: [new FakeElement('BUTTON')],
  })
  assert.throws(
    () => bridge.update(createState(wrongTag)),
    /必须包含三个 FaSelect trigger/u,
  )

  const source = readFileSync(
    new URL(
      '../../src/components/business/QsRegionSelector/control-attrs.ts',
      import.meta.url,
    ),
    'utf8',
  )
  assert.doesNotMatch(source, /document\.(?:querySelector|getElementById)/u)
  assert.doesNotMatch(source, /Cascader root|arco-select-view-clear-btn/u)
  assert.doesNotMatch(source, /formdata/u)
})

test('三个 trigger 获得独立 ID、共享状态且保留原生 label 与 Reka 弹层语义', () => {
  const triggers = createTriggers()
  for (const trigger of Object.values(triggers)) {
    trigger.setAttribute('aria-expanded', 'false')
    trigger.setAttribute('aria-haspopup', 'listbox')
  }
  const root = new FakeRoot({
    CITY: [triggers.CITY],
    COUNTRY_REGION: [triggers.COUNTRY_REGION],
    PROVINCE_STATE: [triggers.PROVINCE_STATE],
  })
  const bridge = createRegionSelectorControlBridge()
  bridge.update(createState(root))

  assert.deepEqual(Object.fromEntries(triggers.COUNTRY_REGION.attributes), {
    'aria-busy': 'true',
    'aria-describedby': 'caller-help shared-status loading-status',
    'aria-expanded': 'false',
    'aria-haspopup': 'listbox',
    'aria-invalid': 'false',
    'aria-required': 'true',
    'id': 'shipping-region',
    'tabindex': '2',
  })
  assert.deepEqual(Object.fromEntries(triggers.PROVINCE_STATE.attributes), {
    'aria-busy': 'false',
    'aria-describedby': 'caller-help shared-status loading-status',
    'aria-expanded': 'false',
    'aria-haspopup': 'listbox',
    'aria-invalid': 'false',
    'aria-required': 'true',
    'id': 'shipping-region-province-state',
  })
  assert.equal(triggers.CITY.getAttribute('id'), 'shipping-region-city')
  assert.equal(triggers.CITY.getAttribute('aria-labelledby'), null)
})

test('更新会清理旧受管属性，focus 可定位任一级且 dispose 无残留', () => {
  const first = createTriggers()
  const firstRoot = new FakeRoot({
    CITY: [first.CITY],
    COUNTRY_REGION: [first.COUNTRY_REGION],
    PROVINCE_STATE: [first.PROVINCE_STATE],
  })
  const bridge = createRegionSelectorControlBridge()
  bridge.update(createState(firstRoot))
  bridge.focus('PROVINCE_STATE')
  bridge.blur()
  assert.equal(first.PROVINCE_STATE.focusCount, 1)
  assert.equal(first.PROVINCE_STATE.blurCount, 1)

  const second = createTriggers()
  const secondRoot = new FakeRoot({
    CITY: [second.CITY],
    COUNTRY_REGION: [second.COUNTRY_REGION],
    PROVINCE_STATE: [second.PROVINCE_STATE],
  })
  bridge.update({
    ...createState(secondRoot),
    attrs: {},
    invalid: true,
  })

  assert.equal(first.COUNTRY_REGION.hasAttribute('id'), false)
  assert.equal(first.CITY.hasAttribute('aria-describedby'), false)
  assert.equal(second.COUNTRY_REGION.getAttribute('aria-invalid'), 'true')
  assert.equal(second.COUNTRY_REGION.hasAttribute('aria-required'), false)

  bridge.dispose()
  assert.equal(second.COUNTRY_REGION.hasAttribute('id'), false)
  assert.equal(second.CITY.hasAttribute('aria-invalid'), false)
  assert.throws(
    () => bridge.update(createState(secondRoot)),
    /control bridge 已销毁/u,
  )
})

test('同一 root 更新后 blur 仍作用于当前已聚焦 trigger', () => {
  const triggers = createTriggers()
  const root = new FakeRoot({
    CITY: [triggers.CITY],
    COUNTRY_REGION: [triggers.COUNTRY_REGION],
    PROVINCE_STATE: [triggers.PROVINCE_STATE],
  })
  const bridge = createRegionSelectorControlBridge()

  bridge.update(createState(root))
  bridge.focus('CITY')
  bridge.update({
    ...createState(root),
    busy: {
      CITY: true,
      COUNTRY_REGION: false,
      PROVINCE_STATE: false,
    },
  })
  bridge.blur()

  assert.equal(triggers.CITY.focusCount, 1)
  assert.equal(triggers.CITY.blurCount, 1)
})

test('readonly 使用唯一可聚焦 readout，不解析三个 trigger', () => {
  const root = new FakeRoot({})
  const bridge = createRegionSelectorControlBridge()
  bridge.update({
    ...createState(root),
    readonly: true,
  })

  assert.deepEqual(Object.fromEntries(root.readonlyTarget.attributes), {
    'aria-describedby': 'caller-help shared-status loading-status',
    'aria-invalid': 'false',
    'aria-required': 'true',
    'id': 'shipping-region',
    'tabindex': '2',
  })
  bridge.focus()
  bridge.blur()
  assert.equal(root.readonlyTarget.focusCount, 1)
  assert.equal(root.readonlyTarget.blurCount, 1)
})
