import type { FundPostingBatchDetailDto } from '@/api/generated/types.gen'

export interface FundResponseGuardInput {
  readonly aborted: boolean
  readonly authEpoch: number
  readonly authorized: boolean
  readonly currentAuthEpoch: number
  readonly latestRequestVersion: number
  readonly requestVersion: number
}

export interface FundApiFailure {
  readonly code: string | undefined
  readonly fieldErrors: Readonly<Record<string, string>>
  readonly message: string
  readonly requestId: string | undefined
  readonly status: number | undefined
  readonly unknownResult: boolean
}

export interface FundFrozenSubmission<TPayload extends object> {
  readonly idempotencyKey: string
  readonly payload: Readonly<TPayload>
}

export type FundIdempotentSubmissionState<TPayload extends object>
  = | {
    readonly failure: FundApiFailure
    readonly phase: 'unknown'
    readonly submission: FundFrozenSubmission<TPayload>
  }
  | {
    readonly failure: null
    readonly phase: 'idle'
    readonly submission: null
  }
  | {
    readonly failure: null
    readonly phase: 'submitting'
    readonly submission: FundFrozenSubmission<TPayload>
  }

export type FundBatchDetailState
  = | {
    readonly batchId: null
    readonly detail: null
    readonly failure: null
    readonly phase: 'closed'
  }
  | {
    readonly batchId: string
    readonly detail: null
    readonly failure: FundApiFailure
    readonly phase: 'failed'
  }
  | {
    readonly batchId: string
    readonly detail: null
    readonly failure: null
    readonly phase: 'loading'
  }
  | {
    readonly batchId: string
    readonly detail: FundPostingBatchDetailDto
    readonly failure: null
    readonly phase: 'ready'
  }

const FUND_FAILURE_MESSAGE = '资金操作失败，请稍后重试' as const
const FUND_NETWORK_MESSAGE = '网络连接失败，请稍后重试' as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 请求被取消、同一资源已有更新请求、身份 epoch 改变或权限被撤销时，迟到响应
 * 都不得进入页面状态。调用方仍需在边界变化时 abort controller 并清空本地数据；
 * 此纯函数承担最后一道“旧响应不能复活旧数据”的防线。
 */
export function canApplyFundResponse(input: FundResponseGuardInput): boolean {
  return !input.aborted
    && input.authorized
    && input.authEpoch === input.currentAuthEpoch
    && input.requestVersion === input.latestRequestVersion
}

export function isFundAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (
    isRecord(error) && (
      error.code === 'ERR_CANCELED'
      || error.name === 'CanceledError'
    )
  )
}

function safeStatus(value: unknown): number | undefined {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 100
    && value <= 599
    ? value
    : undefined
}

function readFieldErrors(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) {
    return Object.freeze({})
  }

  const fieldErrors: Record<string, string> = {}
  for (const [field, messages] of Object.entries(value)) {
    if (Array.isArray(messages) && typeof messages[0] === 'string') {
      fieldErrors[field] = messages[0]
    }
  }
  return Object.freeze(fieldErrors)
}

/**
 * 只读取统一 API client 暴露的结构化错误，不透传 Error.message、stack、请求配置
 * 或响应 payload。资金 mutation 对 network 和任意 5xx 都采取保守的“结果未知”
 * 语义；4xx 是确定拒绝，可清除幂等上下文并重新开放编辑。
 */
export function getFundApiFailure(error: unknown): FundApiFailure {
  const fallback: FundApiFailure = Object.freeze({
    code: undefined,
    fieldErrors: Object.freeze({}),
    message: FUND_FAILURE_MESSAGE,
    requestId: undefined,
    status: undefined,
    unknownResult: false,
  })

  try {
    if (!isRecord(error)) {
      return fallback
    }
    if (error.kind === 'network') {
      return Object.freeze({
        ...fallback,
        message: FUND_NETWORK_MESSAGE,
        unknownResult: true,
      })
    }

    const status = safeStatus(error.status)
    if (error.kind === 'http-unparseable') {
      return Object.freeze({
        ...fallback,
        message: typeof error.message === 'string'
          ? error.message
          : FUND_FAILURE_MESSAGE,
        requestId: typeof error.requestId === 'string'
          ? error.requestId
          : undefined,
        status,
        unknownResult: status !== undefined && status >= 500,
      })
    }
    if (error.kind !== 'http' || !isRecord(error.body)) {
      return fallback
    }

    const body = error.body
    return Object.freeze({
      code: typeof body.code === 'string' ? body.code : undefined,
      fieldErrors: readFieldErrors(body.fieldErrors),
      message: typeof body.message === 'string'
        ? body.message
        : FUND_FAILURE_MESSAGE,
      requestId: typeof body.requestId === 'string'
        ? body.requestId
        : typeof error.requestId === 'string'
          ? error.requestId
          : undefined,
      status,
      unknownResult: status !== undefined && status >= 500,
    })
  }
  catch {
    return fallback
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!isRecord(value) && !Array.isArray(value)) {
    return value
  }
  if (seen.has(value)) {
    return value
  }
  seen.add(value)
  for (const nested of Object.values(value)) {
    deepFreeze(nested, seen)
  }
  return Object.freeze(value)
}

