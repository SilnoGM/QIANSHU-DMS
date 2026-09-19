import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 与业务逻辑测试保持一致。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, ref } from 'vue'
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
  }) as Array<{ id: string, defaultVisible?: boolean, accessorFn?: (row: Record<string, unknown>) => unknown }>
  assert.ok(columns.every(column => column.defaultVisible !== false))
  for (const id of ['reportedVolumeCai', 'volumeDifferenceCai', 'recipient', 'codAmountTwd', 'remark', 'source']) {
    assert.ok(columns.some(column => column.id === id), id)
  }
  const display = (id: string, row: Record<string, unknown>) => columns.find(column => column.id === id)!.accessorFn!(row)
  assert.equal(display('grossWeightKg', { grossWeightKg: '180.000' }), '180')
  assert.equal(display('dimensions', { lengthCm: '128.000', widthCm: '19.000', heightCm: '15.000' }), '128 × 19 × 15')
  assert.equal(display('volumeCai', { volumeCai: '12.88272063' }), '12.88')
  assert.equal(display('reportedVolumeCai', { reportedVolumeCai: '12.885' }), '12.89')
  assert.equal(display('volumeDifferenceCai', { volumeDifferenceCai: '-0.125' }), '-0.13')
  assert.equal(display('reportedVolumeCai', { reportedVolumeCai: null }), 'containerPage.unknown')
  assert.ok(!columns.some(column => ['purchaseOrderNo', 'salesOrderNo'].includes(column.id)))
  assert.equal(display('source', { salesOrderNo: 'SO/001', purchaseOrderNo: 'PO/001' }), 'SO/001 PO/001')
})
