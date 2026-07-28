import type {
  CreateRegionRequestDto,
  RegionDto,
  UpdateRegionRequestDto,
} from '@/api/generated/types.gen'

export type RegionFormMode = 'create' | 'edit'
export type RegionFormLevel = RegionDto['level']
export type RegionFormField
  = | 'name'
    | 'englishName'
    | 'code'
    | 'sortOrder'
    | 'enabled'

export interface RegionFormModel {
  code: string
  enabled: boolean
  englishName: string
  name: string
  sortOrder: number | string
}

export type RegionFormFieldErrorValue = readonly string[] | string
export type RegionFormFieldErrors = Readonly<
  Partial<Record<RegionFormField, RegionFormFieldErrorValue>>
>
export type RegionFormResolvedFieldErrors = Partial<
  Record<RegionFormField, string>
>

export type RegionFormSubmit
  = | {
    readonly mode: 'create'
    readonly value: CreateRegionRequestDto
  }
  | {
    readonly mode: 'edit'
    readonly value: UpdateRegionRequestDto
  }

export interface RegionFormModalProps {
  readonly error?: null | string
  readonly fieldErrors?: RegionFormFieldErrors
  readonly mode: RegionFormMode
  readonly modelValue: boolean
  readonly parentId: null | string
  readonly parentPath: readonly string[]
  readonly region?: null | RegionDto
  readonly requestId?: null | string
  readonly submitting?: boolean
  readonly targetLevel: RegionFormLevel
}

export interface RegionFormModalEmits {
  cancel: []
  submit: [submission: RegionFormSubmit]
}

const MAX_INT32 = 2_147_483_647
const REGION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,63}$/u
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu

const CREATE_FIELD_ORDER = [
  'name',
  'englishName',
  'code',
  'sortOrder',
  'enabled',
] as const satisfies readonly RegionFormField[]

const EDIT_FIELD_ORDER = [
  'name',
  'englishName',
  'sortOrder',
] as const satisfies readonly RegionFormField[]

function fieldOrder(mode: RegionFormMode): readonly RegionFormField[] {
  return mode === 'create' ? CREATE_FIELD_ORDER : EDIT_FIELD_ORDER
}

function codePointLength(value: string): number {
  return [...value].length
}

/**
 * 与 Server 的地区名称规范保持一致：先 NFC，再把全部 Unicode 空白折叠为一个
 * ASCII 空格，最后去除首尾空白。前端只负责快速反馈，Server 仍是最终真相源。
 */
export function normalizeRegionFormText(value: string): string {
  return value
    .normalize('NFC')
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .trim()
}

export function normalizeRegionFormCode(value: string): string {
  return value
    .normalize('NFC')
    .trim()
    .toUpperCase()
}

function normalizeOptionalRegionFormText(value: string): null | string {
  const normalized = normalizeRegionFormText(value)
  return normalized === '' ? null : normalized
}

function normalizeSortOrderText(value: number | string): string {
  /*
   * FaInput 的 number 模式会在真实浏览器中把 v-model 回写为 number；测试与表单
   * 初始化仍使用 string。两种形态统一成文本后再走同一整数规则，避免在用户点击
   * 提交时对 number 调用 String.prototype.normalize。
   */
  return normalizeRegionFormText(
    typeof value === 'number' ? String(value) : value,
  )
}

function normalizedSortOrder(value: number | string): number {
  return Number(normalizeSortOrderText(value))
}

export function createRegionFormModel(
  mode: RegionFormMode,
  region?: null | RegionDto,
): RegionFormModel {
  if (mode === 'edit' && region !== null && region !== undefined) {
    return {
      code: region.code,
      enabled: region.enabled,
      englishName: region.englishName ?? '',
      name: region.name,
      sortOrder: String(region.sortOrder),
    }
  }

  return {
    code: '',
    enabled: true,
    englishName: '',
    name: '',
    sortOrder: '0',
  }
}

