/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function readWebFile(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('FaTable 将已公开的 footer 动态插槽接入真实表尾', () => {
  const source = readWebFile('../packages/components/src/basic/table/index.vue')

  assert.match(source, /TableFooter,/u)
  assert.match(source, /function getFooterSlotName/u)
  assert.match(source, /table\.getFooterGroups\(\)/u)
  assert.match(source, /<TableFooter v-if="hasFooter">/u)
  assert.match(source, /getFooterSlotName\(footer\)/u)
  assert.match(source, /footer\.column\.columnDef\.footer/u)
  assert.match(source, /:data-pinned="footer\.column\.getIsPinned\(\) \|\| undefined"/u)
})

test('FaTable 手册记录 footer 插槽已经具备运行时能力', () => {
  const handbook = readWebFile(
    '../../docs/前端文档/前端开发手册/Fantastic-admin内置组件/基础版组件.md',
  )

  assert.match(handbook, /运行时已接入 `footer-\{columnId\}`/u)
  assert.doesNotMatch(handbook, /当前运行时未接入 `footer-\{columnId\}`/u)
})
