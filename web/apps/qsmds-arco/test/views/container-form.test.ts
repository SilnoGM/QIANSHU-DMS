import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 业务纯函数由现有 node:test 执行。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import * as logic from '../../src/views/workbenches/containers/form.logic'
import {
  buildContainerSubmission,
  buildLoadingItemSubmission,
  createContainerDraft,
  createLoadingItemDraft,
  validateContainerDraft,
  validateLoadingItemDraft,
} from '../../src/views/workbenches/containers/form.logic'
import { useContainerCreateSource } from '../../src/views/workbenches/containers/use-container-create-source'

test('new forms retain unknown measurements and default to one package', () => {
  const draft = createLoadingItemDraft()
  assert.equal(draft.packageCount, '1')
  assert.equal(draft.lengthCm, '')
  draft.goodsName = ' 工业炉 '
  const submission = buildLoadingItemSubmission(draft)
  assert.equal(submission.goodsName, '工业炉')
  assert.equal(submission.lengthCm, null)
  assert.equal(submission.packageCount, 1)
  assert.equal(submission.shipmentId, null)
  assert.ok(!('expectedVersion' in submission))
  assert.ok(!('volumeCai' in submission))
})

test('measurements retain exact decimal strings without Number conversion', () => {
  const draft = createLoadingItemDraft()
  Object.assign(draft, { goodsName: '炉', grossWeightKg: '999999999999999.999', reportedVolumeCai: '9999999999999999.99999999' })
  assert.deepEqual(validateLoadingItemDraft(draft), {})
  const submission = buildLoadingItemSubmission(draft)
  assert.equal(submission.grossWeightKg, '999999999999999.999')
  assert.equal(submission.reportedVolumeCai, '9999999999999999.99999999')
})

test('invalid precision, signs, exponent, zero and quantity are rejected; source zero is allowed', () => {
  const draft = createLoadingItemDraft()
  draft.goodsName = '炉'
  for (const value of ['0', '-1', '1e3', '1.0001', '1000000000000000', 'Infinity']) {
    draft.lengthCm = value
    assert.ok(validateLoadingItemDraft(draft).lengthCm, value)
  }
  draft.lengthCm = '0.001'
  draft.reportedVolumeCai = '0'
  assert.deepEqual(validateLoadingItemDraft(draft), {})
  for (const value of ['0', '1.5', '1000001', '1e2']) {
    draft.packageCount = value
    assert.ok(validateLoadingItemDraft(draft).packageCount, value)
  }
})

test('container names, warehouse and field lengths are validated before submission', () => {
  const draft = createContainerDraft()
  assert.ok(validateContainerDraft(draft).warehouseValue)
  Object.assign(draft, { containerBatchName: '0918-02柜', warehouseValue: 'b5' })
  assert.deepEqual(validateContainerDraft(draft), {})
  assert.deepEqual(buildContainerSubmission(draft), { containerBatchName: '0918-02柜', warehouseValue: 'b5', remark: null, sourceFileId: null })
  for (const value of ['0918-00柜', '1331柜', '0230柜', '0918-100柜', '九月柜']) {
    draft.containerBatchName = value
    assert.ok(validateContainerDraft(draft).containerBatchName, value)
  }
  draft.containerBatchName = '0918柜'
  draft.remark = 'a'.repeat(501)
  assert.ok(validateContainerDraft(draft).remark)
})

test('新建柜次必须绑定上传成功的来源文件，历史柜次编辑允许保留空附件', () => {
  const draft = createContainerDraft()
  Object.assign(draft, { containerBatchName: '0919柜', warehouseValue: 'b5' })
  assert.equal(validateContainerDraft(draft, true).sourceFileId, 'sourceRequired')
  assert.deepEqual(validateContainerDraft(draft, false), {})
  draft.sourceFileId = 'uploaded-source'
  assert.deepEqual(validateContainerDraft(draft, true), {})
  assert.equal(buildContainerSubmission(draft).sourceFileId, 'uploaded-source')
})

test('新建弹窗没有成功上传来源文件时不能提交，绑定后随创建请求发送', async () => {
  const fixture = await modalFixture('container')
  try {
    Object.assign(fixture.state.draft.value, { containerBatchName: '0919柜', warehouseValue: 'b5' })
    await fixture.state.submit()
    assert.equal(fixture.events.length, 0)
    fixture.state.draft.value.sourceFileId = 'uploaded-source'
    await fixture.state.submit()
    assert.equal((fixture.events[0]?.[1] as Record<string, unknown>).sourceFileId, 'uploaded-source')
  }
  finally { fixture.dispose() }
})

test('上传成功后同步表单字段并重新校验，移除附件恢复必填状态', async () => {
  const fixture = await modalFixture('container')
  try {
    await fixture.state.source!.selectFile(new File(['xlsx'], 'source.xlsx'))
    await nextTick()
    assert.equal(fixture.state.source!.error.value, '')
    assert.equal(fixture.state.source!.sourceFile.value?.mediaAssetId, 'uploaded-source')
    assert.equal(fixture.state.draft.value.sourceFileId, 'uploaded-source')
    assert.deepEqual(fixture.fieldUpdates.at(-1), ['sourceFileId', 'uploaded-source', true])
    fixture.state.source!.remove()
    await nextTick()
    assert.deepEqual(fixture.fieldUpdates.at(-1), ['sourceFileId', null, true])
  }
  finally { fixture.dispose() }
})

