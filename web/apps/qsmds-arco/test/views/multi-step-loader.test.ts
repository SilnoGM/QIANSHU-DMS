import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 用可控时钟执行真实组件脚本，验证全局加载时长及取消后的异步隔离。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { effectScope, nextTick, onScopeDispose, reactive, ref, watch } from 'vue'
import { parse } from 'vue/compiler-sfc'

interface Step { text: string, name?: string, action?: (context: Record<string, unknown>) => Promise<unknown> }
async function fixture(steps: Step[], loading = false) {
  const source = await readFile(new URL('../../../../packages/components/src/pro/multi-step-loader/index.vue', import.meta.url), 'utf8')
  const script = parse(source).descriptor.scriptSetup!.content.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '').replace(/^export /gm, '')
  const props = reactive({ loading, steps, preventClose: true })
  const events: { name: string, values: unknown[], at: number }[] = []
  let now = 0
  let id = 0
  const timers = new Map<number, { at: number, action: () => void }>()
  const scope = effectScope()
  scope.run(() => runInNewContext(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    ref,
    watch,
    onScopeDispose,
    defineOptions: () => {},
    defineProps: () => props,
    withDefaults: (value: unknown) => value,
    defineEmits: () => (name: string, ...values: unknown[]) => events.push({ name, values, at: now }),
    performance: { now: () => now },
    setTimeout: (action: () => void, delay: number) => {
      const timerId = ++id
      timers.set(timerId, { at: now + delay, action })
      return timerId
    },
    clearTimeout: (timerId: number) => timers.delete(timerId),
  }))
  const flush = async () => {
    for (let i = 0; i < 12; i++) {
      await Promise.resolve()
    }
    await nextTick()
  }
  async function advance(ms: number) {
    const target = now + ms
    await flush()
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
      if (!entry || entry[1].at > target) {
        break
      }
      now = entry[1].at
      timers.delete(entry[0])
      entry[1].action()
      await flush()
    }
    now = target
    await flush()
  }
  return { props, events, timers, advance, flush, dispose: () => scope.stop(), start: async () => {
    props.loading = true
    await flush()
  } }
}

test('快速多步骤总时长为两秒，步骤有序推进并传递结果', async (context) => {
  const calls: unknown[] = []
  const f = await fixture([
    { text: '读取', name: 'order', action: async () => {
      calls.push('read')
      return 'order-a'
    } },
    { text: '计算', action: async (data) => { calls.push(data.order) } },
    { text: '生成', action: async () => { calls.push('render') } },
  ])
  context.after(f.dispose)
  await f.start()
  await f.advance(1999)
  assert.equal(f.events.some(event => event.name === 'complete'), false)
  await f.advance(1)
  assert.deepEqual(calls, ['read', 'order-a', 'render'])
  assert.deepEqual(f.events.filter(event => event.name === 'stateChange').map(event => event.values[0]), [1, 2])
  assert.equal(f.events.find(event => event.name === 'complete')?.at, 2000)
})

test('业务处理已超过两秒时完成后立即结束，不额外叠加等待', async (context) => {
  let resolve!: () => void
  const f = await fixture([{ text: '慢请求', action: () => new Promise<void>(done => resolve = done) }, { text: '完成' }])
  context.after(f.dispose)
  await f.start()
  await f.advance(2500)
  assert.equal(f.events.some(event => event.name === 'complete'), false)
  resolve()
  await f.flush()
  assert.equal(f.events.find(event => event.name === 'complete')?.at, 2500)
  assert.equal(f.timers.size, 0)
})

test('关闭或卸载时清除最小时长计时，后续步骤不再执行', async (context) => {
  for (const dispose of [false, true]) {
    let laterCalls = 0
    const f = await fixture([{ text: '读取' }, { text: '写入', action: async () => {
      laterCalls++
    } }])
    context.after(f.dispose)
    await f.start()
    assert.equal(f.timers.size, 1)
    if (dispose) {
      f.dispose()
    }
    else {
      f.props.loading = false
      await f.flush()
    }
    assert.equal(f.timers.size, 0)
    await f.advance(3000)
    assert.equal(laterCalls, 0)
    assert.equal(f.events.some(event => event.name === 'complete'), false)
  }
})

test('重新打开后旧请求迟到不得推进新流程或产生完成事件', async (context) => {
  let finishOld!: () => void
  let laterCalls = 0
  const f = await fixture([{ text: '旧请求', action: () => new Promise<void>(done => finishOld = done) }, { text: '旧后续', action: async () => {
    laterCalls++
  } }])
  context.after(f.dispose)
  await f.start()
  f.props.loading = false
  await f.flush()
  f.props.steps = [{ text: '新流程' }]
  await f.start()
  finishOld()
  await f.flush()
  await f.advance(2000)
  assert.equal(laterCalls, 0)
  assert.equal(f.events.filter(event => event.name === 'complete').length, 1)
  assert.equal(f.events.some(event => event.name === 'error'), false)
})

test('错误立即反馈，首次以加载状态挂载也遵守两秒最短时长', async (context) => {
  const failure = new Error('Read failed')
  const f = await fixture([{ text: '失败', action: async () => {
    throw failure
  } }])
  context.after(f.dispose)
  await f.start()
  assert.equal(f.events.find(event => event.name === 'error')?.values[0], failure)
  assert.equal(f.timers.size, 0)
  const initial = await fixture([{ text: '初始加载' }], true)
  context.after(initial.dispose)
  await initial.advance(2000)
  assert.equal(initial.events.find(event => event.name === 'complete')?.at, 2000)
})
