import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 加购状态机纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  beginSalesOrderAddOn,
  completeSalesOrderAddOn,
  createSalesOrderAddOnState,
  markSalesOrderAddOnSaved,
  resolveSalesOrderAddOnFailure,
  stageSalesOrderAddOnCandidate,
  verifySalesOrderAddOnResult,
} from '../../src/views/operations/purchase-orders/purchase-order-sales-add-on.logic'

test('加购候选与采购表单正式关联保持分离直到销售保存成功', () => {
  const initial = createSalesOrderAddOnState('selected-order')
  const staged = stageSalesOrderAddOnCandidate(initial, 'candidate-order')
  const running = beginSalesOrderAddOn(staged)

  assert.equal(staged.selectedSalesOrderId, 'selected-order')
  assert.equal(staged.candidateSalesOrderId, 'candidate-order')
  assert.equal(running.selectedSalesOrderId, 'selected-order')

  const saved = markSalesOrderAddOnSaved(running)
  assert.equal(saved.selectedSalesOrderId, 'candidate-order')
  assert.equal(saved.phase, 'sales-saved')
  assert.equal(completeSalesOrderAddOn(saved).phase, 'completed')
})

test('销售保存失败不提升候选，同步失败保留已经成功的正式关联', () => {
  const running = beginSalesOrderAddOn(stageSalesOrderAddOnCandidate(
    createSalesOrderAddOnState(null),
    'candidate-order',
  ))
  const beforeSaveFailure = resolveSalesOrderAddOnFailure(running, {
    stepIndex: 0,
    unknownResult: false,
  })
  const saved = markSalesOrderAddOnSaved(running)
  const syncFailure = resolveSalesOrderAddOnFailure(saved, {
    stepIndex: 2,
    unknownResult: false,
  })

  assert.equal(beforeSaveFailure.selectedSalesOrderId, null)
  assert.equal(beforeSaveFailure.phase, 'candidate')
  assert.equal(syncFailure.selectedSalesOrderId, 'candidate-order')
  assert.equal(syncFailure.phase, 'sales-saved')
})

test('网络未知结果进入不可自动重放状态且不猜测候选是否已保存', () => {
  const running = beginSalesOrderAddOn(stageSalesOrderAddOnCandidate(
    createSalesOrderAddOnState('original-order'),
    'candidate-order',
  ))
  const unknown = resolveSalesOrderAddOnFailure(running, {
    stepIndex: 0,
    unknownResult: true,
  })

  assert.equal(unknown.phase, 'unknown')
  assert.equal(unknown.selectedSalesOrderId, 'original-order')
  assert.equal(unknown.candidateSalesOrderId, 'candidate-order')
})

test('金额校验只接受与本次意图和预览完全一致的服务端结果', () => {
  const valid = verifySalesOrderAddOnResult({
    expectedVersion: 7,
    expectedAmountDelta: '25.00',
    expectedAgreedTotalAmount: '125.00',
    result: {
      previousVersion: 7,
      version: 8,
      amountDelta: '25.0000',
      agreedTotalAmount: '125.0000',
    },
  })
  const invalid = verifySalesOrderAddOnResult({
    expectedVersion: 7,
    expectedAmountDelta: '25.00',
    expectedAgreedTotalAmount: '125.00',
    result: {
      previousVersion: 7,
      version: 8,
      amountDelta: '24.00',
      agreedTotalAmount: '124.00',
    },
  })

  assert.equal(valid, true)
  assert.equal(invalid, false)
})
