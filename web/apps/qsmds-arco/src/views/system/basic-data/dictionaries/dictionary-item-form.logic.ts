import type {
  CreateDictionaryItemRequestDto,
  DictionaryItemDto,
  UpdateDictionaryItemRequestDto,
} from '@/api/generated/types.gen'

export type DictionaryItemFormMode = 'create' | 'edit'
export type DictionaryItemTone = DictionaryItemDto['tone']

export const DICTIONARY_ITEM_TONES = [
  'DEFAULT',
  'PRIMARY',
  'SUCCESS',
  'WARNING',
  'DANGER',
  'INFO',
] as const satisfies readonly DictionaryItemTone[]

export interface DictionaryItemFormModel {
  value: string
  label: string
  description: string
  tone: DictionaryItemTone
  sortOrder: number | string
}

export type DictionaryItemFormErrors = Partial<
  Record<keyof DictionaryItemFormModel, string>
>

export type DictionaryItemMutableFormField
  = Exclude<keyof DictionaryItemFormModel, 'value'>

export interface DictionaryItemFormRebaseConflict {
  readonly field: DictionaryItemMutableFormField
  readonly latestValue: string
}

export interface DictionaryItemFormRebaseResult {
  readonly conflicts: readonly DictionaryItemFormRebaseConflict[]
  readonly model: DictionaryItemFormModel
}

const ITEM_VALUE_PATTERN = /^[A-Za-z0-9][\w.-]*$/u
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu
const EDGE_UNICODE_WHITESPACE_PATTERN
  = /^\p{White_Space}+|\p{White_Space}+$/gu

const ITEM_VALUE_MAX_CODE_POINTS = 64
const LABEL_MAX_CODE_POINTS = 128
const DESCRIPTION_MAX_CODE_POINTS = 500
const MAX_INT32 = 2_147_483_647

function codePointLength(value: string): number {
  // Server 使用 Unicode 码点长度，避免 Emoji 被 UTF-16 双重计数。
  return Array.from(value).length
}

function normalizeIdentifierText(value: string): string {
  /*
   * String.trim() 不覆盖 U+0085。技术标识只做 NFC 与 Unicode
   * White_Space 边缘裁剪，内部空白交给格式校验拒绝。
   */
  return value
    .normalize('NFC')
    .replace(EDGE_UNICODE_WHITESPACE_PATTERN, '')
}

/** 展示文本与 Server 保持一致：NFC 后折叠全部 Unicode 空白。 */
export function normalizeDictionaryItemFormText(value: string): string {
  return value
    .normalize('NFC')
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .trim()
}

/** 校验通过后才执行 uppercase，防止 Unicode 大小写展开伪装 ASCII。 */
export function normalizeDictionaryItemFormValue(value: string): string {
  return normalizeIdentifierText(value).toUpperCase()
}

function normalizeOptionalDescription(value: string): null | string {
  const normalized = normalizeDictionaryItemFormText(value)
  return normalized === '' ? null : normalized
}

function normalizeSortOrderText(value: number | string): string {
  return normalizeIdentifierText(
    typeof value === 'number' ? String(value) : value,
  )
}

function normalizeSortOrder(value: number | string): number {
  return Number(normalizeSortOrderText(value))
}

export function createDictionaryItemFormModel(
  mode: DictionaryItemFormMode,
  dictionaryItem?: DictionaryItemDto | null,
): DictionaryItemFormModel {
  if (mode === 'edit' && dictionaryItem !== null && dictionaryItem !== undefined) {
    return {
      value: dictionaryItem.value,
      label: dictionaryItem.label,
      description: dictionaryItem.description ?? '',
      tone: dictionaryItem.tone,
      sortOrder: String(dictionaryItem.sortOrder),
    }
  }

  return {
    value: '',
    label: '',
    description: '',
    tone: 'DEFAULT',
    sortOrder: '0',
  }
}

export function validateDictionaryItemForm(
  model: DictionaryItemFormModel,
  mode: DictionaryItemFormMode,
): DictionaryItemFormErrors {
  const errors: DictionaryItemFormErrors = {}

  if (mode === 'create') {
    const value = normalizeIdentifierText(model.value)
    const valueLength = codePointLength(value)
    if (
      valueLength < 1
      || valueLength > ITEM_VALUE_MAX_CODE_POINTS
      || !ITEM_VALUE_PATTERN.test(value)
    ) {
      errors.value = '条目值必须是 1 到 64 位 ASCII 技术标识'
    }
  }

  const label = normalizeDictionaryItemFormText(model.label)
  const labelLength = codePointLength(label)
  if (labelLength < 1 || labelLength > LABEL_MAX_CODE_POINTS) {
    errors.label = '条目标签必须为 1 到 128 个字符'
  }

  const description = normalizeDictionaryItemFormText(model.description)
  if (codePointLength(description) > DESCRIPTION_MAX_CODE_POINTS) {
    errors.description = '说明不能超过 500 个字符'
  }

  if (!DICTIONARY_ITEM_TONES.includes(model.tone)) {
    errors.tone = '请选择有效的语义色调'
  }

  const sortOrderText = normalizeSortOrderText(model.sortOrder)
  const sortOrder = Number(sortOrderText)
  if (
    !/^\d+$/u.test(sortOrderText)
    || !Number.isSafeInteger(sortOrder)
    || sortOrder < 0
    || sortOrder > MAX_INT32
  ) {
    errors.sortOrder = '排序必须是 0 到 2147483647 的整数'
  }

  return errors
}