test('recipient COD remains unknown unless entered explicitly and respects monetary precision', () => {
  const draft = createLoadingItemDraft()
  draft.goodsName = '产品'
  assert.equal(buildLoadingItemSubmission(draft).codAmountTwd, null)
  draft.codAmountTwd = '0.00'
  assert.equal(buildLoadingItemSubmission(draft).codAmountTwd, '0.00')
  draft.codAmountTwd = '0.001'
  assert.ok(validateLoadingItemDraft(draft).codAmountTwd)
  draft.codAmountTwd = '-1'
  assert.ok(validateLoadingItemDraft(draft).codAmountTwd)
})

async function modalFixture(kind: 'container' | 'loading-item') {
  const source = await readFile(new URL(`../../src/views/workbenches/containers/${kind}-form-modal.vue`, import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const props = reactive({ modelValue: true, batch: null as null | { sourceFileId: string, containerBatchName: string, warehouseValue: string }, item: null, shipment: null as null | { id: string, shippingMarkText: string }, submitting: false, retryOnly: false, fieldErrors: {} })
  const events: Array<[string, Record<string, unknown> | boolean]> = []
  const fieldUpdates: unknown[][] = []
  const scope = effectScope()
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ draft, submit, close, locked, rule, source: typeof source === 'undefined' ? null : source, codAmount: typeof codAmount === 'undefined' ? null : codAmount, recipientAddress: typeof recipientAddress === 'undefined' ? null : recipientAddress })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    ...logic,
    computed,
    nextTick,
    ref,
    watch,
    defineProps: () => props,
    withDefaults: (value: unknown) => value,
    defineEmits: () => (name: string, payload: Record<string, unknown> | boolean) => events.push([name, payload]),
    useI18n: () => ({ t: (key: string) => key }),
    useAppAccountStore: () => ({ authEpoch: 1 }),
    useContainerCreateSource,
    sourceFilesApi: { uploadForCreate: async () => ({ data: { mediaAssetId: 'uploaded-source' } }) },
    useCurrencyCatalog: () => ({ currencies: ref([{ code: 'TWD', enabled: true, minorUnit: 2, name: '新台币', symbol: 'NT$' }]), loading: ref(false), errorMessage: ref(null), reload: async () => {} }),
    useTemplateRef: () => ref({ submit: async () => {}, setFieldError: () => {}, setFieldValue: (...args: unknown[]) => fieldUpdates.push(args) }),
  })) as { draft: { value: Record<string, unknown> }, submit: () => Promise<void>, close: () => void, locked: { value: boolean }, rule: (field: string) => (value: unknown) => string | boolean, source: ReturnType<typeof useContainerCreateSource> | null, codAmount: { value: string | null }, recipientAddress: { value: string } }
  return { props, state, events, fieldUpdates, dispose: () => scope.stop() }
}

test('modal prevents duplicate submits and closing while parent save is pending', async () => {
  const fixture = await modalFixture('loading-item')
  try {
    fixture.state.draft.value.goodsName = '炉'
    const first = fixture.state.submit()
    fixture.props.submitting = true
    await fixture.state.submit()
    fixture.state.close()
    await first
    assert.equal(fixture.events.length, 1)
    assert.equal(fixture.events[0]?.[0], 'submit')
    assert.equal(fixture.state.locked.value, true)
    fixture.props.submitting = false
    await nextTick()
    fixture.state.close()
    assert.equal(fixture.events.at(-1)?.[0], 'update:modelValue')
  }
  finally { fixture.dispose() }
})

test('shipment selection preserves recipient COD and other draft fields', async () => {
  const fixture = await modalFixture('loading-item')
  try {
    Object.assign(fixture.state.draft.value, { goodsName: '保留产品', codAmountTwd: '520.00' })
    fixture.props.shipment = { id: 'shipment-a', shippingMarkText: 'MARK-A' }
    await nextTick()
    assert.equal(fixture.state.draft.value.shipmentId, 'shipment-a')
    assert.equal(fixture.state.draft.value.goodsName, '保留产品')
    assert.equal(fixture.state.draft.value.codAmountTwd, '520.00')
    fixture.state.draft.value.shipmentId = null
    await fixture.state.submit()
    assert.equal((fixture.events[0]?.[1] as Record<string, unknown>).shipmentId, null)
  }
  finally { fixture.dispose() }
})

