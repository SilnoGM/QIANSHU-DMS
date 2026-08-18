import type { FundPostingBatchDetailDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 纯状态逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildFundAccountCreateRequest,
  buildFundManualAdjustmentRequest,
  buildFundReversalRequest,
  buildFundShareRateRequest,
  calculateFundAdjustmentPreview,
} from '../../src/views/admin/fund-account-management/shared/fund-money.logic'
import {
  beginFundFormSubmission,
  closeFundForm,
  completeFundFormSubmission,
  createClosedFundFormState,
  failFundFormSubmission,
  openFundForm,
  retryFundFormSubmission,
} from '../../src/views/admin/fund-account-management/shared/fund-operation.logic'
import {
  abandonFundIdempotentSubmission,
  applyFundBatchDetail,
  beginFundIdempotentSubmission,
  canApplyFundResponse,
  clearFundIdempotentSubmission,
  closeFundBatchDetail,
  completeFundIdempotentSubmission,
  createClosedFundBatchDetailState,
  createFundIdempotentSubmissionState,
  failFundBatchDetail,
  failFundIdempotentSubmission,
  getFundApiFailure,
  isFundAbortError,
  retryFundIdempotentSubmission,
  startFundBatchDetailLoad,
} from '../../src/views/admin/fund-account-management/shared/fund-request.logic'

function batchDetailFixture(): FundPostingBatchDetailDto {
  return {
    actorUserId: 'admin-id',
    adjustmentMode: 'USER_ONLY',
    batchNo: 'FB202608180001',
    businessAmount: '-100.0000',
    businessCategory: 'REVENUE',
    businessId: 'order-id',
    businessNo: '0000011',
    businessOccurredAt: '2026-08-18T01:00:00.000Z',
    businessSourceCode: 'ORDER_DOMAIN',
    businessSourceId: 'source-id',
    businessSourceName: '订单域',
    companyShareRateSnapshot: '70.0000',
    correlationId: null,
    currency: 'CNY',
    entries: [],
    id: 'batch-id',
    kind: 'BUSINESS',
    metadata: { orderNo: '0000011' },
    postedAt: '2026-08-18T01:00:01.000Z',
    postingTypeCode: 'ORDER_SETTLEMENT',
    postingTypeId: 'posting-type-id',
    postingTypeName: '订单结算',
    requestId: 'request-id',
    reversalChain: {
      originalAmount: '100.0000',
      originalBatchId: 'batch-id',
      originalBatchNo: 'FB202608180001',
      remainingAmount: '100.0000',
      reversals: [],
      reversedAmount: '0.0000',
      status: 'NONE',
    },
    reversalOfBatchId: null,
    reversalReason: null,
    ruleRevision: 1,
    ruleVersionId: 'rule-version-id',
    summary: '订单 0000011 亏损结算',
    user: {
      displayName: '测试用户',
      id: 'user-id',
      status: 'ACTIVE',
      username: 'tester',
    },
    userShareRateSnapshot: '30.0000',
  }
}

