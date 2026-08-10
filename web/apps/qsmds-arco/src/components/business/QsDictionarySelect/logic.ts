import type {
  ComboboxOption,
  ComboboxProps,
} from '@fantastic-admin/components'
import type {
  DictionaryCatalog,
  DictionaryCatalogItem,
} from '../../../dictionary-catalog/types'
import { resolveDictionaryCatalogValue } from '../../../dictionary-catalog/options'

export interface BuildDictionarySelectOptionsInput {
  readonly catalog: DictionaryCatalog | null
  readonly currentValue: string | null
  readonly loading: boolean
  readonly selectableItems: readonly DictionaryCatalogItem[]
}

export interface DictionarySelectOption extends ComboboxOption {
  readonly label: string
  readonly value: string
}

export type DictionarySelectEmptyState = 'CATALOG_EMPTY' | 'NO_MATCH' | null

export interface GetDictionarySelectEmptyStateInput {
  readonly catalog: DictionaryCatalog | null
  readonly filteredOptionCount: number
  readonly loading: boolean
  readonly searchKeyword: string
  readonly selectableItems: readonly DictionaryCatalogItem[]
}

export type DictionarySelectRawAttrs = Readonly<Record<string, unknown>>

type DictionarySelectInputAttrs = NonNullable<ComboboxProps['inputAttrs']>

export interface DictionarySelectAttrGroups {
  readonly formAttrs: Readonly<Record<string, unknown>>
  readonly inputAttrs: DictionarySelectInputAttrs
  readonly rootAttrs: Readonly<Record<string, unknown>>
}

export interface BuildDictionarySelectFormProxiesInput {
  readonly callerDisabled: boolean
  readonly formAttrs: Readonly<Record<string, unknown>>
  readonly inputAttrs: DictionarySelectInputAttrs
  readonly modelValue: string | null
}

export interface DictionarySelectSubmissionProxy {
  readonly disabled: boolean
  readonly form: string | undefined
  readonly name: string
  readonly type: 'hidden'
  readonly value: string
}

export interface DictionarySelectValidationProxy {
  readonly 'aria-hidden': 'true'
  readonly 'disabled': boolean
  readonly 'form': string | undefined
  readonly 'required': true
  readonly 'tabindex': -1
  readonly 'type': 'text'
  readonly 'value': '' | 'present'
}

export interface DictionarySelectFormProxies {
  readonly effectiveAriaRequired: DictionarySelectInputAttrs['aria-required']
  readonly nativeRequired: boolean
  readonly submissionProxy: DictionarySelectSubmissionProxy | null
  readonly validationProxy: DictionarySelectValidationProxy | null
}

const FORM_ATTR_NAMES = new Set([
  'form',
  'name',
  'required',
])

function createAttributeRecord(): Record<string, unknown> {
  // 无原型记录避免特殊属性名污染后续 `v-bind` 使用的属性容器。
  return Object.create(null) as Record<string, unknown>
}

function isDataAttribute(name: string): boolean {
  return /^data-[a-z][a-z0-9_.:-]*$/u.test(name)
}

function hasBooleanAttribute(value: unknown): boolean {
  return value !== false && value !== null && value !== undefined
}

function isAriaTrue(value: unknown): boolean {
  return value === true
    || value === ''
    || (typeof value === 'string' && value.toLowerCase() === 'true')
}

function normalizeTextAttribute(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }
  return undefined
}

function normalizeBooleanish(
  value: unknown,
  emptyMeansTrue = false,
): boolean | 'false' | 'true' | undefined {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.toLowerCase()
  if (normalized === 'true' || normalized === 'false') {
    return normalized
  }
  if (emptyMeansTrue && normalized === '') {
    return 'true'
  }
  return undefined
}

function setInputAttribute(
  attrs: DictionarySelectInputAttrs,
  name: string,
  value: unknown,
): boolean {
  switch (name) {
    case 'id':
    case 'aria-label':
    case 'aria-labelledby':
    case 'aria-describedby':
    case 'aria-errormessage': {
      const normalized = normalizeTextAttribute(value)
      if (normalized !== undefined) {
        attrs[name] = normalized
      }
      return true
    }
    case 'tabindex':
      if (typeof value === 'number' || typeof value === 'string') {
        attrs.tabindex = value
      }
      return true
    case 'aria-busy': {
      const normalized = normalizeBooleanish(value)
      if (normalized !== undefined) {
        attrs['aria-busy'] = normalized
      }
      return true
    }
    case 'aria-required': {
      const normalized = normalizeBooleanish(value, true)
      if (normalized !== undefined) {
        attrs['aria-required'] = normalized
      }
      return true
    }
    case 'aria-invalid': {
      if (value === 'grammar' || value === 'spelling') {
        attrs['aria-invalid'] = value
        return true
      }
      const normalized = normalizeBooleanish(value)
      if (normalized !== undefined) {
        attrs['aria-invalid'] = normalized
      }
      return true
    }
    default:
      return false
  }
}

/**
 * 只在 Catalog 已完成加载时暴露新选择候选并解释历史值。
 *
 * `loading=true` 即使携带上一次请求的残留 Catalog，也必须 fail-closed：组件
 * 只能显示当前 raw，不能让旧 code 的候选重新变得可选或提前给出历史结论。
 */
