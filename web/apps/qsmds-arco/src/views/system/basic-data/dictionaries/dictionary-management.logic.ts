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
    | 'open'
    | 'submit'
    | 'unknown-result'

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
    case 'submit':
      // error 可能来自结果未知后的 reconciliation 失败，不能把通用重试解释为重放写请求。
      return current === 'editing' ? 'submitting' : current
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
