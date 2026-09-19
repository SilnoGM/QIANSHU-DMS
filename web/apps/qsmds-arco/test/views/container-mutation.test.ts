import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证写入锁和不确定结果重放。
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { useContainerMutation } from '../../src/views/workbenches/containers/use-container-mutation'

test('结果未知后保留原始内容和幂等键，重复点击不会新增请求', async () => {
  const scope = effectScope()
  const calls: {
    payload: {
      value: number
    }
    key: string
  }[] = []
  let reject!: (error: unknown) => void
  let failed = true
  const state = scope.run(() => useContainerMutation(ref(true), ref(1), async (payload: {
    value: number
  }, key: string) => {
    calls.push({ payload, key })
    if (failed) {
      return new Promise<number>((_, no) => {
        reject = no
      })
    }
    return 7
  }))!
  const first = state.submit({ value: 1 })
  await state.submit({ value: 2 })
  assert.equal(calls.length, 1)
  reject({ kind: 'network', message: 'offline' })
  await first
  assert.equal(state.retryOnly.value, true)
  failed = false
  const result = await state.submit({ value: 99 })
  assert.equal(result, 7)
  assert.deepEqual(calls[1], calls[0])
  assert.equal(state.retryOnly.value, false)
  scope.stop()
})

test('同身份切页保留未决请求，切换身份销毁旧请求', async () => {
  const scope = effectScope()
  const enabled = ref(true)
  const epoch = ref(1)
  const calls: string[] = []
  const state = scope.run(() => useContainerMutation(enabled, epoch, async (_payload: { value: number }, key) => {
    calls.push(key)
    throw Object.assign(new Error('offline'), { kind: 'network' })
  }))!
  await state.submit({ value: 1 })
  enabled.value = false
  await nextTick()
  enabled.value = true
  await nextTick()
  await state.submit({ value: 2 })
  assert.equal(calls[0], calls[1])
  epoch.value++
  await nextTick()
  await state.submit({ value: 3 })
  assert.notEqual(calls[1], calls[2])
  scope.stop()
})