export function validateRegionForm(
  model: RegionFormModel,
  mode: RegionFormMode,
): RegionFormResolvedFieldErrors {
  const errors: RegionFormResolvedFieldErrors = {}
  const name = normalizeRegionFormText(model.name)
  const nameLength = codePointLength(name)
  const normalizedNameLength = codePointLength(
    name.toLocaleLowerCase('en-US').normalize('NFC'),
  )
  if (
    nameLength < 1
    || nameLength > 128
    || normalizedNameLength > 128
  ) {
    errors.name = '名称长度必须为 1 到 128 个字符'
  }

  const englishName = normalizeOptionalRegionFormText(model.englishName)
  if (englishName !== null && codePointLength(englishName) > 128) {
    errors.englishName = '英文名长度不能超过 128 个字符'
  }

  if (mode === 'create') {
    const code = normalizeRegionFormCode(model.code)
    if (!REGION_CODE_PATTERN.test(code)) {
      errors.code = 'Code 只能包含 2 到 64 位英文字母、数字、点、下划线和连字符'
    }
  }

  const sortOrderText = normalizeSortOrderText(model.sortOrder)
  const sortOrder = Number(sortOrderText)
  if (
    !/^\d+$/u.test(sortOrderText)
    || !Number.isSafeInteger(sortOrder)
    || sortOrder < 0
    || sortOrder > MAX_INT32
  ) {
    errors.sortOrder = '排序必须是 0 到 2147483647 之间的整数'
  }

  if (mode === 'create' && typeof model.enabled !== 'boolean') {
    errors.enabled = '请选择自身状态'
  }

  return errors
}

export function buildCreateRegionFormSubmit(
  model: RegionFormModel,
  parentId: null | string,
): Extract<RegionFormSubmit, { mode: 'create' }> {
  const englishName = normalizeOptionalRegionFormText(model.englishName)
  return {
    mode: 'create',
    value: {
      code: normalizeRegionFormCode(model.code),
      enabled: model.enabled,
      ...(englishName === null ? {} : { englishName }),
      name: normalizeRegionFormText(model.name),
      parentId,
      sortOrder: normalizedSortOrder(model.sortOrder),
    },
  }
}

/**
 * Patch 只比较并输出三个公开可变字段。调用方持有 regionId，禁止把标识、层级、父级、
 * code 或 enabled 混入编辑 body。
 */
export function buildUpdateRegionFormSubmit(
  model: RegionFormModel,
  initial: RegionDto,
): Extract<RegionFormSubmit, { mode: 'edit' }> {
  const value: UpdateRegionRequestDto = {}
  const name = normalizeRegionFormText(model.name)
  const englishName = normalizeOptionalRegionFormText(model.englishName)
  const sortOrder = normalizedSortOrder(model.sortOrder)

  if (name !== normalizeRegionFormText(initial.name)) {
    value.name = name
  }
  if (
    englishName
    !== normalizeOptionalRegionFormText(initial.englishName ?? '')
  ) {
    value.englishName = englishName
  }
  if (sortOrder !== initial.sortOrder) {
    value.sortOrder = sortOrder
  }

  return {
    mode: 'edit',
    value,
  }
}

function resolveFieldErrorMessage(
  value: RegionFormFieldErrorValue | undefined,
): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && candidate.trim() !== ''
    ? candidate
    : undefined
}

/**
 * 只接受当前模式真实可编辑字段的 Server 错误，避免编辑态把禁止提交的 code/enabled
 * 错误错误地映射到只读区域。
 */
export function resolveRegionFormFieldErrors(
  input: RegionFormFieldErrors | undefined,
  mode: RegionFormMode,
): RegionFormResolvedFieldErrors {
  if (input === undefined) {
    return {}
  }

  const resolved: RegionFormResolvedFieldErrors = {}
  for (const field of fieldOrder(mode)) {
    const message = resolveFieldErrorMessage(input[field])
    if (message !== undefined) {
      resolved[field] = message
    }
  }
  return resolved
}

export function firstRegionFormErrorField(
  errors: RegionFormResolvedFieldErrors,
  mode: RegionFormMode,
): RegionFormField | undefined {
  return fieldOrder(mode).find(field => errors[field] !== undefined)
}

export function regionFormLevelLabel(level: RegionFormLevel): string {
  return {
    CITY: '城市',
    COUNTRY_REGION: '国家/地区',
    PROVINCE_STATE: '省/州',
  }[level]
}

export function formatRegionFormParentPath(
  parentPath: readonly string[],
): string {
  return parentPath.length === 0
    ? '全部地区（根）'
    : parentPath.join(' ')
}
