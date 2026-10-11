import type { QsGenericModalCloseReason } from '../../src/components/business/QsGenericModal/logic'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 通用模态框纯逻辑与源码契约使用 Node.js 内置 runner。
import test from 'node:test'
import {
  canCloseGenericModal,
  createGenericModalContentClass,
  QS_GENERIC_MODAL_DEFAULT_SIZE,
  resolveFaModalCloseReason,
} from '../../src/components/business/QsGenericModal/logic'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('通用模态框默认使用 md，并提供六档响应式宽度与动态视口边界', () => {
  assert.equal(QS_GENERIC_MODAL_DEFAULT_SIZE, 'md')

  const expectedWidths = {
    '2xl': 'sm:max-w-[68rem]',
    '3xl': 'sm:max-w-[80rem]',
    'lg': 'sm:max-w-[45rem]',
    'md': 'sm:max-w-[35rem]',
    'sm': 'sm:max-w-[30rem]',
    'xl': 'sm:max-w-[56rem]',
  } as const

  Object.entries(expectedWidths).forEach(([size, widthClass]) => {
    const contentClass = createGenericModalContentClass(
      size as keyof typeof expectedWidths,
    )

    assert.match(contentClass, /qs-generic-modal-panel/u)
    assert.match(contentClass, /\bw-full\b/u)
    assert.match(contentClass, /max-w-\[calc\(100%-1\.5rem\)\]/u)
    assert.doesNotMatch(contentClass, /100vw/u)
    assert.match(contentClass, /max-h-\[calc\(100dvh-1\.5rem\)\]/u)
    assert.match(contentClass, /rounded-xl/u)
    assert.match(contentClass, /outline-none/u)
    assert.match(
      contentClass,
      new RegExp(widthClass.replaceAll('[', '\\[').replaceAll(']', '\\]'), 'u'),
    )
  })
})

test('通用模态框关闭守卫支持同步和异步结果，异常时保持打开', async () => {
  const calls: QsGenericModalCloseReason[] = []

  assert.equal(await canCloseGenericModal(undefined, 'overlay'), true)
  assert.equal(await canCloseGenericModal((reason) => {
    calls.push(reason)
    return true
  }, 'close-button'), true)
  assert.equal(await canCloseGenericModal(async (reason) => {
    calls.push(reason)
    return false
  }, 'escape'), false)
  assert.equal(await canCloseGenericModal(async () => {
    throw new Error('guard failed')
  }, 'programmatic'), false)
  assert.deepEqual(calls, ['close-button', 'escape'])
})

test('FaModal 原生关闭通过捕获到的 Escape 时刻区分键盘和遮罩', () => {
  assert.equal(resolveFaModalCloseReason(null, 1_000), 'overlay')
  assert.equal(resolveFaModalCloseReason(900, 1_000), 'escape')
  assert.equal(resolveFaModalCloseReason(700, 1_000), 'overlay')
})

test('QsGenericModal 以 FaModal 为内核并提供声明式状态与调用方 Footer', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericModal/index.vue',
  )
  const errorSlotStart = source.indexOf('data-slot="qs-generic-modal-error"')
  const errorOpeningTag = source.slice(
    source.lastIndexOf('<div', errorSlotStart),
    source.indexOf('>', errorSlotStart) + 1,
  )

  assert.match(source, /defineOptions\(\{ name: 'QsGenericModal' \}\)/u)
  assert.match(source, /<FaModal/u)
  assert.match(source, /:title="title"/u)
  assert.match(source, /:description="description"/u)
  assert.match(source, /:closable="false"/u)
  assert.match(source, /:loading="false"/u)
  assert.match(source, /:show-confirm-button="false"/u)
  assert.match(source, /:border="false"/u)
  assert.match(source, /align-center/u)
  assert.match(source, /open-auto-focus/u)
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
  assert.match(source, /<h2 data-slot="dialog-title"[^>]*aria-hidden="true">/u)
  assert.doesNotMatch(errorOpeningTag, /role="alert"/u)
  assert.doesNotMatch(source, /previousActiveElement|\.focus\(/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store/u)
  assert.doesNotMatch(source, />\s*(编辑|删除)\s*</u)
})

test('QsGenericModal 统一守卫按钮、原生与程序化关闭且提交中拒绝关闭', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericModal/index.vue',
  )

  assert.match(source, /async function runCloseGuard/u)
  assert.match(source, /props\.submitting \|\| closePending\.value/u)
  assert.match(source, /runCloseGuard\('close-button'\)/u)
  assert.match(source, /resolveFaModalCloseReason/u)
  assert.match(source, /runCloseGuard\('programmatic'\)/u)
  assert.match(source, /emit\('update:modelValue', true\)/u)
  assert.match(source, /:disabled="submitting \|\| closePending"/u)
  assert.match(source, /:inert="submitting \|\| undefined"/u)
  assert.match(source, /flex-col gap-2/u)
  assert.doesNotMatch(source, /flex-col-reverse/u)
})
