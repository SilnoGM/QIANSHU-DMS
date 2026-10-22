import type { ContainerImportCandidateDto, ContainerImportConfirmDto, ContainerImportPreviewDto, ContainerImportRowDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证导入核对、权限生命周期与幂等重放。
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useContainerImport } from '../../src/views/workbenches/containers/import/use-container-import'

const candidate: ContainerImportCandidateDto = { id: 'shipment-1', shipmentNo: 'PKG/1', shippingMarkText: 'MARK/1', trackingNo: '001', warehouseValue: 'b5', goodsName: '机器', purchaseOrderNo: 'PO/1', salesOrderNo: 'SO/1', customerName: '王小明', purchaseType: 'SALES_LINKED', viewStatus: 'WAREHOUSE_RECEIVED', warehouseReceivedAt: '2026-10-02T00:00:00.000Z', containerBatch: null, matchFields: ['trackingNo'], eligible: true, ineligibleReason: null }
function row(overrides: Partial<ContainerImportRowDto> = {}): ContainerImportRowDto {
  return { rowKey: 'row-1', sourceSheetName: 'Sheet1', sourceRowNumber: 3, containerBatchName: '0919柜', warehouseReceiptReference: '001', oceanShippingMarkText: 'L-001', goodsName: '机器', packageCount: 1, packageUnit: 'CTN', grossWeightKg: '10', lengthCm: '20', widthCm: '30', heightCm: '40', reportedVolumeCai: '1', volumeCai: '0.85', chargeableVolumeCai: 1, recipientName: null, recipientPhone: null, recipientAddress: null, codAmountTwd: null, remark: null, errors: [], warnings: [], candidates: [candidate], matchedShipmentId: candidate.id, matchStatus: 'MATCHED', matchReason: '物流单号精确匹配', ...overrides }
}
function preview(rows = [row()]): ContainerImportPreviewDto {
  return { containerBatchId: 'batch', containerBatchName: '0919柜', containerBatchNo: 'CTN/1', warehouseValue: 'b5', expectedVersion: 2, sourceFileId: 'source', sourceFilename: '0919柜.xlsx', sourceHash: 'hash', alreadyImported: false, warnings: [], rows }
}
async function flush() {
  await nextTick()
  await nextTick()
}
function setup(data: ContainerImportPreviewDto, send = async (_body: ContainerImportConfirmDto, _key: string, _signal: AbortSignal) => ({ containerBatchId: 'batch', importedCount: data.rows.length, skippedCount: 0, unmatchedCount: 0, replayed: false })) {
  const scope = effectScope()
  const enabled = ref(true)
  const epoch = ref(1)
  const state = scope.run(() => useContainerImport(enabled, epoch, ref('batch'), async () => data, send))!
  return { scope, enabled, epoch, state }
}

test('自动匹配与人工修改全量计数，提交不受筛选分页影响', async () => {
  const calls: ContainerImportConfirmDto[] = []
  const { scope, state } = setup(preview([row(), row({ rowKey: 'row-2', matchedShipmentId: null, matchStatus: 'AMBIGUOUS' })]), async (body) => {
    calls.push(body)
    return { containerBatchId: 'batch', importedCount: 2, skippedCount: 0, unmatchedCount: 0, replayed: false }
  })
  await flush()
  assert.deepEqual(state.counts.value, { ALL: 2, MATCHED: 1, AMBIGUOUS: 1, UNMATCHED: 0, INVALID: 0, SKIPPED: 0 })
  assert.equal(state.canSubmit.value, false)
  assert.equal(state.select('row-2', candidate), true)
  assert.equal(state.counts.value.MATCHED, 2)
  assert.equal(state.canSubmit.value, true)
  await state.submit()
  assert.deepEqual(calls[0].rows, [{ rowKey: 'row-1', shipmentId: 'shipment-1' }, { rowKey: 'row-2', shipmentId: 'shipment-1' }])
  assert.equal(state.hasUncommitted.value, false)
  scope.stop()
})

test('清除匹配后必须显式允许未匹配，异常行即使勾选也不能提交', async () => {
  const { scope, state } = setup(preview())
  await flush()
  state.select('row-1', null)
  assert.equal(state.counts.value.UNMATCHED, 1)
  assert.equal(state.canSubmit.value, false)
  assert.equal(await state.submit(), undefined)
  state.allowUnmatched.value = true
  assert.equal(state.canSubmit.value, true)
  assert.equal(state.select('row-1', { ...candidate, eligible: false }), false)
  scope.stop()
  const invalid = setup(preview([row({ errors: ['尺寸无效'], matchStatus: 'INVALID' })]))
  await flush()
  invalid.state.allowUnmatched.value = true
  assert.equal(invalid.state.canSubmit.value, false)
  assert.equal(invalid.state.select('row-1', candidate), false)
  invalid.scope.stop()
})

test('结果未知锁定选择，重试使用完全相同的正文和幂等键', async () => {
  const calls: { body: ContainerImportConfirmDto, key: string }[] = []
  const { scope, state } = setup(preview(), async (body, key) => {
    calls.push({ body, key })
    if (calls.length === 1) {
      throw Object.assign(new Error('offline'), { kind: 'network' })
    }
    return { containerBatchId: 'batch', importedCount: 1, skippedCount: 0, unmatchedCount: 0, replayed: true }
  })
  await flush()
  await state.submit()
  assert.equal(state.locked.value, true)
  assert.equal(state.select('row-1', null), false)
  state.allowUnmatched.value = true
  await state.submit()
  assert.deepEqual(calls[1], calls[0])
  assert.equal(state.completed.value, true)
  scope.stop()
})

