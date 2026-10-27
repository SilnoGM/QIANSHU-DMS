import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 货件配置器勾选契约使用 Node.js 内置 runner。
import test from 'node:test'

const CONFIGURATOR = '../../src/components/business/QsPartConfigurator/index.vue'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('全选按钮位于创建货物件与已选计数之间，只对接待装产品', () => {
  const source = readRelativeSource(CONFIGURATOR)
  const createAt = source.indexOf('data-action="create-part"')
  const selectAllAt = source.indexOf('data-action="select-all"')
  const countAt = source.indexOf('partConfigurator.selected')

  assert.ok(createAt >= 0, '创建货物件按钮必须保留稳定定位标识')
  assert.ok(selectAllAt > createAt, '全选按钮必须排在创建货物件之后')
  assert.ok(countAt > selectAllAt, '已选辅助文字必须排在全选按钮之后')
  assert.match(source, /v-if="pendingProducts\.length > 0"/u)
  assert.match(source, /:disabled="!editable"/u)
})

test('全选只改勾选状态，不覆盖本次装入数量', () => {
  const source = readRelativeSource(CONFIGURATOR)
  const block = source.match(/function toggleSelectAll\(\): void \{[\s\S]*?\n\}/u)?.[0] ?? ''

  assert.notEqual(block, '', '必须保留独立的勾选切换函数')
  assert.match(block, /selectedKeys\.value =/u)
  assert.match(block, /pendingProducts\.value\.map\(product => product\.key\)/u)
  assert.doesNotMatch(block, /quantities/u, '全选不得改写用户已填或默认的装入数量')
})

test('全选与取消全选文案、口径写入语言包和组件说明', () => {
  const messages = JSON.parse(readRelativeSource('../../src/locales/lang/part-configurator/zh-cn.json')) as {
    partConfigurator: Record<string, string>
  }
  assert.equal(messages.partConfigurator.selectAll, '全选')
  assert.equal(messages.partConfigurator.clearSelection, '取消全选')

  const readme = readRelativeSource('../../src/components/business/QsPartConfigurator/README.md')
  assert.match(readme, /全选/u)
  assert.match(readme, /不改.*数量/u)
})
