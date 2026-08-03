import type {
  CreateDictionaryTypeRequestDto,
  DictionaryItemDto,
  DictionaryTypeDto,
  UpdateDictionaryTypeRequestDto,
} from '@/api/generated/types.gen'
import type { DictionaryTypeListQuery } from '@/api/modules/dictionaries'

export type DictionaryTypeStatusAction = 'disable' | 'enable'
export type DictionaryStatusTargetKind = 'item' | 'type'
export type DictionaryTypeMutationField
  = | 'code'
    | 'description'
    | 'name'
    | 'sortOrder'
export type DictionaryItemMutationField
  = | 'description'
    | 'expectedVersion'
    | 'label'
    | 'sortOrder'
    | 'tone'
    | 'value'

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

export interface DictionaryItemActions extends DictionaryTypeActions {
  readonly disableBlockedReason:
    | '类型启用期间必须至少保留一个自身启用条目'
    | null
}

interface DictionaryMutationFailure<MutationField extends string> {
  readonly code: string | undefined
  readonly fieldErrors: Readonly<Partial<Record<MutationField, string>>>
  readonly message: string
  readonly requestId: string | undefined
  /** 只有 HTTP 409 的目标稳定领域错误码才要求刷新最新实体/version。 */
  readonly stateChanged: boolean
  /** 只有请求可能已经到达 Server、但客户端没有收到响应的网络错误才为 true。 */
  readonly unknownResult: boolean
}

export type DictionaryTypeMutationFailure
  = DictionaryMutationFailure<DictionaryTypeMutationField>
export type DictionaryItemMutationFailure
  = DictionaryMutationFailure<DictionaryItemMutationField>

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

export type DictionaryItemStatusTarget = Pick<
  DictionaryItemDto,
  | 'dictionaryTypeId'
  | 'effectiveEnabled'
  | 'enabled'
  | 'id'
  | 'label'
  | 'value'
  | 'version'
>

export interface DictionaryStatusChangeModalProps {
  action: DictionaryTypeStatusAction
  error?: null | string
  errorCode?: string
  item?: DictionaryItemStatusTarget | null
  modelValue: boolean
  requestId?: string
  submissionBlocked?: boolean
  submitting?: boolean
  targetKind?: DictionaryStatusTargetKind
  type: DictionaryStatusTarget | null
}

export interface DictionaryTypeStatusChangeRequest {
  action: DictionaryTypeStatusAction
  expectedVersion: number
  targetKind: 'type'
  typeId: string
}

export interface DictionaryItemStatusChangeRequest {
  action: DictionaryTypeStatusAction
  expectedVersion: number
  itemId: string
  targetKind: 'item'
  typeId: string
}

