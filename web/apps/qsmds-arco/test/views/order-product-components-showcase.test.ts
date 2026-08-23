import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- Showcase 隔离契约使用 Node.js 内置 runner。
import test from 'node:test'

const ROOT = new URL('../../src/views/component_library/business/', import.meta.url)

test('两个订单产品组件 Showcase 只使用内存 fixture，不访问真实业务 API', async () => {
  const [selector, editor, fixture] = await Promise.all([
    readFile(new URL('components/ProductSelectorShowcase.vue', ROOT), 'utf8'),
    readFile(new URL('components/OrderProductLineEditorShowcase.vue', ROOT), 'utf8'),
    readFile(new URL('fixtures/order-product.fixture.ts', ROOT), 'utf8'),
  ])

  assert.match(selector, /<QsProductSelector/u)
  assert.match(selector, /failNextRequest/u)
  assert.match(selector, /模拟下一次查询失败/u)
  assert.match(editor, /<QsOrderProductLineEditor/u)
  assert.match(editor, /switchCurrency\('MYR'\)/u)
  assert.match(editor, /lines\.value = \[\]/u)
  assert.match(fixture, /createOrderProductFixtureProvider/u)
  assert.match(fixture, /createOrderProductFixtureLoader/u)
  assert.match(fixture, /code: 'MYR'/u)
  assert.doesNotMatch(`${selector}${editor}${fixture}`, /@\/api\//u)
  assert.doesNotMatch(`${selector}${editor}${fixture}`, /useAppAuth|defineStore|useRoute/u)
})

test('订单产品明细编辑器 Showcase 提供 FaForm 运行时上下文', async () => {
  const editor = await readFile(
    new URL('components/OrderProductLineEditorShowcase.vue', ROOT),
    'utf8',
  )

  const formStart = editor.indexOf('<FaForm')
  const editorStart = editor.indexOf('<QsOrderProductLineEditor')
  const formEnd = editor.indexOf('</FaForm>', editorStart)

  assert.ok(formStart >= 0, 'Showcase 必须为内部 FaFormItem 提供 FaForm 上下文')
  assert.ok(editorStart > formStart, '明细编辑器必须渲染在 FaForm 内部')
  assert.ok(formEnd > editorStart, 'FaForm 必须完整包裹明细编辑器')
})
