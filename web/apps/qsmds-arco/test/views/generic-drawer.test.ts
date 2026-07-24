import type { QsGenericDrawerCloseReason } from '../../src/components/business/QsGenericDrawer/logic'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 通用抽屉纯逻辑与源码契约使用 Node.js 内置 runner。
import test from 'node:test'
import {
  canCloseGenericDrawer,
  createGenericDrawerContentClass,
  QS_GENERIC_DRAWER_DEFAULT_SIZE,
  resolveFaDrawerCloseReason,
} from '../../src/components/business/QsGenericDrawer/logic'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('通用抽屉默认使用 md，并为四档右侧宽度保留移动端全宽回退', () => {
  assert.equal(QS_GENERIC_DRAWER_DEFAULT_SIZE, 'md')

  const expectedWidths = {
    lg: 'md:w-[40rem]',
    md: 'md:w-[30rem]',
    sm: 'md:w-96',
    xl: 'md:w-[48rem]',
  } as const

  Object.entries(expectedWidths).forEach(([size, widthClass]) => {
    const contentClass = createGenericDrawerContentClass(
      size as keyof typeof expectedWidths,
      'right',
    )

    assert.match(contentClass, /w-screen/u)
    assert.match(contentClass, /qs-generic-drawer-panel/u)
    assert.match(contentClass, /outline-none/u)
    assert.match(contentClass, new RegExp(widthClass.replaceAll('[', '\\[').replaceAll(']', '\\]'), 'u'))
    assert.match(contentClass, /md:max-w-\[calc\(100vw-3rem\)\]/u)
  })
})

test('底部抽屉限制动态视口高度并保留安全区和圆角契约', () => {
  const contentClass = createGenericDrawerContentClass('md', 'bottom')

  assert.match(contentClass, /max-h-\[calc\(100dvh-1rem\)\]/u)
  assert.match(contentClass, /rounded-t-xl/u)
  assert.doesNotMatch(contentClass, /md:w-\[30rem\]/u)
})

test('关闭守卫支持同步和异步结果，异常时保持抽屉打开', async () => {
  const calls: QsGenericDrawerCloseReason[] = []

  assert.equal(await canCloseGenericDrawer(undefined, 'overlay'), true)
  assert.equal(await canCloseGenericDrawer((reason) => {
    calls.push(reason)
    return true
  }, 'close-button'), true)
  assert.equal(await canCloseGenericDrawer(async (reason) => {
    calls.push(reason)
    return false
  }, 'escape'), false)
  assert.equal(await canCloseGenericDrawer(async () => {
    throw new Error('guard failed')
  }, 'programmatic'), false)
  assert.deepEqual(calls, ['close-button', 'escape'])
})

test('FaDrawer 原生关闭通过捕获到的 Escape 时刻区分键盘和遮罩', () => {
  assert.equal(resolveFaDrawerCloseReason(null, 1_000), 'overlay')
  assert.equal(resolveFaDrawerCloseReason(900, 1_000), 'escape')
  assert.equal(resolveFaDrawerCloseReason(700, 1_000), 'overlay')
})

test('QsGenericDrawer 以 FaDrawer 为内核并提供第一版声明式状态与插槽', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericDrawer/index.vue',
  )
  const errorSlotStart = source.indexOf('data-slot="qs-generic-drawer-error"')
  const errorOpeningTag = source.slice(
    source.lastIndexOf('<div', errorSlotStart),
    source.indexOf('>', errorSlotStart) + 1,
  )

  assert.match(source, /defineOptions\(\{ name: 'QsGenericDrawer' \}\)/u)
  assert.match(source, /<FaDrawer/u)
  assert.match(source, /:closable="false"/u)
  assert.match(source, /:loading="false"/u)
  assert.match(source, /:close-on-click-overlay="dismissOnOverlay && !submitting"/u)
  assert.match(source, /:close-on-press-escape="dismissOnEscape && !submitting"/u)
  assert.match(source, /name="header-leading"/u)
  assert.match(source, /name="header-extra"/u)
  assert.match(source, /name="loading"/u)
  assert.match(source, /name="error-actions"/u)
  assert.match(source, /name="footer"/u)
  assert.match(source, /<FaAlert/u)
  assert.match(source, /animate-pulse/u)
  assert.match(source, /aria-busy/u)
  assert.match(source, /env\(safe-area-inset-bottom\)/u)
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/u)
  assert.match(source, /animation-duration: 0\.01ms !important/u)
  assert.match(source, /<h2 data-slot="sheet-title"[^>]*aria-hidden="true">/u)
  assert.doesNotMatch(errorOpeningTag, /role="alert"/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store/u)
  assert.doesNotMatch(source, />\s*(编辑|删除)\s*</u)
})

test('FaDrawer 自定义头部仍把传入标题和描述写入可访问名称', () => {
  const source = readRelativeSource(
    '../../../../packages/components/src/basic/drawer/index.vue',
  )
  const hiddenHeader = source.slice(
    source.indexOf('<VisuallyHidden v-if="!!slots.header">'),
    source.indexOf('</VisuallyHidden>', source.indexOf('<VisuallyHidden v-if="!!slots.header">')),
  )
  const hiddenTitle = hiddenHeader.slice(
    hiddenHeader.indexOf('<SheetTitle>'),
    hiddenHeader.indexOf('</SheetTitle>'),
  )
  const hiddenDescription = hiddenHeader.slice(
    hiddenHeader.indexOf('<SheetDescription>'),
    hiddenHeader.indexOf('</SheetDescription>'),
  )

  assert.match(hiddenTitle, /props\.title/u)
  assert.match(hiddenDescription, /props\.description/u)
})