export function buildCreateDictionaryItemRequest(
  model: DictionaryItemFormModel,
): CreateDictionaryItemRequestDto {
  const description = normalizeOptionalDescription(model.description)
  return {
    value: normalizeDictionaryItemFormValue(model.value),
    label: normalizeDictionaryItemFormText(model.label),
    ...(description === null ? {} : { description }),
    tone: model.tone,
    sortOrder: normalizeSortOrder(model.sortOrder),
  }
}

/**
 * Item value、dictionaryTypeId 与 enabled 都属于表单边界外。PATCH 只输出
 * 真正变化的可变字段，并使用调用方当前 canonical DTO 的 version。
 */
export function buildUpdateDictionaryItemRequest(
  model: DictionaryItemFormModel,
  dictionaryItem: DictionaryItemDto,
): UpdateDictionaryItemRequestDto {
  const request: UpdateDictionaryItemRequestDto = {
    expectedVersion: dictionaryItem.version,
  }
  const label = normalizeDictionaryItemFormText(model.label)
  const description = normalizeOptionalDescription(model.description)
  const sortOrder = normalizeSortOrder(model.sortOrder)

  if (label !== normalizeDictionaryItemFormText(dictionaryItem.label)) {
    request.label = label
  }
  if (
    description
    !== normalizeOptionalDescription(dictionaryItem.description ?? '')
  ) {
    request.description = description
  }
  if (model.tone !== dictionaryItem.tone) {
    request.tone = model.tone
  }
  if (sortOrder !== dictionaryItem.sortOrder) {
    request.sortOrder = sortOrder
  }

  return request
}

export function hasDictionaryItemFormChanges(
  model: DictionaryItemFormModel,
  dictionaryItem: DictionaryItemDto,
): boolean {
  return Object.keys(buildUpdateDictionaryItemRequest(model, dictionaryItem))
    .some(field => field !== 'expectedVersion')
}

/**
 * Network unknown 的 update 只有在版本确实前进、父子身份一致且全部提交字段命中时
 * 才能确认。空 PATCH 不代表写入，不能把原快照误判为本次 Mutation 的最终结果。
 */
export function matchesDictionaryItemUpdateResult(
  item: DictionaryItemDto,
  typeId: string,
  itemId: string,
  request: UpdateDictionaryItemRequestDto,
): boolean {
  const mutableFields = ['description', 'label', 'sortOrder', 'tone'] as const
  const changedFields = mutableFields.filter(field => Object.hasOwn(request, field))
  return changedFields.length > 0
    && item.dictionaryTypeId === typeId
    && item.id === itemId
    && item.version > request.expectedVersion
    && changedFields.every(field => item[field] === request[field])
}

/**
 * Create 没有 operation identity；这里最多返回唯一的严格候选供人工核对，调用方
 * 仍不得据此宣告本次请求成功。默认停用与 version=1 也属于候选匹配条件。
 */
export function findMatchingCreatedDictionaryItem(
  items: readonly DictionaryItemDto[],
  typeId: string,
  request: CreateDictionaryItemRequestDto,
): DictionaryItemDto | undefined {
  const description = request.description ?? null
  const matches = items.filter(item =>
    item.dictionaryTypeId === typeId
    && item.value === request.value
    && item.label === request.label
    && item.description === description
    && item.tone === (request.tone ?? 'DEFAULT')
    && item.sortOrder === request.sortOrder
    && item.enabled === false
    && item.effectiveEnabled === false
    && item.version === 1)
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * 409 后使用旧快照、用户草稿与最新快照三方合并。用户未改的
 * 字段采用 Server 最新值；双方都改且最终不同时保留用户输入并报冲突。
 */
export function rebaseDictionaryItemFormModel(
  model: DictionaryItemFormModel,
  previous: DictionaryItemDto,
  latest: DictionaryItemDto,
): DictionaryItemFormRebaseResult {
  if (
    previous.id !== latest.id
    || previous.dictionaryTypeId !== latest.dictionaryTypeId
  ) {
    return {
      conflicts: [],
      model: createDictionaryItemFormModel('edit', latest),
    }
  }

  const latestModel = createDictionaryItemFormModel('edit', latest)
  const userChanges = buildUpdateDictionaryItemRequest(model, previous)
  const serverChanges = buildUpdateDictionaryItemRequest(latestModel, previous)
  const userAgainstLatest = buildUpdateDictionaryItemRequest(model, latest)
  const rebased: DictionaryItemFormModel = {
    ...model,
    value: latest.value,
  }
  const conflicts: DictionaryItemFormRebaseConflict[] = []
  const fields: readonly DictionaryItemMutableFormField[] = [
    'label',
    'description',
    'tone',
    'sortOrder',
  ]

  for (const field of fields) {
    const userChanged = Object.hasOwn(userChanges, field)
    if (!userChanged) {
      rebased[field] = latestModel[field] as never
      continue
    }
    if (
      Object.hasOwn(serverChanges, field)
      && Object.hasOwn(userAgainstLatest, field)
    ) {
      const latestValue = latestModel[field]
      conflicts.push({
        field,
        latestValue: latestValue === '' ? '（空）' : String(latestValue),
      })
    }
  }

  return {
    conflicts,
    model: rebased,
  }
}
