import type { SlhBillImportPreviewDto, SlhBillPreviewLineDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 与柜次导入测试保持一致的 Node 内置 runner。
import test from 'node:test'
import {
  buildSlhBillImportPayload,
  collectSlhBillLineErrors,
  countSlhBillImportIssues,
  createSlhBillArchiveDraft,
  hasSlhBillTwdAmounts,
  needsSlhBillManualRate,
  resolveSlhBillImportBlock,
  resolveSlhBillImportKeyAction,
  resolveSlhBillImportPhase,
  resolveSlhBillManualRate,
  validateSlhBillArchiveDraft,
  withSlhBillNameSuffix,
} from '../../src/views/workbenches/slh-bills/import.logic'

function previewFixture(overrides: Partial<SlhBillImportPreviewDto> = {}): SlhBillImportPreviewDto {
  return {
    containerBatchCount: 1,
    containerBatchNames: ['SLHU1234567'],
    duplicate: null,
    findings: [],
    lineCount: 2,
    lines: [],
    periodEnd: '2026-08-31',
    periodStart: '2026-08-01',
    reported: {
      embeddedForeignUnitsPerCny: null,
      netAmountFormula: null,
      netAmountTwd: '900.00',
      payableAmountCny: '-130.00',
      reportedNetAmountTwd: '900.00',
      subtotalCodAmountTwd: '960.00',
      subtotalNtdSurchargeAmountTwd: '60.00',
      subtotalPayableAmountCny: '130.00',
    },
    systemForeignUnitsPerCny: '4.800000000000',
    totals: {
      codHandlingTotalAmountCny: '10.00',
      codTotalAmountTwd: '960.00',
      freightTotalAmountCny: '100.00',
      ntdSurchargeTotalAmountTwd: '60.00',
      payableTotalAmountCny: '130.00',
      reportedNetAmountTwd: '900.00',
      surchargeTotalAmountCny: '20.00',
    },
    ...overrides,
  }
}

function lineFixture(overrides: Partial<SlhBillPreviewLineDto> = {}): SlhBillPreviewLineDto {
  return {
    charges: [],
    codAmountTwd: '0.00',
    codHandlingAmountCny: '0.00',
    containerBatchNameText: 'SLHU1234567',
    errors: [],
    findings: [],
    freightAmountCny: '0.00',
    goodsName: '灯具',
    lineNumber: 1,
    loadingDate: '2026-08-01',
    ntdSurchargeAmountTwd: '0.00',
    packageCount: 1,
    payableAmountCny: '0.00',
    surchargeAmountCny: '0.00',
    ...overrides,
  }
}

test('导入页三段式按原件、解析与预览推进，预览到手后停在确认段', () => {
  assert.equal(resolveSlhBillImportPhase({ mediaAssetId: null, parsing: false, preview: null }), 'upload')
  assert.equal(resolveSlhBillImportPhase({ mediaAssetId: 'asset-1', parsing: true, preview: null }), 'parsing')
  assert.equal(resolveSlhBillImportPhase({ mediaAssetId: 'asset-1', parsing: false, preview: null }), 'upload')
  assert.equal(resolveSlhBillImportPhase({ mediaAssetId: 'asset-1', parsing: false, preview: previewFixture() }), 'preview')
})

test('账单公式自带除数时不开放手填汇率，缺少除数才要求确认汇率', () => {
  assert.equal(needsSlhBillManualRate(previewFixture()), true)
  assert.equal(needsSlhBillManualRate(previewFixture({ reported: { netAmountFormula: '=(V58-W58)/4.8', reportedNetAmountTwd: '900.00' }, systemForeignUnitsPerCny: null })), false)
  // 预览只在缺少除数时读系统汇率，因此有系统汇率同样说明账单不自带汇率。
  assert.equal(needsSlhBillManualRate(previewFixture({ reported: { netAmountFormula: '=(V58-W58)/4.8', reportedNetAmountTwd: '900.00' } })), true)
})

test('手填汇率与系统汇率相等、留空或非法时都不作为手填值提交', () => {
  const preview = previewFixture()
  assert.deepEqual(resolveSlhBillManualRate(preview, '4.80'), { error: null, value: null })
  assert.deepEqual(resolveSlhBillManualRate(preview, ' 4.8 '), { error: null, value: null })
  assert.deepEqual(resolveSlhBillManualRate(preview, ''), { error: null, value: null })
  assert.deepEqual(resolveSlhBillManualRate(preview, '4.9'), { error: null, value: '4.9' })
  assert.deepEqual(resolveSlhBillManualRate(preview, 'abc'), { error: 'format', value: null })
  assert.deepEqual(resolveSlhBillManualRate(preview, '0'), { error: 'format', value: null })
  assert.deepEqual(resolveSlhBillManualRate(preview, '-4.8'), { error: 'format', value: null })
  assert.deepEqual(resolveSlhBillManualRate(preview, '4.1234567890123'), { error: 'format', value: null })
  assert.deepEqual(resolveSlhBillManualRate(preview, '4.123456789012'), { error: null, value: '4.123456789012' })
  // 账单自带汇率时手填值必须被忽略，否则服务端会直接拒绝入库。
  const embedded = previewFixture({ reported: { netAmountFormula: '=(V58-W58)/4.8', reportedNetAmountTwd: '900.00' }, systemForeignUnitsPerCny: null })
  assert.deepEqual(resolveSlhBillManualRate(embedded, '4.9'), { error: null, value: null })
})

test('没有系统汇率时只有存在台币金额的账单才强制手填汇率', () => {
  const noSystemRate = previewFixture({ systemForeignUnitsPerCny: null })
  assert.equal(hasSlhBillTwdAmounts(noSystemRate), true)
  assert.deepEqual(resolveSlhBillManualRate(noSystemRate, ''), { error: 'required', value: null })
  const withoutTwd = previewFixture({
    systemForeignUnitsPerCny: null,
    totals: { codHandlingTotalAmountCny: '0.00', codTotalAmountTwd: '0.00', freightTotalAmountCny: '0.00', ntdSurchargeTotalAmountTwd: '0.00', payableTotalAmountCny: '0.00', reportedNetAmountTwd: '0.00', surchargeTotalAmountCny: '0.00' },
  })
  assert.equal(hasSlhBillTwdAmounts(withoutTwd), false)
  assert.deepEqual(resolveSlhBillManualRate(withoutTwd, ''), { error: null, value: null })
})

test('明细错误逐行回显并阻止入库，重复账单必须先勾选确认', () => {
  // 行级出入项同时出现在账单级 findings 里，line.findings 只是按行过滤后的子集。
  const lineFindings = [
    { kind: 'FREIGHT_MISMATCH', lineNumber: 2, message: '运费复算 1.00 与账单 2.00 不一致', severity: 'difference' },
    { kind: 'DIMENSION_PRECISION', lineNumber: 2, message: '尺寸精度过高', severity: 'warning' },
  ] as const
  const lines = [
    lineFixture(),
    lineFixture({ errors: ['装柜日期无法识别'], findings: [...lineFindings], lineNumber: 2 }),
  ]
  assert.deepEqual(collectSlhBillLineErrors(lines), ['第 2 行：装柜日期无法识别'])
  assert.deepEqual(countSlhBillImportIssues(previewFixture({
    findings: [
      { kind: 'SUBTOTAL_MISMATCH', lineNumber: null, message: '账单小计应付 130.00 与明细累加 120.00 不一致', severity: 'difference' },
      { kind: 'RATE_MISSING', lineNumber: null, message: '账单公式未自带汇率', severity: 'warning' },
      ...lineFindings,
    ],
    lines,
  })), {
    differences: 2,
    lineErrors: 1,
    warnings: 2,
  })
  const blocked = previewFixture({ lines })
  assert.equal(resolveSlhBillImportBlock({ duplicateAcknowledged: false, manualRateError: null, preview: blocked }), 'lineErrors')
  const duplicate = previewFixture({ duplicate: { billId: 'bill-1', periodEnd: '2026-08-31', periodStart: '2026-08-01', slhBillNo: 'CBILL/202608-01' } })
  assert.equal(resolveSlhBillImportBlock({ duplicateAcknowledged: false, manualRateError: null, preview: duplicate }), 'duplicateUnacknowledged')
  assert.equal(resolveSlhBillImportBlock({ duplicateAcknowledged: true, manualRateError: null, preview: duplicate }), null)
  assert.equal(resolveSlhBillImportBlock({ duplicateAcknowledged: true, manualRateError: 'required', preview: duplicate }), 'manualRateRequired')
  assert.equal(resolveSlhBillImportBlock({ duplicateAcknowledged: true, manualRateError: 'format', preview: duplicate }), 'manualRateFormat')
  assert.equal(resolveSlhBillImportBlock({ duplicateAcknowledged: true, manualRateError: null, preview: previewFixture() }), null)
})

const archive = { billName: '一月对账单', billMonth: '2026-01', remark: '' }

test('入库载荷带上归档字段，空备注与未手填汇率都不发送', () => {
  assert.deepEqual(buildSlhBillImportPayload({ archive, duplicateAcknowledged: false, manualRate: null, mediaAssetId: 'asset-1' }), {
    billMonth: '2026-01',
    billName: '一月对账单',
    duplicateAcknowledged: false,
    mediaAssetId: 'asset-1',
  })
  assert.deepEqual(buildSlhBillImportPayload({
    archive: { billName: ' 一月对账单 ', billMonth: ' 2026-01 ', remark: ' 首次导入 ' },
    duplicateAcknowledged: true,
    manualRate: '4.9',
    mediaAssetId: 'asset-1',
  }), {
    billMonth: '2026-01',
    billName: '一月对账单',
    duplicateAcknowledged: true,
    manualForeignUnitsPerCny: '4.9',
    mediaAssetId: 'asset-1',
    remark: '首次导入',
  })
})

test('归档草稿取服务端推导的默认值，校验与服务端同口径', () => {
  assert.deepEqual(
    createSlhBillArchiveDraft({ suggestedBillMonth: '2026-01', suggestedBillName: '1月账单（3）千树贸易账单' }),
    { billMonth: '2026-01', billName: '1月账单（3）千树贸易账单', remark: '' },
  )
  assert.deepEqual(validateSlhBillArchiveDraft({ billMonth: '2026-01', billName: '对账单', remark: '' }), {})
  // 名称必填、月份必须是 YYYY-MM、备注不超长。
  assert.equal(validateSlhBillArchiveDraft({ billMonth: '2026-01', billName: '   ', remark: '' }).billName, 'nameRequired')
  assert.equal(validateSlhBillArchiveDraft({ billMonth: '2026-01', billName: '长'.repeat(201), remark: '' }).billName, 'nameTooLong')
  assert.equal(validateSlhBillArchiveDraft({ billMonth: '2026-13', billName: '对账单', remark: '' }).billMonth, 'monthRequired')
  assert.equal(validateSlhBillArchiveDraft({ billMonth: '', billName: '对账单', remark: '' }).billMonth, 'monthRequired')
  assert.equal(validateSlhBillArchiveDraft({ billMonth: '2026-01', billName: '对账单', remark: '字'.repeat(501) }).remark, 'remarkTooLong')
})

test('名称冲突时补日期后缀，重复冲突不叠加', () => {
  const day = new Date('2026-09-27T00:00:00Z')
  assert.equal(withSlhBillNameSuffix('一月对账单', day), `一月对账单-20260927`)
  // 已经带同类后缀时先去掉再补，避免叠成两段。
  assert.equal(withSlhBillNameSuffix('一月对账单-20260926', day), '一月对账单-20260927')
  assert.equal(withSlhBillNameSuffix(' 一月对账单 ', day), '一月对账单-20260927')
})

test('幂等键随内容变化重签，结果未知时沿用原键以便安全重放', () => {
  const first = resolveSlhBillImportKeyAction({ pendingSignature: null, settled: 'pending', signature: 'A' })
  assert.equal(first, 'mine')
  assert.equal(resolveSlhBillImportKeyAction({ pendingSignature: 'A', settled: 'pending', signature: 'A' }), 'keep')
  assert.equal(resolveSlhBillImportKeyAction({ pendingSignature: 'A', settled: 'pending', signature: 'B' }), 'mine')
  assert.equal(resolveSlhBillImportKeyAction({ pendingSignature: 'A', settled: 'unknown', signature: 'A' }), 'keep')
  assert.equal(resolveSlhBillImportKeyAction({ pendingSignature: 'A', settled: 'rejected', signature: 'A' }), 'drop')
  assert.equal(resolveSlhBillImportKeyAction({ pendingSignature: 'A', settled: 'created', signature: 'A' }), 'drop')
})