export function buildDictionarySelectOptions(
  input: BuildDictionarySelectOptionsInput,
): DictionarySelectOption[] {
  const catalogTrusted = !input.loading && input.catalog !== null
  const options = catalogTrusted
    ? input.selectableItems.map(item => Object.freeze({
        label: item.label,
        value: item.value,
      }))
    : []

  if (input.currentValue === null) {
    return options
  }

  const knownValues = new Set(options.map(option => option.value))
  if (knownValues.has(input.currentValue)) {
    return options
  }

  if (!catalogTrusted) {
    options.push(Object.freeze({
      disabled: true,
      label: input.currentValue,
      value: input.currentValue,
    }))
    return options
  }

  // 历史状态复用 Catalog 领域真相源，不在组件层复制 enabled 解释规则。
  const resolution = resolveDictionaryCatalogValue(
    input.catalog,
    input.currentValue,
  )
  if (resolution !== null && resolution.status !== 'ACTIVE') {
    options.push(Object.freeze({
      disabled: true,
      label: resolution.displayLabel,
      value: resolution.value,
    }))
  }

  return options
}

/**
 * FaCombobox 会先维护搜索词；这里仅承担领域匹配，不排序、不远程查询。
 */
export function filterDictionarySelectOption(
  keyword: string,
  option: ComboboxOption,
): boolean {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()
  if (!normalizedKeyword) {
    return true
  }
  return option.label.toLocaleLowerCase().includes(normalizedKeyword)
    || (
      typeof option.value === 'string'
      && option.value.toLocaleLowerCase().includes(normalizedKeyword)
    )
}

/**
 * Catalog 空与搜索无结果具有不同用户含义，且都只能在目录事实可信时下结论。
 */
export function getDictionarySelectEmptyState(
  input: GetDictionarySelectEmptyStateInput,
): DictionarySelectEmptyState {
  if (input.loading || input.catalog === null) {
    return null
  }
  if (input.selectableItems.length === 0) {
    return 'CATALOG_EMPTY'
  }
  if (
    input.searchKeyword.trim().length > 0
    && input.filteredOptionCount === 0
  ) {
    return 'NO_MATCH'
  }
  return null
}

/** 公共模型以 null 表示无值，FaCombobox 内部则使用 undefined。 */
export function toDictionarySelectInnerValue(
  value: string | null,
): string | undefined {
  return value === null ? undefined : value
}

/**
 * 内部控件若返回约定外类型，应立即暴露开发期契约错误，绝不能 String() 后写库。
 */
export function fromDictionarySelectInnerValue(value: unknown): string | null {
  if (value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    return value
  }
  throw new TypeError('QsDictionarySelect received a non-string value')
}

/**
 * `$attrs` 可能含 FaForm 注入事件和任意原生属性，必须按落点显式分组。
 * 搜索 input 不接收 name/change/input，也不覆盖 Reka 自己拥有的组合框 ARIA。
 */
export function splitDictionarySelectAttrs(
  attrs: DictionarySelectRawAttrs,
): DictionarySelectAttrGroups {
  const rootAttrs = createAttributeRecord()
  const inputAttrs = createAttributeRecord() as DictionarySelectInputAttrs
  const formAttrs = createAttributeRecord()

  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class' || name === 'style' || isDataAttribute(name)) {
      rootAttrs[name] = value
      continue
    }
    if (setInputAttribute(inputAttrs, name, value)) {
      continue
    }
    if (FORM_ATTR_NAMES.has(name)) {
      formAttrs[name] = value
    }
  }

  return {
    formAttrs,
    inputAttrs,
    rootAttrs,
  }
}

/**
 * 表单提交与原生 required 验证使用两个单一职责代理。
 *
 * null 表示没有业务值；空字符串则是一个必须原样保留的历史 raw。代理 disabled
 * 只读取 caller prop，目录 loading/error 等交互状态不能让已有值从 FormData 消失。
 */
export function buildDictionarySelectFormProxies(
  input: BuildDictionarySelectFormProxiesInput,
): DictionarySelectFormProxies {
  const form = normalizeTextAttribute(input.formAttrs.form)
  const name = normalizeTextAttribute(input.formAttrs.name)
  const callerAriaRequired = normalizeBooleanish(
    input.inputAttrs['aria-required'],
    true,
  )
  const nativeRequired = hasBooleanAttribute(input.formAttrs.required)
    || isAriaTrue(callerAriaRequired)
  const effectiveAriaRequired = nativeRequired
    ? 'true'
    : callerAriaRequired

  const submissionProxy = name !== undefined && input.modelValue !== null
    ? Object.freeze({
        disabled: input.callerDisabled,
        form,
        name,
        type: 'hidden' as const,
        value: input.modelValue,
      })
    : null

  const validationProxy = nativeRequired
    ? Object.freeze({
        'aria-hidden': 'true' as const,
        'disabled': input.callerDisabled,
        'form': form,
        'required': true as const,
        'tabindex': -1 as const,
        'type': 'text' as const,
        'value': input.modelValue === null ? '' as const : 'present' as const,
      })
    : null

  return Object.freeze({
    effectiveAriaRequired,
    nativeRequired,
    submissionProxy,
    validationProxy,
  })
}
