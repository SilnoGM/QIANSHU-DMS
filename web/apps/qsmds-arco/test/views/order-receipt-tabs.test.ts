import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 执行真实提交处理，验证双标签状态转换。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'

const source = readFileSync(new URL('../../src/views/operations/sales-orders/sales-order-records-modal.vue', import.meta.url), 'utf8')
const ast = ts.createSourceFile('records.ts', parse(source).descriptor.scriptSetup!.content, ts.ScriptTarget.Latest, true)
const submit = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'submitPayment')!
const compiled = ts.transpileModule(submit.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

test('订单收款打开默认停在实际收款页签并显示有效/待审计数', () => {
  assert.match(source, /const activeReceiptTab = ref<'payments' \| 'requests'>\('payments'\)/u)
  assert.match(source, /initialReceiptTab: SalesOrderReceiptTab/u)
  assert.match(source, /receiptPage\.value = 1[\s\S]{0,160}activeReceiptTab\.value = props\.initialReceiptTab/u)
  assert.match(source, /实际收款（有效：\$\{validPaymentCount\.value\}\/\$\{totalPaymentCount\.value\}）/u)
  assert.match(source, /收款申请（待审：\$\{pendingReceiptCount\.value\}\/\$\{totalReceiptCount\.value\}）/u)
  assert.equal(source.match(/<QsStatusSwitchToolbar/gu)?.length, 2)
  assert.match(source, /:items="receiptTabItems"[\s\S]{0,80}stretch/u)
  assert.match(source, /:items="receiptFilterItems"/u)
  assert.match(source, /count: totalReceiptCount\.value/u)
  assert.match(source, /count: pendingReceiptCount\.value/u)
  assert.equal(source.match(/待审核金额不计入有效已收款/gu)?.length, 1)
  assert.doesNotMatch(source, /<\/p>\s*<p[^>]*>\s*表内代收/u)
})

for (const fails of [false, true]) {
  test(`收款申请提交${fails ? '失败保留当前界面' : '成功显示第一页新申请并刷新摘要'}`, async () => {
    const events: string[] = []
    const sandbox = {
      detail: { value: { id: 'order' } },
      actionLocked: { value: false },
      canRecordPayment: { value: true },
      receiptSubmission: { value: { payload: {}, idempotencyKey: 'stable' } },
      receiptUnknown: { value: false },
      actionAbortController: null,
      actionSubmitting: { value: false },
      actionError: { value: '' },
      modalState: { value: { origin: 'records', view: 'create-payment' } },
      activeReceiptTab: { value: 'payments' },
      receiptFilter: { value: 'REJECTED' },
      receiptPage: { value: 3 },
      focusedReceiptId: { value: null },
      AbortController,
      salesReceiptsApi: { submit: async () => {
        if (fails) {
          throw new Error('failed')
        }
        return { data: { id: 'new-request' } }
      } },
      resetPaymentForm: () => events.push('reset'),
      toast: { success: () => events.push('success') },
      loadDetail: async () => events.push('load'),
      emit: () => events.push('updated'),
      t: (key: string) => key,
      isReceiptResultUnknown: () => false,
      getSalesOrderApiFailure: () => ({ message: 'failed' }),
    }
    await (runInNewContext(`${compiled}\nsubmitPayment`, sandbox) as () => Promise<void>)()
    assert.equal(sandbox.actionSubmitting.value, false)
    if (fails) {
      assert.equal(sandbox.modalState.value.view, 'create-payment')
      assert.equal(sandbox.activeReceiptTab.value, 'payments')
      assert.deepEqual(events, [])
    }
    else {
      assert.equal(sandbox.modalState.value.view, 'records')
      assert.equal(sandbox.activeReceiptTab.value, 'requests')
      assert.equal(sandbox.receiptFilter.value, 'ALL')
      assert.equal(sandbox.receiptPage.value, 1)
      assert.equal(sandbox.focusedReceiptId.value, 'new-request')
      assert.deepEqual(events, ['reset', 'success', 'load', 'updated'])
    }
  })
}
