import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- FaModal 纯逻辑与源码契约使用 Node.js 内置 runner。
import test from 'node:test'
import {
  runModalBeforeClose,
} from '../../../../packages/components/src/basic/modal/logic'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('FaModal 关闭守卫支持同步、异步与异常路径，并保证 done 至多生效一次', async () => {
  const calls: string[] = []

  await runModalBeforeClose(undefined, 'close', () => calls.push('without-guard'))
  await runModalBeforeClose((_action, done) => {
    done()
    done()
  }, 'confirm', () => calls.push('sync'))
  await runModalBeforeClose(async (_action, done) => {
    await Promise.resolve()
    done()
  }, 'cancel', () => calls.push('async'))
  await runModalBeforeClose(async () => {
    throw new Error('guard failed')
  }, 'close', () => calls.push('unexpected'))

  assert.deepEqual(calls, ['without-guard', 'sync', 'async'])
})

test('FaModal 使用真正的 Reka 模态语义并只渲染一层原生遮罩', () => {
  const modalSource = readRelativeSource(
    '../../../../packages/components/src/basic/modal/index.vue',
  )
  const contentSource = readRelativeSource(
    '../../../../packages/components/src/basic/modal/dialog/DialogContent.vue',
  )

  assert.match(modalSource, /<Dialog :modal="true"/u)
  assert.match(modalSource, /:unmount-on-hide="props\.destroyOnClose"/u)
  assert.doesNotMatch(modalSource, /forceMount|force-mount|hasOpened/u)
  assert.equal(contentSource.match(/<DialogOverlay\b/gu)?.length, 1)
  assert.doesNotMatch(contentSource, /useScrollLock|showOverlay/u)
  assert.match(contentSource, /:data-modal-id="props\.modalId"/u)
  assert.match(contentSource, /aria-modal="true"/u)
})

test('FaModal 自定义或隐藏 Header 时仍保留传入的可访问名称', () => {
  const source = readRelativeSource(
    '../../../../packages/components/src/basic/modal/index.vue',
  )
  const customHeaderStart = source.indexOf('<VisuallyHidden v-if="!!slots.header">')
  const customHeader = source.slice(
    customHeaderStart,
    source.indexOf('</VisuallyHidden>', customHeaderStart),
  )
  const hiddenHeaderStart = source.indexOf('<VisuallyHidden v-else>')
  const hiddenHeader = source.slice(
    hiddenHeaderStart,
    source.indexOf('</VisuallyHidden>', hiddenHeaderStart),
  )

  assert.ok(customHeaderStart >= 0)
  assert.match(customHeader, /props\.title/u)
  assert.match(customHeader, /props\.description/u)
  assert.ok(hiddenHeaderStart >= 0)
  assert.match(hiddenHeader, /props\.title/u)
  assert.match(hiddenHeader, /props\.description/u)
})

test('FaModal 只由 isOpen 监听器发出一次开关生命周期事件', () => {
  const source = readRelativeSource(
    '../../../../packages/components/src/basic/modal/index.vue',
  )
  const updateOpenSource = source.slice(
    source.indexOf('async function updateOpen'),
    source.indexOf('const isConfirmButtonLoading'),
  )

  assert.equal(source.match(/emits\('open'\)/gu)?.length, 1)
  assert.equal(source.match(/emits\('close'\)/gu)?.length, 1)
  assert.doesNotMatch(updateOpenSource, /emits\('(open|close)'\)/u)
  assert.doesNotMatch(source, /@close-auto-focus=/u)
})

test('FaModal 所有用户关闭入口共享异步 pending 锁', () => {
  const source = readRelativeSource(
    '../../../../packages/components/src/basic/modal/index.vue',
  )
  const requestCloseSource = source.slice(
    source.indexOf('async function requestClose'),
    source.indexOf('async function updateOpen'),
  )

  assert.match(source, /const closePending = ref\(false\)/u)
  assert.match(requestCloseSource, /if \(closePending\.value\)/u)
  assert.match(requestCloseSource, /finally\s*\{[\s\S]*?closePending\.value = false/u)
  assert.equal(source.match(/runModalBeforeClose\(/gu)?.length, 1)
  assert.match(source, /requestClose\('close'/u)
  assert.match(source, /requestClose\('confirm'/u)
  assert.match(source, /requestClose\('cancel'/u)
})

test('FaModal 确定关闭路径在守卫异常后恢复内部 loading', () => {
  const source = readRelativeSource(
    '../../../../packages/components/src/basic/modal/index.vue',
  )
  const confirmSource = source.slice(
    source.indexOf('async function onConfirm'),
    source.indexOf('async function onCancel'),
  )

  assert.match(confirmSource, /try\s*\{/u)
  assert.match(confirmSource, /finally\s*\{/u)
  assert.match(confirmSource, /isConfirmButtonLoading\.value = false/u)
})

test('菜单搜索通过 QsGenericModal 提供可访问标题并恢复搜索框首焦点', () => {
  const source = readRelativeSource(
    '../../src/layouts/components/Topbar/Toolbar/MenuSearch/search.vue',
  )

  assert.match(
    source,
    /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u,
  )
  assert.match(source, /<QsGenericModal[\s\S]+?:title=/u)
  assert.match(source, /<QsGenericModal[\s\S]+?class="menu-search-modal"/u)
  assert.match(source, /ref="searchInputRef"/u)
  assert.match(source, /searchInputRef\.value\?\.focus\(\)/u)
  assert.match(
    source,
    /\[data-slot="dialog-footer"\]:has\(> \[data-slot="qs-generic-modal-footer"\]:empty\)/u,
  )
  assert.match(source, /display:\s*none/u)
  assert.doesNotMatch(source, /<FaModal\b/u)
})
