import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 执行真实提交函数验证成功关闭与失败保留。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'

const source = readFileSync(new URL('../../src/views/workbenches/sales-receipts/receipt-detail.vue', import.meta.url), 'utf8')
const script = parse(source).descriptor.scriptSetup!.content
const ast = ts.createSourceFile('receipt-detail.ts', script, ts.ScriptTarget.Latest, true)
const submit = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'submit')!
// 执行组件实际函数而非复制实现，API 替身避免测试产生真实资金操作。
const compiled = ts.transpileModule(submit.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function fixture(fails = false) {
  const events: string[] = []
  const busy = { value: false }
  const context = { value: { expectedContext: {} } as object | null }
  const contextError = { value: '' }
  const sandbox = {
    detail: { value: { id: 'receipt', version: 1 } },
    action: { value: 'approve' },
    busy,
    context,
    contextError,
    reason: { value: '' },
    controller: new AbortController(),
    salesReceiptsApi: { approve: async () => {
      if (fails) {
        throw new Error('request failed')
      }
    } },
    toast: { success: () => events.push('success') },
    emit: (event: string) => events.push(event),
    load: async () => events.push('reload-detail'),
    t: (key: string) => key,
    getSalesOrderApiFailure: (error: Error) => ({ message: error.message }),
  }
  const run = runInNewContext(`${compiled}\nsubmit`, sandbox) as () => Promise<void>
  return { run, events, busy, context, contextError }
}

test('审核成功关闭详情并通知列表刷新，不重新加载已完成详情', async () => {
  const state = fixture()
  await state.run()
  assert.ok(state.events.includes('close'))
  assert.ok(state.events.includes('changed'))
  assert.ok(!state.events.includes('reload-detail'))
  assert.equal(state.busy.value, false)
})

test('审核失败保留弹窗并撤销旧预览，显示失败原因', async () => {
  const state = fixture(true)
  await state.run()
  assert.deepEqual(state.events, [])
  assert.equal(state.context.value, null)
  assert.match(state.contextError.value, /request failed/u)
  assert.equal(state.busy.value, false)
})
