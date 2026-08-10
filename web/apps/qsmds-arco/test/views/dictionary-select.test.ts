import type { ComboboxProps } from '@fantastic-admin/components'
import type {
  DictionaryCatalog,
  DictionaryCatalogItem,
} from '../../src/dictionary-catalog/types'
import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- 字典选择纯逻辑不依赖浏览器，使用 Node runner 可快速固定契约。
import test from 'node:test'
import {
  buildDictionarySelectFormProxies,
  buildDictionarySelectOptions,
  filterDictionarySelectOption,
  fromDictionarySelectInnerValue,
  getDictionarySelectEmptyState,
  splitDictionarySelectAttrs,
  toDictionarySelectInnerValue,
} from '../../src/components/business/QsDictionarySelect/logic'

function item(input: Partial<DictionaryCatalogItem> & {
  label: string
  value: string
}): DictionaryCatalogItem {
  return Object.freeze({
    effectiveEnabled: true,
    enabled: true,
    sortOrder: 0,
    tone: 'DEFAULT',
    ...input,
  })
}

function catalog(
  items: readonly DictionaryCatalogItem[],
): DictionaryCatalog {
  return Object.freeze({
    code: 'workflow.status',
    enabled: true,
    items: Object.freeze([...items]),
    name: '流程状态',
  })
}

const pending = item({
  label: '处理中',
  sortOrder: 30,
  value: 'PENDING',
})
const ready = item({
  label: '同名状态',
  sortOrder: 10,
  value: 'READY',
})
const completed = item({
  label: '同名状态',
  sortOrder: 20,
  value: 'COMPLETED',
})
const archived = item({
  effectiveEnabled: false,
  enabled: false,
  label: '已归档',
  sortOrder: 40,
  value: 'ARCHIVED',
})

test('可信 Catalog 按 selectableItems 原序构造候选并在末尾解释历史值', () => {
  const currentCatalog = catalog([pending, ready, completed, archived])
  const selectableItems = [pending, ready, completed]

  assert.deepEqual(buildDictionarySelectOptions({
    catalog: currentCatalog,
    currentValue: 'ARCHIVED',
    loading: false,
    selectableItems,
  }), [
    { label: '处理中', value: 'PENDING' },
    { label: '同名状态', value: 'READY' },
    { label: '同名状态', value: 'COMPLETED' },
    { disabled: true, label: '已归档（已停用）', value: 'ARCHIVED' },
  ])

  assert.deepEqual(buildDictionarySelectOptions({
    catalog: currentCatalog,
    currentValue: 'LEGACY_RAW',
    loading: false,
    selectableItems,
  }).at(-1), {
    disabled: true,
    label: 'LEGACY_RAW（未知字典值）',
    value: 'LEGACY_RAW',
  })

  const activeCurrent = buildDictionarySelectOptions({
    catalog: currentCatalog,
    currentValue: 'READY',
    loading: false,
    selectableItems,
  })
  assert.equal(activeCurrent.filter(option => option.value === 'READY').length, 1)
  assert.deepEqual(activeCurrent.map(option => option.value), [
    'PENDING',
    'READY',
    'COMPLETED',
  ])
})

test('不可信或加载中的目录只展示精确 raw，不泄露残留候选或历史结论', () => {
  const staleCatalog = catalog([pending, archived])

  assert.deepEqual(buildDictionarySelectOptions({
    catalog: staleCatalog,
    currentValue: 'ARCHIVED',
    loading: true,
    selectableItems: [pending],
  }), [
    { disabled: true, label: 'ARCHIVED', value: 'ARCHIVED' },
  ])

  assert.deepEqual(buildDictionarySelectOptions({
    catalog: null,
    currentValue: '',
    loading: false,
    selectableItems: [pending],
  }), [
    { disabled: true, label: '', value: '' },
  ])

  assert.deepEqual(buildDictionarySelectOptions({
    catalog: null,
    currentValue: null,
    loading: false,
    selectableItems: [pending],
  }), [])
})

