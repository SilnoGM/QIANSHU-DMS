import type { DictionaryCatalog, DictionaryCatalogProvider } from '../../src/dictionary-catalog/types'
import type { DictionaryCatalogConsumer } from '../../src/dictionary-catalog/use-dictionary-catalog'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 实际挂载父子 Catalog 消费者，覆盖重试与缓存恢复链。
import test from 'node:test'
import { createRenderer, defineComponent, h, inject, provide } from 'vue'
import { validateDestinationWarehouse } from '../../src/components/business/QsFactoryShipmentModal/logic'
import { useFactoryShipmentWarehouseCatalog } from '../../src/components/business/QsFactoryShipmentModal/use-warehouse-catalog'
import { dictionaryCatalogProviderKey } from '../../src/dictionary-catalog/injection'
import { createDictionaryCatalogProviderController, DICTIONARY_CATALOG_CACHE_TTL_MS } from '../../src/dictionary-catalog/provider'
import { useDictionaryCatalog } from '../../src/dictionary-catalog/use-dictionary-catalog'

function warehouse(value = 'CN-WH-01'): DictionaryCatalog {
  return { code: 'mainland.warehouse', name: '目的地仓库', enabled: true, items: [{ value, label: '长沙仓', enabled: true, effectiveEnabled: true, tone: 'DEFAULT', sortOrder: 0 }] }
}

async function mountConsumers() {
  let parent!: DictionaryCatalogConsumer
  const children: DictionaryCatalogConsumer[] = []
  let downstream!: DictionaryCatalogProvider
  let gate: Promise<void> | null = null
  let offline = true
  let now = 0
  let response = warehouse()
  let requests = 0
  let providerGets = 0
  const controller = createDictionaryCatalogProviderController({
    identitySource: { getSnapshot: () => ({ authEpoch: 1, userId: 'user-1' }), subscribe: () => () => {} },
    now: () => now,
    loader: {
      get: async ({ code }) => {
        requests += 1
        if (gate) {
          await gate
        }
        if (offline) {
          throw new Error('offline')
        }
        return { ...response, code }
      },
      batch: async () => ({ dictionaries: [], missingCodes: [] }),
    },
  })
  const provider = { ...controller.provider, get: (input: Parameters<typeof controller.provider.get>[0]) => {
    providerGets += 1
    return controller.provider.get(input)
  } }
  const Child = defineComponent({ setup() {
    downstream = inject(dictionaryCatalogProviderKey)!
    children.push(useDictionaryCatalog('mainland.warehouse'))
    return () => h('span')
  } })
  const Parent = defineComponent({ setup() {
    parent = useFactoryShipmentWarehouseCatalog()
    return () => h('div', [h(Child), h(Child)])
  } })
  const Root = defineComponent({ setup() {
    provide(dictionaryCatalogProviderKey, provider)
    return () => h(Parent)
  } })
  interface Node { parent: Node | null }
  const renderer = createRenderer<Node, Node>({
    createElement: () => ({ parent: null }),
    createText: () => ({ parent: null }),
    createComment: () => ({ parent: null }),
    insert: (child, parent) => { child.parent = parent },
    remove: () => {},
    patchProp: () => {},
    setText: () => {},
    setElementText: () => {},
    parentNode: node => node.parent,
    nextSibling: () => null,
  })
  const app = renderer.createApp(Root)
  app.mount({ parent: null })
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  return {
    parent,
    children,
    downstream,
    controller,
    recover: () => { offline = false },
    advance: (value: string) => {
      now += DICTIONARY_CATALOG_CACHE_TTL_MS + 1
      response = warehouse(value)
    },
    hold: () => {
      let release!: () => void
      gate = new Promise<void>((resolve) => {
        release = resolve
      })
      return () => {
        gate = null
        release()
      }
    },
    requests: () => requests,
    providerGets: () => providerGets,
    canSubmit: (value: string) => validateDestinationWarehouse(value, parent.selectableItems.value.map(item => item.value)) === null,
    dispose: () => {
      app.unmount()
      controller.dispose()
    },
  }
}

test('下拉首次失败后重试成功，父弹窗立即使用同一有效目录恢复提交', async (context) => {
  const fixture = await mountConsumers()
  context.after(fixture.dispose)
  assert.ok(fixture.parent.error.value)
  assert.ok(fixture.children[0]!.error.value)
  assert.equal(fixture.canSubmit('CN-WH-01'), false)
  fixture.recover()
  await fixture.children[0]!.retry()
  assert.equal(fixture.children[0]!.error.value, null)
  assert.equal(fixture.parent.error.value, null)
  assert.equal(fixture.canSubmit('CN-WH-01'), true)
})

test('多个下拉同时重试共享父读取且不递归，TTL更新同步撤销旧仓库选择', async (context) => {
  const fixture = await mountConsumers()
  context.after(fixture.dispose)
  fixture.recover()
  const getsBefore = fixture.providerGets()
  const requestsBefore = fixture.requests()
  await Promise.all(fixture.children.map(child => child.retry()))
  assert.equal(fixture.providerGets() - getsBefore, 1)
  assert.equal(fixture.requests() - requestsBefore, 1)
  assert.equal(fixture.canSubmit('CN-WH-01'), true)
  fixture.advance('CN-WH-02')
  await fixture.children[0]!.retry()
  assert.equal(fixture.canSubmit('CN-WH-01'), false)
  assert.equal(fixture.canSubmit('CN-WH-02'), true)
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  assert.equal(fixture.children[1]!.catalog.value?.items[0]?.value, 'CN-WH-02')
})

test('代理保留其他字典读取与取消边界，一个下拉取消不影响其余货件', async (context) => {
  const fixture = await mountConsumers()
  context.after(fixture.dispose)
  fixture.recover()
  const other = await fixture.downstream.get({ code: 'other.options', signal: new AbortController().signal })
  assert.equal(other?.code, 'other.options')
  assert.ok(fixture.parent.error.value)
  const release = fixture.hold()
  const first = new AbortController()
  const firstRead = fixture.downstream.get({ code: 'mainland.warehouse', signal: first.signal })
  const secondRead = fixture.downstream.get({ code: 'mainland.warehouse', signal: new AbortController().signal })
  first.abort()
  await assert.rejects(firstRead, { name: 'AbortError' })
  release()
  assert.equal((await secondRead)?.items[0]?.value, 'CN-WH-01')
  assert.equal(fixture.canSubmit('CN-WH-01'), true)
})

test('失效通知中断旧读取后，父子目录都能恢复为最新仓库', async (context) => {
  const fixture = await mountConsumers()
  context.after(fixture.dispose)
  fixture.recover()
  await fixture.children[0]!.retry()
  fixture.advance('CN-WH-02')
  const release = fixture.hold()
  const pending = fixture.children[0]!.retry()
  fixture.controller.invalidate({ code: 'mainland.warehouse', broadcast: false })
  assert.equal(fixture.canSubmit('CN-WH-01'), false)
  release()
  await pending
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  assert.equal(fixture.parent.error.value, null)
  assert.equal(fixture.canSubmit('CN-WH-02'), true)
  assert.equal(fixture.children.every(child => child.catalog.value?.items[0]?.value === 'CN-WH-02' && child.error.value === null), true)
})