test('开户、比例、两种调账和冲账请求只输出 generated DTO 可接受的规范字符串', () => {
  assert.deepEqual(
    buildFundAccountCreateRequest(' user-id ', '30'),
    { userId: 'user-id', userShareRate: '30.0000' },
  )
  assert.deepEqual(
    buildFundShareRateRequest('45.5', 7, '  调整未来分成  '),
    {
      expectedVersion: 7,
      reason: '调整未来分成',
      userShareRate: '45.5000',
    },
  )
  assert.deepEqual(
    buildFundManualAdjustmentRequest(
      '-100',
      'USER_ONLY',
      '  用户余额调减  ',
      { ticket: 'A-1' },
    ),
    {
      adjustmentMode: 'USER_ONLY',
      amount: '-100.0000',
      metadata: { ticket: 'A-1' },
      reason: '用户余额调减',
    },
  )
  assert.deepEqual(
    buildFundManualAdjustmentRequest(
      '100.1',
      'USER_AND_COMPANY_BY_SHARE',
      '共同调增',
    ),
    {
      adjustmentMode: 'USER_AND_COMPANY_BY_SHARE',
      amount: '100.1000',
      reason: '共同调增',
    },
  )
  assert.deepEqual(
    buildFundReversalRequest('40', '100.0000', ' 部分冲账 '),
    { amount: '40.0000', reason: '部分冲账' },
  )

  for (const invalid of ['0', '-0', '01', '+1', '1e2', '1.00000']) {
    assert.throws(
      () => buildFundManualAdjustmentRequest(
        invalid,
        'USER_ONLY',
        '原因',
      ),
    )
  }
  assert.throws(() => buildFundAccountCreateRequest('', '30'))
  assert.throws(() => buildFundAccountCreateRequest('user-id', '100.0001'))
  assert.throws(() => buildFundShareRateRequest('30', -1, '原因'))
  assert.throws(() => buildFundReversalRequest('-1', '100', '原因'))
  assert.throws(() => buildFundReversalRequest('100.0001', '100', '原因'))
})

test('调账预览复用 Server 四位 HALF_UP 和公司尾差语义且始终返回字符串', () => {
  assert.deepEqual(calculateFundAdjustmentPreview({
    adjustmentMode: 'USER_ONLY',
    amount: '-100',
    companyBalance: '50',
    userBalance: '20',
    userShareRate: '30',
  }), {
    businessAmount: '-100.0000',
    companyAmount: '0.0000',
    companyBalanceAfter: '50.0000',
    companyShareRate: '70.0000',
    userAmount: '-100.0000',
    userBalanceAfter: '-80.0000',
    userShareRate: '30.0000',
  })
  assert.deepEqual(calculateFundAdjustmentPreview({
    adjustmentMode: 'USER_AND_COMPANY_BY_SHARE',
    amount: '-100',
    companyBalance: '50',
    userBalance: '20',
    userShareRate: '30',
  }), {
    businessAmount: '-100.0000',
    companyAmount: '-70.0000',
    companyBalanceAfter: '-20.0000',
    companyShareRate: '70.0000',
    userAmount: '-30.0000',
    userBalanceAfter: '-10.0000',
    userShareRate: '30.0000',
  })
  assert.deepEqual(calculateFundAdjustmentPreview({
    adjustmentMode: 'USER_AND_COMPANY_BY_SHARE',
    amount: '0.0001',
    companyBalance: '0',
    userBalance: '0',
    userShareRate: '50',
  }), {
    businessAmount: '0.0001',
    companyAmount: '0.0000',
    companyBalanceAfter: '0.0000',
    companyShareRate: '50.0000',
    userAmount: '0.0001',
    userBalanceAfter: '0.0001',
    userShareRate: '50.0000',
  })

  const large = calculateFundAdjustmentPreview({
    adjustmentMode: 'USER_AND_COMPANY_BY_SHARE',
    amount: '99999999999999999999999999.9999',
    companyBalance: '-1',
    userBalance: '1',
    userShareRate: '33.3333',
  })
  assert.equal(large.userAmount, '33333300000000000000000000.0000')
  assert.equal(large.companyAmount, '66666699999999999999999999.9999')
  assert.equal(
    Object.values(large).every(value => typeof value === 'string'),
    true,
  )
})

test('GET 响应必须同时通过 Abort、版本、身份和权限四重守卫', () => {
  const current = {
    aborted: false,
    authEpoch: 8,
    authorized: true,
    currentAuthEpoch: 8,
    latestRequestVersion: 3,
    requestVersion: 3,
  }
  assert.equal(canApplyFundResponse(current), true)

  for (const stale of [
    { ...current, aborted: true },
    { ...current, authorized: false },
    { ...current, currentAuthEpoch: 9 },
    { ...current, latestRequestVersion: 4 },
  ]) {
    assert.equal(canApplyFundResponse(stale), false)
  }
})