test('搜索匹配 Label 或 value，忽略边缘空白和大小写且不改变顺序', () => {
  const options = [
    { label: '同名状态', value: 'READY' },
    { label: '同名状态', value: 'COMPLETED' },
    { label: '待审批', value: 'Pending_Review' },
  ] as const

  assert.deepEqual(
    options.filter(option => filterDictionarySelectOption('  同名  ', option)),
    options.slice(0, 2),
  )
  assert.deepEqual(
    options.filter(option => filterDictionarySelectOption(' review ', option)),
    [options[2]],
  )
  assert.equal(filterDictionarySelectOption('missing', options[0]), false)
})

test('可信空 Catalog 与有候选但搜索无匹配使用不同空态', () => {
  const currentCatalog = catalog([pending])
  const emptyCatalog = catalog([archived])

  assert.equal(getDictionarySelectEmptyState({
    catalog: emptyCatalog,
    // 当前停用历史值会形成 synthetic option，但目录仍没有新选择候选。
    filteredOptionCount: 1,
    loading: false,
    searchKeyword: '',
    selectableItems: [],
  }), 'CATALOG_EMPTY')
  assert.equal(getDictionarySelectEmptyState({
    catalog: currentCatalog,
    filteredOptionCount: 0,
    loading: false,
    searchKeyword: 'missing',
    selectableItems: [pending],
  }), 'NO_MATCH')
  assert.equal(getDictionarySelectEmptyState({
    catalog: currentCatalog,
    filteredOptionCount: 0,
    loading: true,
    searchKeyword: 'missing',
    selectableItems: [pending],
  }), null)
  assert.equal(getDictionarySelectEmptyState({
    catalog: currentCatalog,
    filteredOptionCount: 0,
    loading: false,
    searchKeyword: '   ',
    selectableItems: [pending],
  }), null)
})

test('model adapter 只接受 string 或 undefined，不把契约错误字符串化', () => {
  assert.equal(toDictionarySelectInnerValue(null), undefined)
  assert.equal(toDictionarySelectInnerValue(''), '')
  assert.equal(toDictionarySelectInnerValue('READY'), 'READY')
  assert.equal(fromDictionarySelectInnerValue(undefined), null)
  assert.equal(fromDictionarySelectInnerValue(''), '')
  assert.equal(fromDictionarySelectInnerValue('READY'), 'READY')

  for (const value of [null, 0, false, 1n, { value: 'READY' }]) {
    assert.throws(
      () => fromDictionarySelectInnerValue(value),
      /non-string value/u,
    )
  }
})

test('attrs 只进入精确 root、input 与 form 白名单', () => {
  const style = { minWidth: 0 }
  const groups = splitDictionarySelectAttrs({
    'aria-activedescendant': 'owned-by-reka',
    'aria-busy': false,
    'aria-controls': 'owned-by-reka',
    'aria-describedby': 'field-help',
    'aria-expanded': false,
    'aria-invalid': true,
    'aria-label': '流程状态',
    'aria-labelledby': 'workflow-status-label',
    'aria-required': false,
    'aria-errormessage': 'workflow-status-error',
    'autocomplete': 'off',
    'class': ['w-full'],
    'data-slot': 'form-control',
    'data-testid': 'dictionary-select',
    'disabled': true,
    'form': 'workflow-form',
    'id': 'workflow-status',
    'name': 'workflowStatus',
    'onChange': () => {},
    'onInput': () => {},
    'required': true,
    'style': style,
    'tabindex': 2,
    'title': 'ignored',
  })

  assert.deepEqual({ ...groups.rootAttrs }, {
    'class': ['w-full'],
    'data-slot': 'form-control',
    'data-testid': 'dictionary-select',
    'style': style,
  })
  assert.deepEqual({ ...groups.inputAttrs }, {
    'aria-busy': false,
    'aria-describedby': 'field-help',
    'aria-invalid': true,
    'aria-label': '流程状态',
    'aria-labelledby': 'workflow-status-label',
    'aria-required': false,
    'aria-errormessage': 'workflow-status-error',
    'id': 'workflow-status',
    'tabindex': 2,
  })
  assert.deepEqual({ ...groups.formAttrs }, {
    form: 'workflow-form',
    name: 'workflowStatus',
    required: true,
  })
  assert.equal(Object.getPrototypeOf(groups.rootAttrs), null)
  assert.equal(Object.getPrototypeOf(groups.inputAttrs), null)
  assert.equal(Object.getPrototypeOf(groups.formAttrs), null)
})

