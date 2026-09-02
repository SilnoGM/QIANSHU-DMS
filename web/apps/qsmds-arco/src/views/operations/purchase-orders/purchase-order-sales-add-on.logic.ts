export type SalesOrderAddOnWorkflowPhase
  = | 'idle'
    | 'candidate'
    | 'running'
    | 'sales-saved'
    | 'completed'
    | 'unknown'

export interface SalesOrderAddOnWorkflowState {
  readonly phase: SalesOrderAddOnWorkflowPhase
  readonly selectedSalesOrderId: string | null
  readonly candidateSalesOrderId: string | null
}

export function createSalesOrderAddOnState(
  selectedSalesOrderId: string | null,
): SalesOrderAddOnWorkflowState {
  return {
    phase: 'idle',
    selectedSalesOrderId,
    candidateSalesOrderId: null,
  }
}

/**
 * 选择第三视图候选时不得提前覆盖采购表单来源。只有销售追加 POST 已明确返回成功，
 * 候选才可提升为正式关联；取消、校验失败和确定失败均保留原关联。
 */
export function stageSalesOrderAddOnCandidate(
  state: SalesOrderAddOnWorkflowState,
  candidateSalesOrderId: string,
): SalesOrderAddOnWorkflowState {
  return {
    phase: 'candidate',
    selectedSalesOrderId: state.selectedSalesOrderId,
    candidateSalesOrderId,
  }
}

export function beginSalesOrderAddOn(
  state: SalesOrderAddOnWorkflowState,
): SalesOrderAddOnWorkflowState {
  if (state.phase !== 'candidate' || state.candidateSalesOrderId === null) {
    throw new TypeError('只有已准备的销售订单候选可以开始加购')
  }
  return { ...state, phase: 'running' }
}

export function markSalesOrderAddOnSaved(
  state: SalesOrderAddOnWorkflowState,
): SalesOrderAddOnWorkflowState {
  if (state.phase !== 'running' || state.candidateSalesOrderId === null) {
    throw new TypeError('只有运行中的加购可以确认销售保存成功')
  }
  return {
    ...state,
    phase: 'sales-saved',
    selectedSalesOrderId: state.candidateSalesOrderId,
  }
}

export function completeSalesOrderAddOn(
  state: SalesOrderAddOnWorkflowState,
): SalesOrderAddOnWorkflowState {
  if (state.phase !== 'sales-saved') {
    throw new TypeError('只有销售已保存的加购可以完成采购同步')
  }
  return { ...state, phase: 'completed' }
}

export function resolveSalesOrderAddOnFailure(
  state: SalesOrderAddOnWorkflowState,
  failure: { readonly stepIndex: number, readonly unknownResult: boolean },
): SalesOrderAddOnWorkflowState {
  if (failure.stepIndex === 0 && failure.unknownResult) {
    // POST 没有幂等键，未知结果不能猜测成功，也绝不自动重放。
    return { ...state, phase: 'unknown' }
  }
  if (state.phase === 'sales-saved') {
    return state
  }
  return { ...state, phase: 'candidate' }
}

function normalizeAmount(value: string): string | null {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,4}))?$/u.exec(value)
  if (match === null) {
    return null
  }
  return `${BigInt(match[1]!)}.${(match[2] ?? '').padEnd(4, '0')}`
}

/** 第 2 个加载步骤只核验第 1 步可信返回，不发送第二次写请求。 */
export function verifySalesOrderAddOnResult(input: {
  readonly expectedVersion: number
  readonly expectedAmountDelta: string
  readonly expectedAgreedTotalAmount: string
  readonly result: {
    readonly previousVersion: number
    readonly version: number
    readonly amountDelta: string
    readonly agreedTotalAmount: string
  }
}): boolean {
  return input.result.previousVersion === input.expectedVersion
    && input.result.version === input.expectedVersion + 1
    && normalizeAmount(input.result.amountDelta) === normalizeAmount(input.expectedAmountDelta)
    && normalizeAmount(input.result.agreedTotalAmount) === normalizeAmount(input.expectedAgreedTotalAmount)
}