test('Axios 和 DOM 取消错误不会进入普通资金失败呈现', () => {
  assert.equal(isFundAbortError({ code: 'ERR_CANCELED' }), true)
  assert.equal(isFundAbortError({ name: 'CanceledError' }), true)
  assert.equal(isFundAbortError(new DOMException('', 'AbortError')), true)
  assert.equal(isFundAbortError({ code: 'NETWORK_ERROR' }), false)
})

test('资金错误映射把 network/5xx 视为结果未知，4xx 解锁并只读取安全字段', () => {
  assert.deepEqual(getFundApiFailure({
    kind: 'network',
    message: '网络连接失败，请稍后重试',
  }), {
    code: undefined,
    fieldErrors: {},
    message: '网络连接失败，请稍后重试',
    requestId: undefined,
    status: undefined,
    unknownResult: true,
  })
  assert.equal(getFundApiFailure({
    body: {
      code: 'INTERNAL_ERROR',
      message: '资金操作失败',
      requestId: 'request-500',
    },
    kind: 'http',
    status: 500,
  }).unknownResult, true)

  assert.deepEqual(getFundApiFailure({
    body: {
      code: 'VALIDATION_FAILED',
      fieldErrors: {
        amount: ['金额无效', '第二条不展示'],
        reason: ['原因不能为空'],
      },
      message: '请求参数无效',
      requestId: 'request-422',
    },
    kind: 'http',
    status: 422,
  }), {
    code: 'VALIDATION_FAILED',
    fieldErrors: {
      amount: '金额无效',
      reason: '原因不能为空',
    },
    message: '请求参数无效',
    requestId: 'request-422',
    status: 422,
    unknownResult: false,
  })
  assert.equal(
    getFundApiFailure(new Error('secret database connection')).message,
    '资金操作失败，请稍后重试',
  )
})

test('开户、比例、两种调账和冲账共用可清空的纯表单状态机', () => {
  const kinds = [
    'ACCOUNT_CREATE',
    'SHARE_RATE_UPDATE',
    'MANUAL_ADJUSTMENT_USER_ONLY',
    'MANUAL_ADJUSTMENT_BY_SHARE',
    'REVERSAL',
  ] as const
  const knownFailure = getFundApiFailure({
    body: {
      code: 'VALIDATION_FAILED',
      message: '请求无效',
      requestId: 'request-id',
    },
    kind: 'http',
    status: 422,
  })
  const unknownFailure = getFundApiFailure({
    body: {
      code: 'INTERNAL_ERROR',
      message: '处理失败',
      requestId: 'request-id',
    },
    kind: 'http',
    status: 500,
  })

  for (const kind of kinds) {
    let state = createClosedFundFormState<{ amount: string }>(kind)
    assert.equal(state.phase, 'closed')
    state = openFundForm(state, { amount: '1' })
    assert.equal(state.phase, 'editing')
    state = beginFundFormSubmission(state)
    assert.equal(state.phase, 'submitting')
    state = failFundFormSubmission(state, knownFailure)
    assert.equal(state.phase, 'editing')
    state = beginFundFormSubmission(state)
    state = failFundFormSubmission(state, unknownFailure)
    assert.equal(state.phase, 'unknown')
    state = retryFundFormSubmission(state)
    assert.equal(state.phase, 'submitting')
    state = completeFundFormSubmission(state)
    assert.equal(state.phase, 'succeeded')
    state = closeFundForm(state)
    assert.deepEqual(state, {
      draft: null,
      failure: null,
      kind,
      phase: 'closed',
    })
  }
})

