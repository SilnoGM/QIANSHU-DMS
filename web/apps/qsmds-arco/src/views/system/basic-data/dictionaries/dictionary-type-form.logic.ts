import type {
  CreateDictionaryTypeRequestDto,
  DictionaryTypeDto,
  UpdateDictionaryTypeRequestDto,
} from '@/api/generated/types.gen'

export type DictionaryTypeFormMode = 'create' | 'edit'

export interface DictionaryTypeFormModel {
  code: string
  description: string
  name: string
  sortOrder: number | string
}

export type DictionaryTypeFormErrors = Partial<
  Record<keyof DictionaryTypeFormModel, string>
>

export type DictionaryTypeMutableFormField
  = Exclude<keyof DictionaryTypeFormModel, 'code'>

export interface DictionaryTypeFormRebaseConflict {
  readonly field: DictionaryTypeMutableFormField
  readonly latestValue: string
}

export interface DictionaryTypeFormRebaseResult {
  readonly conflicts: readonly DictionaryTypeFormRebaseConflict[]
  readonly model: DictionaryTypeFormModel
}

const TYPE_CODE_PATTERN = /^[A-Za-z]\w*(?:\.[A-Za-z]\w*)+$/u
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu
const EDGE_UNICODE_WHITESPACE_PATTERN
  = /^\p{White_Space}+|\p{White_Space}+$/gu

const TYPE_CODE_MIN_CODE_POINTS = 3
const TYPE_CODE_MAX_CODE_POINTS = 64
const NAME_MAX_CODE_POINTS = 128
const DESCRIPTION_MAX_CODE_POINTS = 500
const MAX_INT32 = 2_147_483_647

function codePointLength(value: string): number {
  // Server 按 Unicode 码点而非 UTF-16 code unit 计数，Emoji 等字符必须保持同一口径。
  return Array.from(value).length
}

function normalizeIdentifierText(value: string): string {
  /*
   * String.trim() 不覆盖 U+0085。Type code 与 Server 一致，只裁剪 Unicode
   * White_Space 边缘，不折叠内部空白，让格式校验负责拒绝非法标识。
   */
  return value
    .normalize('NFC')
    .replace(EDGE_UNICODE_WHITESPACE_PATTERN, '')
}

/**
 * 展示文本与 Server 保持一致：NFC 后把所有 Unicode 空白折叠成单个 ASCII 空格。
 */
export function normalizeDictionaryTypeFormText(value: string): string {
  return value
    .normalize('NFC')
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .trim()
}

/**
 * 构造请求时才转换 lowercase；校验阶段仍在转换前检查 ASCII，避免 Unicode
 * 大小写展开使非 ASCII 字符伪装成合法技术标识。
 */
export function normalizeDictionaryTypeFormCode(value: string): string {
  return normalizeIdentifierText(value).toLowerCase()
}

function normalizeOptionalDescription(value: string): null | string {
  const normalized = normalizeDictionaryTypeFormText(value)
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

export function createDictionaryTypeFormModel(
  mode: DictionaryTypeFormMode,
  dictionaryType?: DictionaryTypeDto | null,
): DictionaryTypeFormModel {
  if (mode === 'edit' && dictionaryType !== null && dictionaryType !== undefined) {
    return {
      code: dictionaryType.code,
      description: dictionaryType.description ?? '',
      name: dictionaryType.name,
      sortOrder: String(dictionaryType.sortOrder),
    }
  }

  return {
    code: '',
    description: '',
    name: '',
    sortOrder: '0',
  }
}

export function validateDictionaryTypeForm(
  model: DictionaryTypeFormModel,
  mode: DictionaryTypeFormMode,
): DictionaryTypeFormErrors {
  const errors: DictionaryTypeFormErrors = {}

  if (mode === 'create') {
    const code = normalizeIdentifierText(model.code)
    const codeLength = codePointLength(code)
    if (
      codeLength < TYPE_CODE_MIN_CODE_POINTS
      || codeLength > TYPE_CODE_MAX_CODE_POINTS
      || !TYPE_CODE_PATTERN.test(code)
    ) {
      errors.code = '类型编码必须是 3 到 64 位带点 ASCII namespace'
    }
  }

  const name = normalizeDictionaryTypeFormText(model.name)
  const nameLength = codePointLength(name)
  if (nameLength < 1 || nameLength > NAME_MAX_CODE_POINTS) {
    errors.name = '类型名称必须为 1 到 128 个字符'
  }

  const description = normalizeDictionaryTypeFormText(model.description)
  if (codePointLength(description) > DESCRIPTION_MAX_CODE_POINTS) {
    errors.description = '说明不能超过 500 个字符'
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

export function buildCreateDictionaryTypeRequest(
  model: DictionaryTypeFormModel,
): CreateDictionaryTypeRequestDto {
  const description = normalizeOptionalDescription(model.description)
  return {
    code: normalizeDictionaryTypeFormCode(model.code),
    name: normalizeDictionaryTypeFormText(model.name),
    ...(description === null ? {} : { description }),
    sortOrder: normalizeSortOrder(model.sortOrder),
  }
}

/**
 * Type code、id 与 enabled 都是当前表单边界外字段。PATCH 只输出规范化后真正变化的
 * mutable field，并始终使用调用方刚取得的 canonical DTO version。
 */
export function buildUpdateDictionaryTypeRequest(
  model: DictionaryTypeFormModel,
  dictionaryType: DictionaryTypeDto,
): UpdateDictionaryTypeRequestDto {
  const request: UpdateDictionaryTypeRequestDto = {
    expectedVersion: dictionaryType.version,
  }
  const name = normalizeDictionaryTypeFormText(model.name)
  const description = normalizeOptionalDescription(model.description)
  const sortOrder = normalizeSortOrder(model.sortOrder)

  if (name !== normalizeDictionaryTypeFormText(dictionaryType.name)) {
    request.name = name
  }
  if (
    description
    !== normalizeOptionalDescription(dictionaryType.description ?? '')
  ) {
    request.description = description
  }
  if (sortOrder !== dictionaryType.sortOrder) {
    request.sortOrder = sortOrder
  }

  return request
}

export function hasDictionaryTypeFormChanges(
  model: DictionaryTypeFormModel,
  dictionaryType: DictionaryTypeDto,
): boolean {
  return Object.keys(buildUpdateDictionaryTypeRequest(model, dictionaryType))
    .some(field => field !== 'expectedVersion')
}

/**
 * 409 后按“旧快照、用户草稿、最新快照”做三方合并：用户未碰过的字段采用
 * Server 最新值；只有双方都改且最终值不同的字段才标记冲突，并保留用户输入。
 * 调用方随后必须以 latest DTO 构造新的 expectedVersion。
 */
export function rebaseDictionaryTypeFormModel(
  model: DictionaryTypeFormModel,
  previous: DictionaryTypeDto,
  latest: DictionaryTypeDto,
): DictionaryTypeFormRebaseResult {
  if (previous.id !== latest.id) {
    return {
      conflicts: [],
      model: createDictionaryTypeFormModel('edit', latest),
    }
  }

  const latestModel = createDictionaryTypeFormModel('edit', latest)
  const userChanges = buildUpdateDictionaryTypeRequest(model, previous)
  const serverChanges = buildUpdateDictionaryTypeRequest(latestModel, previous)
  const userAgainstLatest = buildUpdateDictionaryTypeRequest(model, latest)
  const rebased: DictionaryTypeFormModel = {
    ...model,
    code: latest.code,
  }
  const conflicts: DictionaryTypeFormRebaseConflict[] = []
  const fields: readonly DictionaryTypeMutableFormField[] = [
    'name',
    'description',
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
