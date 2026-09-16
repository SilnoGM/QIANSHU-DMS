import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行真实提报事件，确保仅成功才关闭且正确检查权限。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, ref, watch } from 'vue'

test('费用表单展示销售归属，权限和来源通过后提交，失败不关闭，成功通知财务列表', async (context) => {
  const source = await readFile(new URL('../../src/views/operations/warehouse-arrivals/packaging-cost-action.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
  const eligible = ref(true)
  const permission = ref(true)
  const unavailableReason = ref<string | null>(null)
  const success: string[] = []
  const submitted: unknown[] = []
  const events: string[] = []
  let result: unknown = null
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
    useAppAuth: () => ({ auth: () => permission.value }),
    useAppAccountStore: () => ({ authEpoch: 1 }),
    useQsToast: () => ({ success: (message: string) => success.push(message) }),
    usePackagingCostContext: () => ({ context: ref({ shipmentNo: 'PKG-1', shippingMarkText: 'MARK-1', purchaseOrderNo: 'PO-1', salesOrderNo: 'SO-1', owner: { name: '销售出单人' } }), loading: ref(false), error: ref(''), eligible, unavailableReason, reload: () => {} }),
    usePackagingCostSubmission: () => ({ submit: async (draft: unknown) => {
      submitted.push(draft)
      return result
    }, busy: ref(false), error: ref(''), pending: ref(false) }),
  })) as { context: { value: Record<string, string> }, submit: (value: unknown) => Promise<void>, visible: { value: boolean }, submitDisabledHint: { value: string } }
  assert.deepEqual(JSON.parse(JSON.stringify(state.context.value)), { shipmentId: 'part-1', shipmentNo: 'PKG-1', shippingMarkText: 'MARK-1', purchaseOrderNo: 'PO-1', salesOrderNo: 'SO-1', ownerName: '销售出单人' })
  await state.submit({ amount: '10.00' })
  assert.equal(state.visible.value, true)
  assert.equal(success.length, 0)
  eligible.value = false
  unavailableReason.value = 'noSalesSource'
  await state.submit({})
  assert.equal(submitted.length, 1)
  assert.equal(state.submitDisabledHint.value, 'warehousePackagingCost.noSalesSource')
  eligible.value = true
  permission.value = false
  await state.submit({})
  assert.equal(submitted.length, 1)
  permission.value = true
  result = { id: 'request' }
  await state.submit({ amount: '10.00' })
  assert.deepEqual(success, ['warehousePackagingCost.submitSuccess'])
  assert.equal(state.visible.value, false)
  assert.deepEqual(events, ['submitted', 'close'])
})
