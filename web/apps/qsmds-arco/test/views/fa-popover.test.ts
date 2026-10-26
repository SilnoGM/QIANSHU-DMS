import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 基础组件公共契约使用 Node.js 内置 runner。
import test from 'node:test'

const SOURCE = new URL(
  '../../../../packages/components/src/basic/popover/index.vue',
  import.meta.url,
)

test('FaPopover 默认阻止自动聚焦，只有 autoFocus=true 才允许进入内容', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /autoFocus\?: boolean/u)
  assert.match(source, /autoFocus: false/u)
  assert.match(source, /if \(!props\.autoFocus\)\s*\{\s*e\.preventDefault\(\)/u)
  assert.match(source, /@open-auto-focus="handleOpenAutoFocus"/u)
  assert.match(source, /sticky\?: PopoverContentProps\['sticky'\]/u)
  assert.match(source, /prioritizePosition\?: PopoverContentProps\['prioritizePosition'\]/u)
  assert.match(source, /:sticky/u)
  assert.match(source, /:prioritize-position/u)
})
