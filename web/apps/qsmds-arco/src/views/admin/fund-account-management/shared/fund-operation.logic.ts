import type { FundApiFailure } from './fund-request.logic'

export type FundFormKind
  = | 'ACCOUNT_CREATE'
    | 'MANUAL_ADJUSTMENT_BY_SHARE'
    | 'MANUAL_ADJUSTMENT_USER_ONLY'
    | 'REVERSAL'
    | 'SHARE_RATE_UPDATE'

export type FundFormPhase
  = | 'closed'
    | 'editing'
    | 'submitting'
    | 'succeeded'
    | 'unknown'

interface FundClosedFormState {
  readonly draft: null
  readonly failure: null
  readonly kind: FundFormKind
  readonly phase: 'closed'
}

interface FundActiveFormState<TDraft> {
  readonly draft: TDraft
  readonly failure: FundApiFailure | null
  readonly kind: FundFormKind
  readonly phase: Exclude<FundFormPhase, 'closed'>
}

export type FundFormState<TDraft>
  = | FundActiveFormState<TDraft>
    | FundClosedFormState

function closedState(kind: FundFormKind): FundClosedFormState {
  return Object.freeze({
    draft: null,
    failure: null,
    kind,
    phase: 'closed',
  })
}

function activeState<TDraft>(
  state: FundActiveFormState<TDraft>,
  phase: FundActiveFormState<TDraft>['phase'],
  failure: FundApiFailure | null,
): FundActiveFormState<TDraft> {
  return Object.freeze({
    draft: state.draft,
    failure,
    kind: state.kind,
    phase,
  })
}

/**
 * 开户、比例、两种调账和冲账共享相同的对话框生命周期，但通过 kind 保持业务
 * 分支显式可判别。状态对象不可变，页面只能通过纯 transition 推进，避免关闭后
 * 遗留 draft、错误或“结果未知”标志。
 */
export function createClosedFundFormState<TDraft>(
  kind: FundFormKind,
): FundFormState<TDraft> {
  return closedState(kind)
}

export function openFundForm<TDraft>(
  state: FundFormState<TDraft>,
  draft: TDraft,
): FundFormState<TDraft> {
  if (state.phase !== 'closed' && state.phase !== 'succeeded') {
    throw new TypeError('只能从已关闭或已成功状态打开资金表单')
  }
  return Object.freeze({
    draft,
    failure: null,
    kind: state.kind,
    phase: 'editing',
  })
}

export function beginFundFormSubmission<TDraft>(
  state: FundFormState<TDraft>,
): FundFormState<TDraft> {
  if (state.phase !== 'editing') {
    throw new TypeError('只有可编辑的资金表单能够提交')
  }
  return activeState(state, 'submitting', null)
}

export function failFundFormSubmission<TDraft>(
  state: FundFormState<TDraft>,
  failure: FundApiFailure,
): FundFormState<TDraft> {
  if (state.phase !== 'submitting') {
    throw new TypeError('只能处理当前资金提交的失败结果')
  }
  return activeState(
    state,
    failure.unknownResult ? 'unknown' : 'editing',
    failure,
  )
}

export function retryFundFormSubmission<TDraft>(
  state: FundFormState<TDraft>,
): FundFormState<TDraft> {
  if (state.phase !== 'unknown') {
    throw new TypeError('只有结果未知的资金表单能够执行人工重放')
  }
  return activeState(state, 'submitting', null)
}

export function completeFundFormSubmission<TDraft>(
  state: FundFormState<TDraft>,
): FundFormState<TDraft> {
  if (state.phase !== 'submitting') {
    throw new TypeError('只能完成当前正在提交的资金表单')
  }
  return activeState(state, 'succeeded', null)
}

/** 身份、权限或页面上下文改变时调用；任何活动状态都会丢弃业务草稿。 */
export function closeFundForm<TDraft>(
  state: FundFormState<TDraft>,
): FundFormState<TDraft> {
  return closedState(state.kind)
}
