import type {
  CreateDictionaryTypeRequestDto,
  DictionaryTypeDto,
  UpdateDictionaryTypeRequestDto,
} from '@/api/generated/types.gen'
import type { DictionaryTypeListQuery } from '@/api/modules/dictionaries'

export type DictionaryTypeStatusAction = 'disable' | 'enable'
export type DictionaryTypeMutationField
  = | 'code'
    | 'description'
    | 'name'
    | 'sortOrder'

export interface DictionaryTypeActionPermissions {
  readonly canDisable: boolean
  readonly canEnable: boolean
  readonly canUpdate: boolean
}

export interface DictionaryTypeActions {
  readonly canDisable: boolean
  readonly canEdit: boolean
  readonly canEnable: boolean
  readonly hasAny: boolean
  readonly readonlyReason: '仅查看'
}

export interface DictionaryTypeMutationFailure {
  readonly code: string | undefined
  readonly fieldErrors: Readonly<Partial<Record<DictionaryTypeMutationField, string>>>
  readonly message: string
  readonly requestId: string | undefined
  /** 只有 HTTP 409 的稳定领域错误码才要求刷新最新 Type/version。 */
  readonly stateChanged: boolean
  /** 只有请求可能已经到达 Server、但客户端没有收到响应的网络错误才为 true。 */
  readonly unknownResult: boolean
}

export type DictionaryStatusTarget = Pick<
  DictionaryTypeDto,
  | 'code'
  | 'enabled'
  | 'enabledItemCount'
  | 'id'
  | 'itemCount'
  | 'name'
  | 'version'
>

export interface DictionaryStatusChangeModalProps {
  action: DictionaryTypeStatusAction
  error?: null | string
  errorCode?: string
  modelValue: boolean
  requestId?: string
  submissionBlocked?: boolean
  submitting?: boolean
  type: DictionaryStatusTarget | null
}

export interface DictionaryStatusChangeRequest {
  action: DictionaryTypeStatusAction
  typeId: string
}

export interface DictionaryStatusChangeCopy {
  confirmLabel: string
  consequence: string
  description: string
  title: string
}

const TYPE_MUTATION_FIELDS = new Set<DictionaryTypeMutationField>([
  'code',
  'description',
  'name',
  'sortOrder',
])
const EDGE_UNICODE_WHITESPACE_PATTERN
  = /^\p{White_Space}+|\p{White_Space}+$/gu
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu

const FALLBACK_MUTATION_MESSAGE = '操作失败，请稍后重试'
const NETWORK_MUTATION_MESSAGE = '网络连接失败，请稍后重试'
const HTTP_UNPARSEABLE_MESSAGE = '服务器返回了无法识别的错误响应'

const DICTIONARY_STATUS_CHANGE_COPY: Readonly<
  Record<DictionaryTypeStatusAction, DictionaryStatusChangeCopy>