function freezeSubmission<TPayload extends object>(
  payload: TPayload,
  idempotencyKey: string,
): FundFrozenSubmission<TPayload> {
  if (idempotencyKey.length === 0) {
    throw new RangeError('幂等键不能为空')
  }

  // structuredClone 先切断表单响应式对象引用；随后递归冻结，确保未知结果重放时
  // key 与 payload 始终是首次有效提交的同一不可变快照。
  const payloadSnapshot = deepFreeze(structuredClone(payload))
  return Object.freeze({ idempotencyKey, payload: payloadSnapshot })
}

export function createFundIdempotentSubmissionState<
  TPayload extends object,
>(): FundIdempotentSubmissionState<TPayload> {
  return Object.freeze({
    failure: null,
    phase: 'idle',
    submission: null,
  })
}

/** 身份、权限或页面上下文变化时，无条件销毁包括在途请求在内的幂等快照。 */
export function clearFundIdempotentSubmission<TPayload extends object>(
  _state: FundIdempotentSubmissionState<TPayload>,
): FundIdempotentSubmissionState<TPayload> {
  return createFundIdempotentSubmissionState<TPayload>()
}

/**
 * createPayload 必须先完成表单校验和 DTO 规范化；只有它成功返回后才调用 key
 * factory。因此无效点击不会消耗幂等键，也不会把半成品 payload 冻结为可重放请求。
 */
export function beginFundIdempotentSubmission<TPayload extends object>(
  state: FundIdempotentSubmissionState<TPayload>,
  createPayload: () => TPayload,
  createIdempotencyKey: () => string,
): FundIdempotentSubmissionState<TPayload> {
  if (state.phase !== 'idle') {
    throw new TypeError('已有资金幂等提交上下文')
  }
  const payload = createPayload()
  const submission = freezeSubmission(payload, createIdempotencyKey())
  return Object.freeze({
    failure: null,
    phase: 'submitting',
    submission,
  })
}

export function failFundIdempotentSubmission<TPayload extends object>(
  state: FundIdempotentSubmissionState<TPayload>,
  failure: FundApiFailure,
): FundIdempotentSubmissionState<TPayload> {
  if (state.phase !== 'submitting') {
    throw new TypeError('只能处理当前资金幂等提交的失败结果')
  }
  if (!failure.unknownResult) {
    return createFundIdempotentSubmissionState<TPayload>()
  }
  return Object.freeze({
    failure,
    phase: 'unknown',
    submission: state.submission,
  })
}

export function retryFundIdempotentSubmission<TPayload extends object>(
  state: FundIdempotentSubmissionState<TPayload>,
): FundIdempotentSubmissionState<TPayload> {
  if (state.phase !== 'unknown') {
    throw new TypeError('只有结果未知的资金请求能够人工重放')
  }
  return Object.freeze({
    failure: null,
    phase: 'submitting',
    submission: state.submission,
  })
}

export function completeFundIdempotentSubmission<TPayload extends object>(
  state: FundIdempotentSubmissionState<TPayload>,
): FundIdempotentSubmissionState<TPayload> {
  if (state.phase !== 'submitting') {
    throw new TypeError('只能完成当前资金幂等提交')
  }
  return createFundIdempotentSubmissionState<TPayload>()
}

/** 管理员明确放弃重放或身份/权限变化时，销毁冻结的 key/payload。 */
export function abandonFundIdempotentSubmission<TPayload extends object>(
  state: FundIdempotentSubmissionState<TPayload>,
): FundIdempotentSubmissionState<TPayload> {
  if (state.phase !== 'unknown') {
    throw new TypeError('只有结果未知的资金请求能够明确放弃')
  }
  return createFundIdempotentSubmissionState<TPayload>()
}

export function createClosedFundBatchDetailState(): FundBatchDetailState {
  return Object.freeze({
    batchId: null,
    detail: null,
    failure: null,
    phase: 'closed',
  })
}

export function startFundBatchDetailLoad(
  _state: FundBatchDetailState,
  batchId: string,
): FundBatchDetailState {
  if (batchId.trim() === '') {
    throw new RangeError('批次标识不能为空')
  }
  return Object.freeze({
    batchId,
    detail: null,
    failure: null,
    phase: 'loading',
  })
}

export function applyFundBatchDetail(
  state: FundBatchDetailState,
  detail: FundPostingBatchDetailDto,
): FundBatchDetailState {
  if (state.phase !== 'loading' || state.batchId !== detail.id) {
    throw new TypeError('批次详情响应不属于当前加载上下文')
  }
  return Object.freeze({
    batchId: state.batchId,
    detail,
    failure: null,
    phase: 'ready',
  })
}

export function failFundBatchDetail(
  state: FundBatchDetailState,
  failure: FundApiFailure,
): FundBatchDetailState {
  if (state.phase !== 'loading') {
    throw new TypeError('只能处理当前批次详情请求的失败结果')
  }
  return Object.freeze({
    batchId: state.batchId,
    detail: null,
    failure,
    phase: 'failed',
  })
}

/** 关闭详情或跨越身份/权限边界时，不保留任何批次快照。 */
export function closeFundBatchDetail(
  _state: FundBatchDetailState,
): FundBatchDetailState {
  return createClosedFundBatchDetailState()
}