test('纯逻辑结果可直接绑定 FaCombobox，不需要调用方类型断言', () => {
  const options: ComboboxProps['options'] = buildDictionarySelectOptions({
    catalog: catalog([pending]),
    currentValue: null,
    loading: false,
    selectableItems: [pending],
  })
  const filter: NonNullable<ComboboxProps['filter']>
    = filterDictionarySelectOption
  const inputAttrs: NonNullable<ComboboxProps['inputAttrs']>
    = splitDictionarySelectAttrs({
      'aria-invalid': 'grammar',
      'aria-required': 'TRUE',
      'id': 'workflow-status',
    }).inputAttrs

  assert.equal(options.length, 1)
  assert.equal(filter('pending', options[0]!), true)
  assert.deepEqual({ ...inputAttrs }, {
    'aria-invalid': 'grammar',
    'aria-required': 'true',
    'id': 'workflow-status',
  })

  const invalidAria = splitDictionarySelectAttrs({
    'aria-busy': 'sometimes',
    'aria-required': 'required',
  }).inputAttrs
  assert.deepEqual({ ...invalidAria }, {})
})

test('required 合并与双代理精确区分 null、空字符串和普通 raw', () => {
  const requiredGroups = splitDictionarySelectAttrs({
    'aria-required': false,
    'form': 'workflow-form',
    'name': 'workflowStatus',
    'required': true,
  })
  const nullState = buildDictionarySelectFormProxies({
    callerDisabled: false,
    formAttrs: requiredGroups.formAttrs,
    inputAttrs: requiredGroups.inputAttrs,
    modelValue: null,
  })
  assert.equal(nullState.nativeRequired, true)
  assert.equal(nullState.effectiveAriaRequired, 'true')
  assert.equal(nullState.submissionProxy, null)
  assert.deepEqual(nullState.validationProxy, {
    'aria-hidden': 'true',
    'disabled': false,
    'form': 'workflow-form',
    'required': true,
    'tabindex': -1,
    'type': 'text',
    'value': '',
  })
  assert.equal(Object.hasOwn(nullState.validationProxy ?? {}, 'name'), false)

  const emptyState = buildDictionarySelectFormProxies({
    callerDisabled: false,
    formAttrs: requiredGroups.formAttrs,
    inputAttrs: requiredGroups.inputAttrs,
    modelValue: '',
  })
  assert.deepEqual(emptyState.submissionProxy, {
    disabled: false,
    form: 'workflow-form',
    name: 'workflowStatus',
    type: 'hidden',
    value: '',
  })
  assert.equal(emptyState.validationProxy?.value, 'present')

  const rawState = buildDictionarySelectFormProxies({
    callerDisabled: true,
    formAttrs: requiredGroups.formAttrs,
    inputAttrs: requiredGroups.inputAttrs,
    modelValue: 'LEGACY_RAW',
  })
  assert.equal(rawState.submissionProxy?.value, 'LEGACY_RAW')
  assert.equal(rawState.submissionProxy?.disabled, true)
  assert.equal(rawState.validationProxy?.disabled, true)
})

test('aria-required 可独立启用验证代理，缺少 name 时不创建提交代理', () => {
  const groups = splitDictionarySelectAttrs({
    'aria-required': 'TRUE',
    'form': 'detached-form',
    'required': false,
  })
  const state = buildDictionarySelectFormProxies({
    callerDisabled: false,
    formAttrs: groups.formAttrs,
    inputAttrs: groups.inputAttrs,
    modelValue: '',
  })

  assert.equal(state.nativeRequired, true)
  assert.equal(state.effectiveAriaRequired, 'true')
  assert.equal(state.submissionProxy, null)
  assert.equal(state.validationProxy?.form, 'detached-form')

  const optionalGroups = splitDictionarySelectAttrs({
    'aria-required': false,
    'name': 'workflowStatus',
  })
  const optionalState = buildDictionarySelectFormProxies({
    callerDisabled: false,
    formAttrs: optionalGroups.formAttrs,
    inputAttrs: optionalGroups.inputAttrs,
    modelValue: 'READY',
  })
  assert.equal(optionalState.nativeRequired, false)
  assert.equal(optionalState.effectiveAriaRequired, false)
  assert.equal(optionalState.validationProxy, null)
})