test('批次详情状态机只接收当前 batchId，关闭后清除历史详情和错误', () => {
  let state = createClosedFundBatchDetailState()
  state = startFundBatchDetailLoad(state, 'batch-id')
  assert.equal(state.phase, 'loading')
  assert.throws(() => applyFundBatchDetail(state, {
    ...batchDetailFixture(),
    id: 'stale-batch-id',
  }))
  state = applyFundBatchDetail(state, batchDetailFixture())
  assert.equal(state.phase, 'ready')
  assert.equal(state.detail.businessNo, '0000011')

  state = startFundBatchDetailLoad(state, 'batch-id')
  state = failFundBatchDetail(state, getFundApiFailure({
    body: {
      code: 'NOT_FOUND',
      message: '批次不存在',
      requestId: 'request-id',
    },
    kind: 'http',
    status: 404,
  }))
  assert.equal(state.phase, 'failed')
  state = closeFundBatchDetail(state)
  assert.deepEqual(state, {
    batchId: null,
    detail: null,
    failure: null,
    phase: 'closed',
  })
})

test('幂等键仅在首次有效提交生成，network/5xx 冻结而 4xx 清除', () => {
  let keySequence = 0
  const createKey = () => `fund-key-${++keySequence}`
  let context = createFundIdempotentSubmissionState<{
    amount: string
    metadata: { ticket: string }
  }>()

  assert.throws(() => beginFundIdempotentSubmission(
    context,
    () => {
      throw new RangeError('金额无效')
    },
    createKey,
  ))
  assert.equal(keySequence, 0)

  const payload = { amount: '-100.0000', metadata: { ticket: 'A-1' } }
  context = beginFundIdempotentSubmission(
    context,
    () => payload,
    createKey,
  )
  assert.equal(context.phase, 'submitting')
  assert.equal(context.submission.idempotencyKey, 'fund-key-1')
  assert.notEqual(context.submission.payload, payload)
  payload.metadata.ticket = 'mutated-after-submit'
  assert.equal(context.submission.payload.metadata.ticket, 'A-1')
  assert.equal(Object.isFrozen(context.submission.payload.metadata), true)

  context = failFundIdempotentSubmission(
    context,
    getFundApiFailure({ kind: 'network', message: '网络失败' }),
  )
  assert.equal(context.phase, 'unknown')
  const frozenSubmission = context.submission
  context = retryFundIdempotentSubmission(context)
  assert.equal(context.phase, 'submitting')
  assert.equal(context.submission, frozenSubmission)
  assert.equal(keySequence, 1)

  context = failFundIdempotentSubmission(
    context,
    getFundApiFailure({
      body: {
        code: 'VALIDATION_FAILED',
        message: '金额无效',
        requestId: 'request-id',
      },
      kind: 'http',
      status: 422,
    }),
  )
  assert.deepEqual(context, {
    failure: null,
    phase: 'idle',
    submission: null,
  })

  context = beginFundIdempotentSubmission(
    context,
    () => ({ amount: '40.0000', metadata: { ticket: 'R-1' } }),
    createKey,
  )
  assert.equal(context.submission.idempotencyKey, 'fund-key-2')
  context = completeFundIdempotentSubmission(context)
  assert.equal(context.phase, 'idle')
  assert.equal(context.submission, null)

  context = beginFundIdempotentSubmission(
    context,
    () => ({ amount: '10.0000', metadata: { ticket: 'R-2' } }),
    createKey,
  )
  context = failFundIdempotentSubmission(
    context,
    getFundApiFailure({
      body: {
        code: 'INTERNAL_ERROR',
        message: '处理失败',
        requestId: 'request-id',
      },
      kind: 'http',
      status: 503,
    }),
  )
  assert.equal(context.phase, 'unknown')
  context = abandonFundIdempotentSubmission(context)
  assert.equal(context.phase, 'idle')
  assert.equal(context.submission, null)
})

test('身份或权限变化可以从在途状态直接销毁幂等 key/payload', () => {
  let context = createFundIdempotentSubmissionState<{ amount: string }>()
  context = beginFundIdempotentSubmission(
    context,
    () => ({ amount: '-10.0000' }),
    () => 'fund-key',
  )
  assert.equal(context.phase, 'submitting')

  context = clearFundIdempotentSubmission(context)
  assert.deepEqual(context, {
    failure: null,
    phase: 'idle',
    submission: null,
  })
})
