import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 与业务逻辑测试保持一致。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, ref, shallowRef, watch } from 'vue'
import { CONTAINER_ITEM_ACTION_COLUMN_WIDTH } from '../../src/views/workbenches/containers/action-column.logic'
import { formatContainerMeasurement } from '../../src/views/workbenches/containers/display.logic'

test('装柜尺寸和重量以整数显示，按十进制四舍五入且不丢失大数精度', () => {
  assert.equal(formatContainerMeasurement('128.000', 0), '128')
  assert.equal(formatContainerMeasurement('403.500', 0), '404')
  assert.equal(formatContainerMeasurement('403.499', 0), '403')
  assert.equal(formatContainerMeasurement('999999999999999.999', 0), '1000000000000000')
})

test('系统材积固定两位小数，未知值保持为空', () => {
  const original = '12.88272063'
  assert.equal(formatContainerMeasurement(original, 2), '12.88')
  assert.equal(formatContainerMeasurement('1.00500000', 2), '1.01')
  assert.equal(formatContainerMeasurement('3', 2), '3.00')
  assert.equal(formatContainerMeasurement('0', 2), '0.00')
  assert.equal(formatContainerMeasurement(null, 2), null)
  assert.equal(formatContainerMeasurement('-0.00240280', 2), '0.00')
  assert.equal(formatContainerMeasurement('-0.005', 2), '-0.01')
})

test('装柜明细默认展示所有业务列，桌面数值采用指定精度', async () => {
  const source = await readFile(new URL('../../src/views/workbenches/containers/container-item-table.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import.*$/gm, '')
  const columns = runInNewContext(ts.transpileModule(`${script}\n;columns.value`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    computed,
    formatContainerMeasurement,
    defineProps: () => ({}),
    defineEmits: () => () => {},
    defineModel: () => ref(),
    useI18n: () => ({ t: (key: string) => key }),
    useAppAuth: () => ({ auth: () => true }),
    useRouter: () => ({}),
    useCurrencyCatalog: () => ({ currencies: ref([]), errorMessage: ref(null), reload: () => {} }),
  }) as Array<{ id: string, defaultVisible?: boolean, accessorFn?: (row: Record<string, unknown>) => unknown }>
  assert.ok(columns.every(column => column.defaultVisible !== false))
  for (const id of ['reportedVolumeCai', 'volumeDifferenceCai', 'recipient', 'codAmountTwd', 'remark', 'source']) {
    assert.ok(columns.some(column => column.id === id), id)
  }
  const display = (id: string, row: Record<string, unknown>) => columns.find(column => column.id === id)!.accessorFn!(row)
  assert.equal(display('weightDimensions', { grossWeightKg: '1173.000', lengthCm: '240.000', widthCm: '164.000', heightCm: '108.000' }), '1173 kg 240 × 164 × 108 cm')
  assert.equal(display('volumeCai', { volumeCai: '12.88272063' }), '12.88')
  assert.equal(display('reportedVolumeCai', { reportedVolumeCai: '12.885' }), '12.89')
  assert.equal(display('volumeDifferenceCai', { volumeDifferenceCai: '-0.125' }), '-0.13')
  assert.equal(display('reportedVolumeCai', { reportedVolumeCai: null }), 'containerPage.unknown')
  assert.ok(!columns.some(column => ['purchaseOrderNo', 'salesOrderNo'].includes(column.id)))
  assert.equal(display('source', { salesOrderNo: 'SO/001', purchaseOrderNo: 'PO/001' }), 'SO/001 PO/001')
})

test('装柜明细桌面操作列单行容纳两个四字详情与更多菜单', async () => {
  // 24px 内边距 + 80 + 4 + 80 + 4 + 32 + 8px 缓冲。
  assert.equal(CONTAINER_ITEM_ACTION_COLUMN_WIDTH, 232)
  const source = await readFile(new URL('../../src/views/workbenches/containers/container-item-table.vue', import.meta.url), 'utf8')
  assert.match(source, /:action-column="actionColumn"/u)

  // 固定两列网格会让第三个子项（更多）掉到第二行；桌面端必须覆盖为单行 flex。
  const wrapperClass = source.match(/<template #actions="\{ row \}">\s*<div class="([^"]+)">/u)?.[1] ?? ''
  const wrapperClasses = wrapperClass.split(/\s+/u)
  assert.ok(wrapperClasses.includes('grid-cols-2'), '移动端保留两列操作区')
  assert.ok(wrapperClasses.includes('md:flex'), '桌面端必须改成单行 flex')
  assert.ok(wrapperClasses.includes('md:flex-wrap'))
  assert.ok(wrapperClasses.includes('md:items-center'))
})

test('柜次详情汇总按整数重量和两位材积展示，缺值不会被当成零', async (context) => {
  const source = await readFile(new URL('../../src/views/workbenches/containers/detail.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import.*$/gm, '')
  const batch = ref<Record<string, unknown> | null>(null)
  let resourceCalls = 0
  const scope = effectScope()
  context.after(() => scope.stop())
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ summary, warehouseLabel })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    computed,
    ref,
    shallowRef,
    watch,
    formatContainerMeasurement,
    defineOptions: () => {},
    useI18n: () => ({ t: (key: string) => key === 'containerManagement.volumeUnit' ? '材' : key }),
    useRouter: () => ({}),
    useRoute: () => ({ name: 'qsPurchaseTransportContainerDetail', params: { id: 'batch-1' } }),
    useAppAuth: () => ({ auth: () => true }),
    useAppAccountStore: () => ({ authEpoch: 1 }),
    useQsToast: () => ({}),
    useDictionaryCatalog: () => ({ loading: ref(false), missing: ref(false), error: ref(null), resolve: () => ({ status: 'ENABLED', displayLabel: 'B5仓' }) }),
    useContainerResource: () => ({ data: resourceCalls++ === 0 ? batch : ref(null), loading: ref(false), error: ref('') }),
    useContainerMutation: () => ({}),
    useContainerImportParse: () => ({ parsing: ref(false), error: ref(''), steps: ref([]), start: () => {}, complete: () => null, fail: () => false, reset: () => {} }),
    onActivated: () => {},
    onDeactivated: () => {},
    onScopeDispose: () => {},
  })) as { summary: { value: Array<{ label: string, amount: unknown, unit?: string }> }, warehouseLabel: { value: string } }
  batch.value = { itemCount: 2, shipmentCount: 1, packageCountTotal: 10, grossWeightKgTotal: '1173.000', volumeCaiTotal: '150.11759720', chargeableVolumeCaiTotal: 151, warehouseValue: 'B5' }
  const amount = (label: string) => state.summary.value.find(item => item.label === label)?.amount
  assert.equal(amount('totalWeightLabel'), '1173')
  assert.equal(amount('totalVolumeLabel'), '150.12')
  assert.equal(state.summary.value.find(item => item.label === 'totalWeightLabel')?.unit, 'kg')
  assert.equal(state.summary.value.find(item => item.label === 'totalVolumeLabel')?.unit, '材')
  assert.equal(state.warehouseLabel.value, 'B5仓')
  batch.value = { ...batch.value, grossWeightKgTotal: null, volumeCaiTotal: null }
  assert.equal(amount('totalWeightLabel'), null)
  assert.equal(amount('totalVolumeLabel'), null)
})
