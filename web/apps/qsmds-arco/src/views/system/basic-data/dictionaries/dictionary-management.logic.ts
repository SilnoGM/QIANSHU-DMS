import type { DictionaryTypeListQuery } from '@/api/modules/dictionaries'

export type DictionaryAccessState = 'active' | 'forbidden'
export type DictionaryQueryState
  = | 'empty'
    | 'error'
    | 'idle'
    | 'loading'
    | 'ready'
    | 'refreshing'
export type DictionaryMutationState
  = | 'closed'
    | 'editing'
    | 'error'
    | 'reconciling'
    | 'submitting'

export type DictionarySelectionState
  = | {
    readonly kind: 'none'
    readonly typeId: null
  }
  | {
    readonly kind: 'selected'
    readonly typeId: string
  }

export interface DictionaryManagementState {
  readonly access: DictionaryAccessState
  readonly itemQuery: DictionaryQueryState
  readonly mutation: DictionaryMutationState
  readonly selection: DictionarySelectionState
  readonly typeQuery: DictionaryQueryState
}

export interface DictionaryAccessTransition {
  readonly nextState: DictionaryManagementState
  readonly shouldAbortQueries: boolean
  readonly shouldClearProtectedData: boolean
  readonly shouldCloseOverlays: boolean
  readonly shouldReload: boolean
}

export type DictionaryQueryEvent
  = | {
    readonly hasData: boolean
    readonly type: 'request'
  }
  | {
    readonly itemCount: number
    readonly type: 'success'
  }
  | { readonly type: 'failure' | 'reset' }

export type DictionaryMutationEvent
  = | 'authority-loss'
    | 'cancel'
    | 'complete'
    | 'fail'
    | 'known-failure'
    | 'open'
    | 'resume-editing'
    | 'submit'
    | 'unknown-result'

export type DictionaryTypeEmptyKind = 'filtered' | 'system'

export interface BuildDictionaryTypeListQueryInput {
  readonly page: number
  readonly pageSize: number
  readonly search: string
  readonly status: unknown
}

export interface DictionaryQueryResponseGuardInput {
  readonly aborted: boolean
  readonly authorized: boolean
  readonly authEpoch: number
  readonly currentAuthEpoch: number
  readonly latestRequestVersion: number
  readonly requestVersion: number
}

export interface DictionaryItemResponseGuardInput
  extends DictionaryQueryResponseGuardInput {
  readonly currentTypeId: string | null
  readonly requestedTypeId: string
}

export interface DictionaryMutationResultGuardInput {
  readonly authorized: boolean
  readonly authEpoch: number
  readonly currentAuthEpoch: number
  readonly currentTargetId: string | null
  readonly latestMutationVersion: number
  readonly mutationVersion: number
  readonly targetId: string | null
}

const TYPE_PAGE_SIZES = new Set([20, 50, 100])
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu

/**
 * Type 查询始终走 Server；这里只规范化用户输入和受控分页，不做前端过滤。
 * Unicode 空白折叠与 Server 查询 normalizer 保持相同展示文本口径。
 */
export function buildDictionaryTypeListQuery(
  input: BuildDictionaryTypeListQueryInput,
): DictionaryTypeListQuery {
  const page = Number.isSafeInteger(input.page) && input.page > 0
    ? input.page
    : 1
  const pageSize = TYPE_PAGE_SIZES.has(input.pageSize)
    ? input.pageSize
    : 20
  const query = input.search
    .normalize('NFC')
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .trim()
  const status = input.status === 'ENABLED' || input.status === 'DISABLED'
    ? input.status
    : undefined

  return {
    page,
    pageSize,
    ...(query === '' ? {} : { query }),
    sortBy: 'sortOrder',
    sortOrder: 'asc',
    ...(status === undefined ? {} : { status }),
  }
}

/** 当前选择仍可见时保留，否则迁移到首个可见 Type；空页必须清空 Item 上下文。 */
export function resolveDictionaryTypeSelection(
  visibleTypes: readonly { readonly id: string }[],
  currentTypeId: string | null,
): DictionarySelectionState {
  if (
    currentTypeId !== null
    && visibleTypes.some(type => type.id === currentTypeId)
  ) {
    return createDictionarySelection(currentTypeId)
  }
  return createDictionarySelection(visibleTypes[0]?.id ?? null)
}

/** 带搜索或状态条件的零结果不能伪装成系统从未配置过字典。 */
export function resolveDictionaryTypeEmptyKind(input: {
  readonly search: string
  readonly status: unknown
}): DictionaryTypeEmptyKind {
  return input.search
    .replace(UNICODE_WHITESPACE_PATTERN, '') !== ''
    || input.status === 'ENABLED'
    || input.status === 'DISABLED'
    ? 'filtered'
    : 'system'
}

/**
 * 状态写入可能把筛选末页的最后一项移出结果集。Server 返回 total 后仅在当前页
 * 已空且确实越界时回退，避免把仍有数据的筛选误显示为空态。
 */
export function resolveDictionaryTypeResponsePage(input: {
  readonly itemCount: number
  readonly page: number
  readonly pageSize: number
  readonly total: number
}): number {
  if (input.itemCount > 0 || input.total <= 0 || input.pageSize <= 0) {
    return input.page
  }
  const lastPage = Math.max(1, Math.ceil(input.total / input.pageSize))
  return input.page > lastPage ? lastPage : input.page
}

export function createDictionarySelection(
  typeId: string | null,
): DictionarySelectionState {
  if (typeId === null || typeId === '') {
    return {
      kind: 'none',
      typeId: null,
    }
  }
  return {
    kind: 'selected',
    typeId,
  }
}

