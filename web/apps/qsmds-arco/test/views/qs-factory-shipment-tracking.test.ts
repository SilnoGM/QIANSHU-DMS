import type { FactoryShipmentIntent, FactoryShipmentModalContext } from '../../src/components/business/QsFactoryShipmentModal/types'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行实际弹窗脚本，验证物流单号草稿生命周期。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import * as logic from '../../src/components/business/QsFactoryShipmentModal/logic'

async function createFixture() {
  const source = await readFile(new URL('../../src/components/business/QsFactoryShipmentModal/index.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const context: FactoryShipmentModalContext = {
    salesOrder: null,
    purchaseOrders: [{
      id: 'po-1',
      orderNo: 'PO/1',
      orderDate: '2026-09-15',
      supplier: { label: '供应商' },
      fulfillmentStatus: 'PREPARING',
      version: 2,
      shippingMarkText: null,
      lineSummary: { lineCount: 0, totalQuantity: 0, previews: [] },
      parts: ['part-1', 'part-2'].map((id, index) => ({ id, shipmentNo: null, partNumber: index + 1, status: 'ACTIVE', shippingMarkText: null, shippedAt: null, shippedById: null, shipmentRecordedAt: null, shipmentRemark: null, items: [] })),
    }],
  }
  const props = reactive({ modelValue: true, mode: 'PURCHASE_ORDER', context, loading: false, submitting: false, error: null })
  const warehouseCatalog = { selectableItems: ref([{ value: 'CN-WH-01' }, { value: 'CN-WH-02' }]) }
  const submitted: FactoryShipmentIntent[] = []
  const stops: Array<() => void> = []
  const state = runInNewContext(ts.transpileModule(`${script}\n;({ togglePart, setSelectionMode, updateTrackingNo, updateDestinationWarehouse, submit, trackingNumbersByPart, destinationWarehousesByPart, selectedIds, canSubmit })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, {
    ...logic,
    useFactoryShipmentWarehouseCatalog: () => warehouseCatalog,
    ref,
    computed,
    watch: (...args: Parameters<typeof watch>) => stops.push(watch(...args)),
    defineProps: () => props,
    withDefaults: (value: unknown) => value,
    defineOptions: () => {},
    defineEmits: () => (name: string, intent: FactoryShipmentIntent) => {
      if (name === 'submit') {
        submitted.push(intent)
      }
    },
  }) as {
    togglePart: (id: string) => void
    setSelectionMode: (mode: 'SELECTED' | 'ALL_PENDING') => void
    updateTrackingNo: (id: string, value: string) => void
    updateDestinationWarehouse: (id: string, value: string | null) => void
    destinationWarehousesByPart: { value: Record<string, string | null> }
    submit: () => void
    trackingNumbersByPart: { value: Record<string, string> }
    selectedIds: { value: string[] }
    canSubmit: { value: boolean }
  }
  return { state, props, submitted, warehouseCatalog, dispose: () => stops.forEach(stop => stop()) }
}

test('取消选择保留物流草稿但不提交，重新选择恢复；关闭重开和切换上下文清空', async (context) => {
  const fixture = await createFixture()
  context.after(fixture.dispose)
  const { state, props, submitted } = fixture
  state.updateDestinationWarehouse('part-1', 'CN-WH-01')
  state.updateDestinationWarehouse('part-2', 'CN-WH-02')
  state.togglePart('part-1')
  state.updateTrackingNo('part-1', '  ＳＦab-123  ')
  state.togglePart('part-1')
  state.togglePart('part-2')
  state.submit()
  assert.equal(submitted[0]?.targets[0]?.trackingNumbers, undefined)
  assert.equal(state.trackingNumbersByPart.value['part-1'], '  ＳＦab-123  ')
  state.togglePart('part-1')
  state.submit()
  assert.equal(submitted[1]?.targets[0]?.trackingNumbers?.[0]?.trackingNo, 'ＳＦab-123')
  props.modelValue = false
  await nextTick()
  props.modelValue = true
  await nextTick()
  assert.equal(Object.keys(state.trackingNumbersByPart.value).length, 0)
  assert.equal(state.selectedIds.value.length, 0)
  state.updateTrackingNo('part-1', 'new draft')
  props.context = { ...props.context }
  await nextTick()
  assert.equal(Object.keys(state.trackingNumbersByPart.value).length, 0)
})

test('只校验选中货件的物流号，清空错误后允许提交，提交中禁止修改或重复提交', async (context) => {
  const fixture = await createFixture()
  context.after(fixture.dispose)
  const { state, props, submitted } = fixture
  state.updateDestinationWarehouse('part-1', 'CN-WH-01')
  state.updateDestinationWarehouse('part-2', 'CN-WH-02')
  state.updateTrackingNo('part-1', 'A\nB')
  state.togglePart('part-2')
  assert.equal(state.canSubmit.value, true)
  state.setSelectionMode('ALL_PENDING')
  assert.equal(state.canSubmit.value, false)
  state.submit()
  assert.equal(submitted.length, 0)
  state.updateTrackingNo('part-1', '')
  assert.equal(state.canSubmit.value, true)
  state.updateTrackingNo('part-2', 'JD123')
  props.submitting = true
  state.updateTrackingNo('part-2', 'changed')
  state.togglePart('part-2')
  state.submit()
  assert.equal(state.trackingNumbersByPart.value['part-2'], 'JD123')
  assert.equal(state.selectedIds.value.length, 2)
  assert.equal(submitted.length, 0)
})

test('目的地仓库逐货件必填，字典失效与停用立即阻止提交，草稿随取消勾选保留', async (context) => {
  const fixture = await createFixture()
  context.after(fixture.dispose)
  const { state, props, submitted, warehouseCatalog } = fixture
  state.togglePart('part-1')
  assert.equal(state.canSubmit.value, false)
  state.submit()
  assert.equal(submitted.length, 0)
  state.updateDestinationWarehouse('part-1', 'CN-WH-01')
  assert.equal(state.canSubmit.value, true)
  state.togglePart('part-1')
  state.togglePart('part-2')
  assert.equal(state.canSubmit.value, false)
  assert.equal(state.destinationWarehousesByPart.value['part-1'], 'CN-WH-01')
  state.updateDestinationWarehouse('part-2', 'CN-WH-02')
  state.submit()
  assert.equal(JSON.stringify(submitted[0]?.targets[0]?.destinationWarehouses), JSON.stringify([{ partId: 'part-2', warehouseValue: 'CN-WH-02' }]))
  warehouseCatalog.selectableItems.value = []
  assert.equal(state.canSubmit.value, false)
  warehouseCatalog.selectableItems.value = [{ value: 'CN-WH-01' }]
  assert.equal(state.canSubmit.value, false)
  state.updateDestinationWarehouse('part-2', 'CN-WH-01')
  assert.equal(state.canSubmit.value, true)
  props.submitting = true
  state.updateDestinationWarehouse('part-2', 'CN-WH-02')
  assert.equal(state.destinationWarehousesByPart.value['part-2'], 'CN-WH-01')
  props.submitting = false
  props.modelValue = false
  await nextTick()
  assert.equal(Object.keys(state.destinationWarehousesByPart.value).length, 0)
  props.modelValue = true
  await nextTick()
  state.updateDestinationWarehouse('part-1', 'CN-WH-01')
  props.context = { ...props.context }
  await nextTick()
  assert.equal(Object.keys(state.destinationWarehousesByPart.value).length, 0)
})
