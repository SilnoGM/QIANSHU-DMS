import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证页面读取与身份隔离。
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useContainerResource } from '../../src/views/workbenches/containers/use-container-resource'

async function flush() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}
test('查询切换和身份变化后，迟到响应不能覆盖当前页面', async () => {
  const active = ref(true)
  const epoch = ref(1)
  const key = ref('a')
  const calls: {
    signal: AbortSignal
    resolve: (value: string) => void
  }[] = []
  const scope = effectScope()
  const state = scope.run(() => useContainerResource(active, epoch, key, signal => new Promise<string>(resolve => calls.push({ signal, resolve }))))!
  await flush()
  key.value = 'b'
  await flush()
  assert.equal(calls[0].signal.aborted, true)
  calls[1].resolve('new')
  await flush()
  calls[0].resolve('old')
  await flush()
  assert.equal(state.data.value, 'new')
  epoch.value++
  await flush()
  assert.equal(state.data.value, null)
  active.value = false
  await flush()
  calls[2].resolve('private')
  await flush()
  assert.equal(state.data.value, null)
  scope.stop()
})
test('错误可重试，销毁时取消在途读取', async () => {
  let fail = true
  const scope = effectScope()
  let signal: AbortSignal
  const state = scope.run(() => useContainerResource(ref(true), ref(1), ref('x'), async (s) => {
    signal = s
    if (fail) {
      throw new Error('failed')
    }
    return 7
  }))!
  await flush()
  assert.ok(state.error.value)
  fail = false
  await state.reload()
  assert.equal(state.data.value, 7)
  assert.equal(state.error.value, '')
  scope.stop()
  assert.equal(signal!.aborted, true)
})