/**
 * 页面状态只保存有限状态机，不在这里持有 DTO、Axios、Vue Ref 或 Router。
 * 每次都创建新的 selection 对象，避免身份切换后意外复用旧的受保护上下文。
 */
export function createDictionaryManagementState(
  authorized: boolean,
): DictionaryManagementState {
  return {
    access: authorized ? 'active' : 'forbidden',
    itemQuery: 'idle',
    mutation: 'closed',
    selection: createDictionarySelection(null),
    typeQuery: 'idle',
  }
}

/**
 * authEpoch 变化表示身份边界变化，即使新旧身份都拥有读取权限，也必须先清空旧数据。
 * 同一身份内撤权不会推进 authEpoch，因此 access 变化同样要触发完整清理。
 */
export function resolveDictionaryAccessTransition(input: {
  readonly authorized: boolean
  readonly identityChanged: boolean
  readonly previousState: DictionaryManagementState
}): DictionaryAccessTransition {
  const nextAccess: DictionaryAccessState = input.authorized
    ? 'active'
    : 'forbidden'
  const boundaryChanged = input.identityChanged
    || input.previousState.access !== nextAccess

  if (!boundaryChanged) {
    return {
      nextState: input.previousState,
      shouldAbortQueries: false,
      shouldClearProtectedData: false,
      shouldCloseOverlays: false,
      shouldReload: false,
    }
  }

  return {
    nextState: createDictionaryManagementState(input.authorized),
    shouldAbortQueries: true,
    shouldClearProtectedData: true,
    shouldCloseOverlays: true,
    shouldReload: input.authorized,
  }
}

/**
 * query 的数据数组由页面持有；状态机只区分首次加载与保留旧数据刷新。
 * Abort 不进入 failure，旧请求会由响应归属守卫直接丢弃。
 */
export function transitionDictionaryQueryState(
  current: DictionaryQueryState,
  event: DictionaryQueryEvent,
): DictionaryQueryState {
  switch (event.type) {
    case 'request':
      return event.hasData ? 'refreshing' : 'loading'
    case 'success':
      return event.itemCount > 0 ? 'ready' : 'empty'
    case 'failure':
      return 'error'
    case 'reset':
      return 'idle'
    default:
      return current
  }
}

/**
 * Mutation 无法像 GET 一样安全取消。普通 cancel 不得关闭正在提交或核对结果的操作，
 * 但 authority-loss 必须绕过这些保护并清除 UI 上下文。
 */
export function transitionDictionaryMutationState(
  current: DictionaryMutationState,
  event: DictionaryMutationEvent,
): DictionaryMutationState {
  if (event === 'authority-loss') {
    return 'closed'
  }

  switch (event) {
    case 'open':
      return current === 'closed' ? 'editing' : current
    case 'resume-editing':
      // 只供页面在成功读取最新冲突快照后显式恢复；未知结果本身不能直接重提。
      return current === 'error' ? 'editing' : current
    case 'submit':
      // error 可能来自结果未知后的 reconciliation 失败，不能把通用重试解释为重放写请求。
      return current === 'editing' ? 'submitting' : current
    case 'known-failure':
      // Server 已明确拒绝写入时可安全修正后重提，不等同于网络结果未知。
      return current === 'submitting' ? 'editing' : current
    case 'unknown-result':
      return current === 'submitting' ? 'reconciling' : current
    case 'fail':
      return current === 'editing'
        || current === 'submitting'
        || current === 'reconciling'
        ? 'error'
        : current
    case 'complete':
      return current === 'submitting' || current === 'reconciling'
        ? 'closed'
        : current
    case 'cancel':
      return current === 'editing' || current === 'error'
        ? 'closed'
        : current
    default:
      return current
  }
}

/**
 * Abort 只是主动取消信号，不代表响应一定不会到达；因此仍需同时验证权限、
 * authEpoch 与单调 request version，缺一不可。
 */
export function canApplyDictionaryQueryResponse(
  input: DictionaryQueryResponseGuardInput,
): boolean {
  return input.authorized
    && !input.aborted
    && input.authEpoch === input.currentAuthEpoch
    && input.requestVersion === input.latestRequestVersion
}

/** Item 查询额外绑定请求发起时的 Type，阻止 A-B-A 切换中的旧响应回写。 */
export function canApplyDictionaryItemResponse(
  input: DictionaryItemResponseGuardInput,
): boolean {
  return canApplyDictionaryQueryResponse(input)
    && input.currentTypeId !== null
    && input.requestedTypeId === input.currentTypeId
}

/**
 * Mutation 的迟到结果只允许回写原身份、原代次和仍打开的同一目标上下文。
 * target 被清空即表示浮层已关闭，null/null 不能被误判为仍可回写。
 */
export function canApplyDictionaryMutationResult(
  input: DictionaryMutationResultGuardInput,
): boolean {
  return input.authorized
    && input.authEpoch === input.currentAuthEpoch
    && input.mutationVersion === input.latestMutationVersion
    && input.targetId !== null
    && input.targetId === input.currentTargetId
}

/** 兼容 DOM 与 Axios 的取消形态；读取不可信错误对象时失败关闭。 */
export function isDictionaryAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  try {
    const candidate = error as {
      readonly code?: unknown
      readonly name?: unknown
    }
    return candidate.name === 'AbortError'
      || candidate.name === 'CanceledError'
      || candidate.code === 'ERR_CANCELED'
  }
  catch {
    return false
  }
}