> = {
  disable: {
    confirmLabel: '确认停用',
    consequence:
      '停用后，该类型将退出新业务选择；系统会保留全部条目的自身状态，历史数据仍可按原值回显。',
    description: '请核对类型身份及停用影响后再确认。',
    title: '确认停用字典类型',
  },
  enable: {
    confirmLabel: '确认启用',
    consequence:
      '启用要求至少一个自身启用条目处于可生效状态；满足约束后，有效条目将重新进入新业务选择。',
    description: '请核对类型身份及启用条件后再确认。',
    title: '确认启用字典类型',
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createFallbackMutationFailure(): DictionaryTypeMutationFailure {
  return {
    code: undefined,
    fieldErrors: {},
    message: FALLBACK_MUTATION_MESSAGE,
    requestId: undefined,
    stateChanged: false,
    unknownResult: false,
  }
}

function normalizeTypeCode(value: string): string {
  return value
    .normalize('NFC')
    .replace(EDGE_UNICODE_WHITESPACE_PATTERN, '')
    .toLowerCase()
}

function normalizeDisplayText(value: string): string {
  return value
    .normalize('NFC')
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .trim()
}

function normalizeNullableDescription(
  value: null | string | undefined,
): null | string {
  if (value === null || value === undefined) {
    return null
  }
  const normalized = normalizeDisplayText(value)
  return normalized === '' ? null : normalized
}

/** Type 行动作不能仅按权限显示，还必须与当前自身启停状态一致。 */
export function resolveDictionaryTypeActions(
  type: Pick<DictionaryTypeDto, 'enabled'>,
  permissions: DictionaryTypeActionPermissions,
): DictionaryTypeActions {
  const canEdit = permissions.canUpdate
  const canEnable = !type.enabled && permissions.canEnable
  const canDisable = type.enabled && permissions.canDisable

  return {
    canDisable,
    canEdit,
    canEnable,
    hasAny: canEdit || canEnable || canDisable,
    readonlyReason: '仅查看',
  }
}

/**
 * Mutation 错误在页面边界仍视为不可信输入。只读取标准化 API client 的公开结构；
 * 不复制任意错误对象的 message、stack 或额外字段，getter/Proxy 异常统一 fail-closed。
 */
export function getDictionaryTypeMutationFailure(
  error: unknown,
): DictionaryTypeMutationFailure {
  const fallback = createFallbackMutationFailure()

  try {
    if (!isRecord(error)) {
      return fallback
    }

    if (error.kind === 'network') {
      return {
        ...fallback,
        message: NETWORK_MUTATION_MESSAGE,
        unknownResult: true,
      }
    }

    if (error.kind === 'http-unparseable') {
      return {
        ...fallback,
        message: HTTP_UNPARSEABLE_MESSAGE,
        requestId: typeof error.requestId === 'string'
          ? error.requestId
          : undefined,
      }
    }

    if (
      error.kind !== 'http'
      || typeof error.status !== 'number'
      || !isRecord(error.body)
    ) {
      return fallback
    }

    const body = error.body
    const code = typeof body.code === 'string' ? body.code : undefined
    const message = typeof body.message === 'string'
      ? body.message
      : FALLBACK_MUTATION_MESSAGE
    const fieldErrors: Partial<
      Record<DictionaryTypeMutationField, string>
    > = {}

    if (isRecord(body.fieldErrors)) {
      for (const [field, messages] of Object.entries(body.fieldErrors)) {
        if (
          TYPE_MUTATION_FIELDS.has(field as DictionaryTypeMutationField)
          && Array.isArray(messages)
          && typeof messages[0] === 'string'
        ) {
          fieldErrors[field as DictionaryTypeMutationField] = messages[0]
        }
      }
    }

    if (
      code === 'DICTIONARY_TYPE_CODE_ALREADY_EXISTS'
      && fieldErrors.code === undefined
    ) {
      fieldErrors.code = message
    }

    return {
      code,
      fieldErrors,
      message,
      requestId: typeof body.requestId === 'string'
        ? body.requestId
        : undefined,
      stateChanged: error.status === 409
        && code === 'DICTIONARY_TYPE_STATE_CHANGED',
      unknownResult: false,
    }
  }
  catch {
    return fallback
  }
}

/**
 * 管理列表没有 exact-code 参数，因此用规范化 code 发起最小搜索，再由响应匹配器
 * 做严格等值确认。搜索未命中只代表结果不确定，绝不能据此自动重放 create。
 */
export function buildDictionaryTypeCreateReconciliationQuery(
  code: string,
): DictionaryTypeListQuery {
  return {
    page: 1,
    pageSize: 20,
    query: normalizeTypeCode(code),
    sortBy: 'code',
    sortOrder: 'asc',
  }
}

function matchesCreatedDictionaryType(
  type: DictionaryTypeDto,
  request: CreateDictionaryTypeRequestDto,
): boolean {
  return type.code === normalizeTypeCode(request.code)
    && type.name === normalizeDisplayText(request.name)
    && type.description === normalizeNullableDescription(request.description)
    && type.sortOrder === request.sortOrder
    && !type.enabled
    && type.enabledItemCount === 0
    && type.itemCount === 0
    && type.version === 1
}

/**
 * Type code 全局唯一，但仍拒绝异常响应中的多项完整匹配。undefined 的语义是
 * inconclusive（未确认），不是 create 失败，调用方只能保留可修正界面供人工核查。
 */
export function findMatchingCreatedDictionaryType(
  types: readonly DictionaryTypeDto[],
  request: CreateDictionaryTypeRequestDto,
): DictionaryTypeDto | undefined {
  const matches = types.filter(type =>
    matchesCreatedDictionaryType(type, request))
  return matches.length === 1 ? matches[0] : undefined
}

/** edit 对账必须匹配目标 ID、全部提交字段，并确认 version 已越过提交基线。 */
export function matchesDictionaryTypeUpdate(
  type: DictionaryTypeDto,
  targetId: string,
  request: UpdateDictionaryTypeRequestDto,
): boolean {
  return type.id === targetId
    && type.version > request.expectedVersion
    && (
      request.name === undefined
      || type.name === normalizeDisplayText(request.name)
    )
    && (
      request.description === undefined
      || type.description === normalizeNullableDescription(request.description)
    )
    && (
      request.sortOrder === undefined
      || type.sortOrder === request.sortOrder
    )
}

/** status 对账只确认精确目标与最终自身状态；不使用列表缺失推断失败。 */
export function matchesDictionaryTypeStatus(
  type: Pick<DictionaryTypeDto, 'enabled' | 'id'>,
  targetId: string,
  enabled: boolean,
): boolean {
  return type.id === targetId && type.enabled === enabled
}

export function dictionaryStatusChangeCopy(
  action: DictionaryTypeStatusAction,
): DictionaryStatusChangeCopy {
  return DICTIONARY_STATUS_CHANGE_COPY[action]
}

/** Modal 不持有 API、权限或缓存，只向父页面提交最小领域意图。 */
export function createDictionaryStatusChangeRequest(
  action: DictionaryTypeStatusAction,
  type: DictionaryStatusTarget | null,
  submitting: boolean,
): DictionaryStatusChangeRequest | null {
  if (
    submitting
    || type === null
    || (action === 'enable' && (type.enabled || type.enabledItemCount < 1))
    || (action === 'disable' && !type.enabled)
  ) {
    return null
  }

  return {
    action,
    typeId: type.id,
  }
}