export type DictionaryStatusChangeRequest
  = | DictionaryItemStatusChangeRequest
    | DictionaryTypeStatusChangeRequest

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
const ITEM_MUTATION_FIELDS = new Set<DictionaryItemMutationField>([
  'description',
  'expectedVersion',
  'label',
  'sortOrder',
  'tone',
  'value',
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

const ITEM_LAST_ENABLED_BLOCKED_REASON
  = '类型启用期间必须至少保留一个自身启用条目' as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createFallbackMutationFailure<MutationField extends string>():
DictionaryMutationFailure<MutationField> {
  return {
    code: undefined,
    fieldErrors: {} as Partial<Record<MutationField, string>>,
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
 * Item 行动作以自身 enabled 为准，不能把父 Type 停用导致的 effectiveEnabled=false
 * 误判为条目自身已停用。父 Type 启用时，最后一个自身启用条目的停用动作前置禁用；
 * Server 仍以事务内不变量作为最终真相源。
 */
export function resolveDictionaryItemActions(
  item: Pick<DictionaryItemDto, 'dictionaryTypeId' | 'enabled'>,
  type: Pick<DictionaryTypeDto, 'enabled' | 'enabledItemCount' | 'id'>,
  permissions: DictionaryTypeActionPermissions,
): DictionaryItemActions {
  if (item.dictionaryTypeId !== type.id) {
    return {
      canDisable: false,
      canEdit: false,
      canEnable: false,
      disableBlockedReason: null,
      hasAny: false,
      readonlyReason: '仅查看',
    }
  }

  const disableBlocked = item.enabled
    && type.enabled
    && type.enabledItemCount <= 1
  const canEdit = permissions.canUpdate
  const canEnable = !item.enabled && permissions.canEnable
  const canDisable = item.enabled
    && permissions.canDisable
    && !disableBlocked

  return {
    canDisable,
    canEdit,
    canEnable,
    disableBlockedReason: disableBlocked
      ? ITEM_LAST_ENABLED_BLOCKED_REASON
      : null,
    hasAny: canEdit || canEnable || canDisable,
    readonlyReason: '仅查看',
  }
}

/**
 * Mutation 错误在页面边界仍视为不可信输入。只读取标准化 API client 的公开结构；
 * 不复制任意错误对象的 message、stack 或额外字段，getter/Proxy 异常统一 fail-closed。
 */
function getDictionaryMutationFailure<MutationField extends string>(
  error: unknown,
  fields: ReadonlySet<MutationField>,
  stateChangedCode: 'DICTIONARY_ITEM_STATE_CHANGED' | 'DICTIONARY_TYPE_STATE_CHANGED',
  duplicate?: Readonly<{
    code: string
    field: MutationField
  }>,
): DictionaryMutationFailure<MutationField> {
  const fallback = createFallbackMutationFailure<MutationField>()

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
    const fieldErrors: Partial<Record<MutationField, string>> = {}

    if (isRecord(body.fieldErrors)) {
      for (const [field, messages] of Object.entries(body.fieldErrors)) {
        if (
          fields.has(field as MutationField)
          && Array.isArray(messages)
          && typeof messages[0] === 'string'
        ) {
          fieldErrors[field as MutationField] = messages[0]
        }
      }
    }

    if (
      duplicate !== undefined
      && code === duplicate.code
      && fieldErrors[duplicate.field] === undefined
    ) {
      fieldErrors[duplicate.field] = message
    }

    return {
      code,
      fieldErrors,
      message,
      requestId: typeof body.requestId === 'string'
        ? body.requestId
        : undefined,
      stateChanged: error.status === 409
        && code === stateChangedCode,
      unknownResult: false,
    }
  }
  catch {
    return fallback
  }
}

export function getDictionaryTypeMutationFailure(
  error: unknown,
): DictionaryTypeMutationFailure {
  return getDictionaryMutationFailure(
    error,
    TYPE_MUTATION_FIELDS,
    'DICTIONARY_TYPE_STATE_CHANGED',
    {
      code: 'DICTIONARY_TYPE_CODE_ALREADY_EXISTS',
      field: 'code',
    },
  )
}

/**
 * Item create/update/status 共享同一错误白名单；稳定重复 value 映射到表单字段，
 * 并且只把自身并发错误码视为需要刷新最新 Item/version 的冲突。
 */
export function getDictionaryItemMutationFailure(
  error: unknown,
): DictionaryItemMutationFailure {
  return getDictionaryMutationFailure(
    error,
    ITEM_MUTATION_FIELDS,
    'DICTIONARY_ITEM_STATE_CHANGED',
    {
      code: 'DICTIONARY_ITEM_VALUE_ALREADY_EXISTS',
      field: 'value',
    },
  )
}

/** 保留 status 语义别名，避免调用方自行复制稳定错误码判断。 */
export function getDictionaryItemStatusMutationFailure(
  error: unknown,
): DictionaryItemMutationFailure {
  return getDictionaryItemMutationFailure(error)
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

/**
 * Item status 对账同时确认父子身份、自身状态与 effectiveEnabled 派生关系。
 * 列表缺失或任一字段不一致都保持 inconclusive，调用方不得自动重放写请求。
 */
export function matchesDictionaryItemStatus(
  item: Pick<
    DictionaryItemDto,
    'dictionaryTypeId' | 'effectiveEnabled' | 'enabled' | 'id'
  >,
  typeId: string,
  itemId: string,
  enabled: boolean,
  typeEnabled: boolean,
): boolean {
  return item.dictionaryTypeId === typeId
    && item.id === itemId
    && item.enabled === enabled
    && item.effectiveEnabled === (typeEnabled && enabled)
}

export function dictionaryStatusChangeCopy(
  action: DictionaryTypeStatusAction,
): DictionaryStatusChangeCopy {
  return DICTIONARY_STATUS_CHANGE_COPY[action]
}

/** Item 文案必须区分自身状态与由父 Type 共同决定的有效状态。 */
export function dictionaryItemStatusChangeCopy(
  action: DictionaryTypeStatusAction,
  type: Pick<DictionaryTypeDto, 'enabled'> | null,
): DictionaryStatusChangeCopy {
  if (action === 'enable') {
    return {
      confirmLabel: '确认启用',
      consequence: type?.enabled
        ? '确认后条目自身状态将变为启用；所属类型当前启用，因此有效状态也将变为启用。'
        : '所属类型当前停用；确认后条目自身状态将变为启用，但有效状态仍为停用。类型重新启用后，该条目将恢复有效。',
      description: '请核对条目稳定身份及启用后的有效状态。',
      title: '确认启用字典条目',
    }
  }

  return {
    confirmLabel: '确认停用',
    consequence: type?.enabled
      ? '确认后条目自身状态与有效状态都将变为停用；历史数据仍按原 value 回显。'
      : '确认后条目自身状态将变为停用；即使所属类型重新启用，该条目也不会恢复有效。历史数据仍按原 value 回显。',
    description: '请核对条目稳定身份及停用影响。',
    title: '确认停用字典条目',
  }
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
    expectedVersion: type.version,
    targetKind: 'type',
    typeId: type.id,
  }
}

/**
 * Item Modal 只提交完整、可复核的领域意图。父子身份不一致、重复提交、目标状态
 * 已达成或“启用 Type 的最后一个自身启用 Item”都 fail-closed；不能依据
 * effectiveEnabled 判断动作，因为父 Type 停用时它必然为 false。
 */
export function createDictionaryItemStatusChangeRequest(
  action: DictionaryTypeStatusAction,
  type: DictionaryStatusTarget | null,
  item: DictionaryItemStatusTarget | null,
  submitting: boolean,
): DictionaryItemStatusChangeRequest | null {
  if (
    submitting
    || type === null
    || item === null
    || item.dictionaryTypeId !== type.id
    || (action === 'enable' && item.enabled)
    || (action === 'disable' && !item.enabled)
    || (
      action === 'disable'
      && type.enabled
      && type.enabledItemCount <= 1
    )
  ) {
    return null
  }

  return {
    action,
    expectedVersion: item.version,
    itemId: item.id,
    targetKind: 'item',
    typeId: type.id,
  }
}
