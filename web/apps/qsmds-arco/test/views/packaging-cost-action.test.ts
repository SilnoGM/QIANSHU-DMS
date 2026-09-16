import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 运行真实事件处理脚本，检查轻提示没有业务写入。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, ref, watch } from 'vue'

test('费用表单展示关联单据信息，提交仅信息提示，未关联或加载期间不可提交', async (context) => {
  const source = await readFile(new URL('../../src/views/operations/warehouse-arrivals/packaging-cost-action.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const eligible = ref(true)
  const unavailableReason = ref<string | null>(null)
  const info: string[] = []
  const events: string[] = []
  const record = { id: 'part-1', shipmentNo: 'PKG-1', shippingMarkText: 'MARK-1', purchaseOrder: { orderNo: 'PO-1' }, salesSource: { orderNo: 'SO-1' } }
  const scope = effectScope()
  context.after(() => scope.stop())
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}\n;({ context, submit, visible, submitDisabledHint })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    computed,
    ref,
    watch,
    defineProps: () => ({ shipment: record, enabled: true }),
    defineEmits: () => (name: string) => events.push(name),
    useI18n: () => ({ t: (key: string) => key }),
    useAppAccountStore: () => ({ authEpoch: 1 }),
    useQsToast: () => ({ info: (message: string) => info.push(message), success: () => assert.fail('prototype must not report success') }),
    usePackagingCostContext: () => ({ shipment: ref(record), owner: ref({ displayName: '销售出单人' }), loading: ref(false), error: ref(''), eligible, unavailableReason, reload: () => {} }),
    fetch: () => assert.fail('prototype must not send requests'),
  })) as { context: { value: Record<string, string> }, submit: () => void, visible: { value: boolean }, submitDisabledHint: { value: string } }
  assert.deepEqual(JSON.parse(JSON.stringify(state.context.value)), { shipmentId: 'part-1', shipmentNo: 'PKG-1', shippingMarkText: 'MARK-1', purchaseOrderNo: 'PO-1', salesOrderNo: 'SO-1', ownerName: '销售出单人' })
  state.submit()
  assert.deepEqual(info, ['warehousePackagingCost.submitUnavailable'])
  assert.equal(state.visible.value, true)
  eligible.value = false
  unavailableReason.value = 'noSalesSource'
  state.submit()
  assert.equal(info.length, 1)
  assert.equal(state.submitDisabledHint.value, 'warehousePackagingCost.noSalesSource')
  state.visible.value = false
  assert.deepEqual(events, ['close'])
})