test('金额控件的空值适配保持未知、明确零值及大金额精度', async () => {
  const fixture = await modalFixture('loading-item')
  try {
    fixture.state.draft.value.goodsName = '产品'
    assert.equal(fixture.state.codAmount.value, null)
    fixture.state.codAmount.value = '9999999999999999999999999999.99'
    assert.equal(fixture.state.draft.value.codAmountTwd, '9999999999999999999999999999.99')
    fixture.state.codAmount.value = '0.00'
    await fixture.state.submit()
    assert.equal((fixture.events[0]?.[1] as Record<string, unknown>).codAmountTwd, '0.00')
    fixture.state.codAmount.value = null
    assert.equal(fixture.state.draft.value.codAmountTwd, '')
    assert.equal(buildLoadingItemSubmission(fixture.state.draft.value as unknown as logic.LoadingItemDraft).codAmountTwd, null)
  }
  finally { fixture.dispose() }
})

test('地址输入将粘贴或键入的换行合并为空格，其他字段及字符原样保留', async () => {
  const fixture = await modalFixture('loading-item')
  try {
    Object.assign(fixture.state.draft.value, { goodsName: '产品', remark: '原始备注', recipientPhone: '0912-345678' })
    fixture.state.recipientAddress.value = '台湾省\r\n台北市\n信义区\r松仁路 100 号'
    assert.equal(fixture.state.recipientAddress.value, '台湾省 台北市 信义区 松仁路 100 号')
    assert.equal(fixture.state.draft.value.recipientPhone, '0912-345678')
    assert.equal(fixture.state.draft.value.remark, '原始备注')
    await fixture.state.submit()
    assert.equal((fixture.events[0]?.[1] as Record<string, unknown>).recipientAddress, '台湾省 台北市 信义区 松仁路 100 号')
    fixture.state.recipientAddress.value = '地址\t含制表符'
    assert.notEqual(fixture.state.rule('recipientAddress')(fixture.state.recipientAddress.value), true)
  }
  finally { fixture.dispose() }
})

test('retry-only modal bypasses new draft validation so parent can replay frozen request', async () => {
  for (const kind of ['container', 'loading-item'] as const) {
    const fixture = await modalFixture(kind)
    try {
      await fixture.state.submit()
      assert.equal(fixture.events.length, 0)
      fixture.props.retryOnly = true
      await fixture.state.submit()
      assert.equal(fixture.events[0]?.[0], 'submit')
    }
    finally { fixture.dispose() }
  }
})

test('editing container preserves existing source file binding', async () => {
  const fixture = await modalFixture('container')
  try {
    fixture.props.batch = { sourceFileId: 'source-file', containerBatchName: '0918柜', warehouseValue: 'b5' }
    await nextTick()
    await fixture.state.submit()
    assert.equal((fixture.events[0]?.[1] as Record<string, unknown>).sourceFileId, 'source-file')
  }
  finally { fixture.dispose() }
})

test('editing an existing association displays shipment mark or number, never internal UUID', async () => {
  assert.equal(logic.resolveShipmentDisplay('internal-id', null, { shipmentId: 'internal-id', shippingMark: 'MARK-01', shipmentNo: 'PKG/01' }), 'MARK-01')
  assert.equal(logic.resolveShipmentDisplay('internal-id', { id: 'internal-id', shippingMarkText: null, shipmentNo: 'PKG/01' }, null), 'PKG/01')
  assert.equal(logic.resolveShipmentDisplay('internal-id', null, { shipmentId: 'internal-id', shippingMark: null, shipmentNo: null }), null)
  assert.equal(logic.resolveShipmentDisplay(null, { id: 'internal-id', shippingMarkText: 'MARK-01', shipmentNo: 'PKG/01' }, null), null)
})

test('loading date preview uses Shanghai year and preserves the original creation year for edits', () => {
  assert.equal(logic.previewContainerDate('0918-02柜', new Date('2025-12-31T16:00:00Z')), '2026-09-18')
  assert.equal(logic.previewContainerDate('0918柜', new Date('2024-06-01T00:00:00Z')), '2024-09-18')
  assert.equal(logic.previewContainerDate('0229柜', new Date('2024-06-01T00:00:00Z')), '2024-02-29')
  assert.equal(logic.previewContainerDate('0229柜', new Date('2026-06-01T00:00:00Z')), null)
  assert.equal(logic.previewContainerDate('0230柜', new Date('2026-06-01T00:00:00Z')), null)
  assert.equal(logic.previewContainerDate('0918-00柜', new Date('2026-06-01T00:00:00Z')), null)
})

test('field validation uses the latest input value before model synchronization', async () => {
  const container = await modalFixture('container')
  const item = await modalFixture('loading-item')
  try {
    assert.equal(container.state.rule('containerBatchName')('0919-01柜'), true)
    container.state.draft.value.containerBatchName = '0919-01柜'
    assert.notEqual(container.state.rule('containerBatchName')('invalid'), true)
    assert.equal(container.state.rule('warehouseValue')('b5'), true)
    assert.equal(item.state.rule('goodsName')('产品'), true)
    item.state.draft.value.lengthCm = '1.000'
    assert.notEqual(item.state.rule('lengthCm')('0'), true)
  }
  finally {
    container.dispose()
    item.dispose()
  }
})