test('重复点击只提交一次；身份切换清空手动选择并丢弃旧响应', async () => {
  let resolve!: (value: { containerBatchId: string, importedCount: number, skippedCount: number, unmatchedCount: number, replayed: boolean }) => void
  let calls = 0
  const { scope, state, enabled, epoch } = setup(preview(), async () => {
    calls++
    return new Promise(ok => resolve = ok)
  })
  await flush()
  state.select('row-1', { ...candidate, id: 'manual' })
  const sending = state.submit()
  await state.submit()
  assert.equal(calls, 1)
  enabled.value = false
  epoch.value++
  await flush()
  assert.equal(state.rows.value.length, 0)
  resolve({ containerBatchId: 'batch', importedCount: 1, skippedCount: 0, unmatchedCount: 0, replayed: false })
  assert.equal(await sending, undefined)
  enabled.value = true
  await flush()
  assert.equal(state.rows.value[0].selectedShipment?.id, 'shipment-1')
  scope.stop()
})

test('已导入或空表格不能再次提交', async () => {
  const imported = setup({ ...preview(), alreadyImported: true })
  await flush()
  assert.equal(imported.state.canSubmit.value, false)
  assert.equal(imported.state.hasUncommitted.value, false)
  imported.scope.stop()
  const empty = setup(preview([]))
  await flush()
  assert.equal(empty.state.canSubmit.value, false)
  empty.scope.stop()
})

test('明确保留未匹配时提交 null 关联，歧义候选不会被默认选中', async () => {
  let submitted: ContainerImportConfirmDto | undefined
  const { scope, state } = setup(preview([row({ matchStatus: 'AMBIGUOUS', matchedShipmentId: null })]), async (body) => {
    submitted = body
    return { containerBatchId: 'batch', importedCount: 1, skippedCount: 0, unmatchedCount: 1, replayed: false }
  })
  await flush()
  assert.equal(state.rows.value[0].selectedShipment, null)
  state.allowUnmatched.value = true
  await state.submit()
  assert.equal(submitted?.allowUnmatched, true)
  assert.deepEqual(submitted?.rows, [{ rowKey: 'row-1', shipmentId: null }])
  scope.stop()
})

test('不可关联候选即使被标为自动匹配也不会带入提交', async () => {
  const { scope, state } = setup(preview([row({ candidates: [{ ...candidate, eligible: false, ineligibleReason: '已分配其他柜次' }] })]))
  await flush()
  assert.equal(state.rows.value[0].selectedShipment, null)
  assert.equal(state.counts.value.UNMATCHED, 1)
  assert.equal(state.canSubmit.value, false)
  scope.stop()
})

test('已有明细优先标为跳过，不阻塞正常行且完整提交行标识', async () => {
  const calls: ContainerImportConfirmDto[] = []
  const { scope, state } = setup(preview([
    row(),
    row({ rowKey: 'existing', matchStatus: 'SKIPPED', errors: ['尺寸无效'], matchReason: '当前柜次已存在相同海运唛头的明细' }),
  ]), async (body) => {
    calls.push(body)
    return { containerBatchId: 'batch', importedCount: 1, skippedCount: 1, unmatchedCount: 0, replayed: false }
  })
  await flush()
  assert.equal(state.rows.value[1].displayStatus, 'SKIPPED')
  assert.equal(state.rows.value[1].selectedShipment, null)
  assert.deepEqual(state.counts.value, { ALL: 2, MATCHED: 1, AMBIGUOUS: 0, UNMATCHED: 0, INVALID: 0, SKIPPED: 1 })
  assert.equal(state.importCount.value, 1)
  assert.equal(state.unmatchedCount.value, 0)
  assert.equal(state.select('existing', candidate), false)
  assert.equal(state.select('existing', null), false)
  assert.equal(state.canSubmit.value, true)
  const result = await state.submit()
  assert.deepEqual(calls[0].rows, [{ rowKey: 'row-1', shipmentId: 'shipment-1' }, { rowKey: 'existing', shipmentId: null }])
  assert.equal(calls[0].allowUnmatched, false)
  assert.equal(result?.skippedCount, 1)
  scope.stop()
})

test('全部明细跳过时没有待提交修改，也不会发送空导入', async () => {
  let calls = 0
  const { scope, state } = setup(preview([row({ matchStatus: 'SKIPPED' })]), async () => {
    calls++
    return { containerBatchId: 'batch', importedCount: 0, skippedCount: 1, unmatchedCount: 0, replayed: false }
  })
  await flush()
  assert.equal(state.importCount.value, 0)
  assert.equal(state.canSubmit.value, false)
  assert.equal(state.hasUncommitted.value, false)
  state.allowUnmatched.value = true
  await state.submit()
  assert.equal(calls, 0)
  scope.stop()
})

test('跳过已有明细不会豁免待导入行的异常或未匹配确认', async () => {
  const invalid = setup(preview([row({ matchStatus: 'SKIPPED' }), row({ rowKey: 'invalid', errors: ['尺寸无效'], matchStatus: 'INVALID' })]))
  await flush()
  assert.equal(invalid.state.counts.value.INVALID, 1)
  assert.equal(invalid.state.canSubmit.value, false)
  invalid.scope.stop()
  const unmatched = setup(preview([row({ matchStatus: 'SKIPPED' }), row({ rowKey: 'unmatched', candidates: [], matchedShipmentId: null, matchStatus: 'UNMATCHED' })]))
  await flush()
  assert.equal(unmatched.state.unmatchedCount.value, 1)
  assert.equal(unmatched.state.canSubmit.value, false)
  unmatched.state.allowUnmatched.value = true
  assert.equal(unmatched.state.canSubmit.value, true)
  unmatched.scope.stop()
})
