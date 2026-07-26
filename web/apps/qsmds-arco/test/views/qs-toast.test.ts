import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- QsToast 的纯配置与源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  isUsableQsToastId,
  QS_TOAST_DEFAULT_DURATIONS,
  QS_TOAST_ICON_NAMES,
  resolveQsToastClosable,
  resolveQsToastDuration,
  resolveQsToastRole,
} from '../../src/components/base/QsToast/config'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('六种提示状态拥有稳定图标、默认时长和无障碍角色', () => {
  assert.deepEqual(QS_TOAST_ICON_NAMES, {
    default: 'i-lucide:message-circle-more',
    error: 'i-lucide:circle-x',
    info: 'i-lucide:info',
    loading: 'i-lucide:loader-circle',
    success: 'i-lucide:circle-check',
    warning: 'i-lucide:triangle-alert',
  })
  assert.deepEqual(QS_TOAST_DEFAULT_DURATIONS, {
    default: 3200,
    error: 6000,
    info: 4000,
    loading: Number.POSITIVE_INFINITY,
    success: 2800,
    warning: 5000,
  })
  assert.equal(resolveQsToastRole('error'), 'alert')
  for (const type of ['default', 'success', 'info', 'warning', 'loading'] as const) {
    assert.equal(resolveQsToastRole(type), 'status')
  }
})

test('显式时长优先，非法运行时值回退；永久提示和错误默认可关闭', () => {
  assert.equal(resolveQsToastDuration('success'), 2800)
  assert.equal(resolveQsToastDuration('success', 1200), 1200)
  assert.equal(resolveQsToastDuration('loading'), Number.POSITIVE_INFINITY)
  assert.equal(resolveQsToastDuration('success', Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY)
  assert.equal(resolveQsToastDuration('success', 0), 2800)
  assert.equal(resolveQsToastDuration('warning', Number.NaN), 5000)
  assert.equal(resolveQsToastDuration('warning', -1), 5000)

  assert.equal(resolveQsToastClosable('success', 2800), false)
  assert.equal(resolveQsToastClosable('error', 6000), true)
  assert.equal(resolveQsToastClosable('loading', Number.POSITIVE_INFINITY), true)
  assert.equal(resolveQsToastClosable('loading', Number.POSITIVE_INFINITY, false), true)
  assert.equal(resolveQsToastClosable('success', Number.POSITIVE_INFINITY, false), true)
  assert.equal(resolveQsToastClosable('error', 6000, false), false)
  assert.equal(resolveQsToastClosable('success', 2800, true), true)
})

test('提示 id 只接受有限正数或非空字符串，危险值不会传给 dismiss', () => {
  for (const id of [1, 42, 'toast-1', '  toast-2  ']) {
    assert.equal(isUsableQsToastId(id), true)
  }
  for (const id of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '', '   ']) {
    assert.equal(isUsableQsToastId(id), false)
  }
})

test('QsToast 使用状态岛、中性浮层、专业图标和明确无障碍语义', () => {
  const source = readRelativeSource(
    '../../src/components/base/QsToast/index.vue',
  )

  assert.match(source, /defineOptions\(\{ name: 'QsToast' \}\)/u)
  assert.match(source, /:role="toastRole"/u)
  assert.match(source, /data-qs-toast/u)
  assert.match(source, /:data-type="type"/u)
  assert.match(source, /<FaIcon\s+:name="iconName"/u)
  assert.match(source, /aria-label="关闭提示"/u)
  assert.match(source, /emit\('closeToast'\)/u)
  assert.match(source, /prefers-reduced-motion:\s*reduce/u)
  assert.match(source, /backdrop-filter:\s*blur/u)
  assert.match(source, /color-mix\(in oklch/u)
  assert.match(source, /max-width:\s*calc\(100vw - 32px\)/u)
  assert.doesNotMatch(
    source,
    /@\/api|useApp\w*Store|linear-gradient|radial-gradient|purple|violet|indigo|fuchsia|system-ui|-apple-system|Inter|Roboto|Arial/u,
  )
})

test('useQsToast 只暴露受控项目 API，并通过 FaToast custom 保留底层队列能力', () => {
  const source = readRelativeSource(
    '../../src/components/base/QsToast/useQsToast.ts',
  )
  const typesSource = readRelativeSource(
    '../../src/components/base/QsToast/types.ts',
  )

  assert.match(source, /import \{ useFaToast \} from '@fantastic-admin\/components'/u)
  assert.match(source, /markRaw\(QsToast\)/u)
  assert.match(source, /import QsToast from '\.\/index\.vue'/u)
  assert.match(source, /\.custom\(QS_TOAST_COMPONENT,/u)
  assert.match(source, /componentProps:/u)
  assert.match(source, /function useQsToast\(\): QsToastApi/u)
  assert.match(source, /show:/u)
  assert.match(source, /success:/u)
  assert.match(source, /info:/u)
  assert.match(source, /warning:/u)
  assert.match(source, /error:/u)
  assert.match(source, /loading:/u)
  assert.match(source, /promise:/u)
  assert.match(source, /dismiss:/u)
  assert.match(
    source,
    /useFaToast\(\)\.dismiss\(id\)[\s\S]*?showQsToast\('success'/u,
  )
  assert.match(
    source,
    /useFaToast\(\)\.dismiss\(id\)[\s\S]*?showQsToast\('error'/u,
  )
  assert.match(source, /throw error/u)

  assert.match(typesSource, /export type QsToastType\s*=/u)
  assert.match(typesSource, /export interface QsToastAction/u)
  assert.match(typesSource, /export interface QsToastOptions/u)
  assert.match(typesSource, /export interface QsToastPromiseOptions/u)
  assert.match(typesSource, /export interface QsToastApi/u)
  assert.doesNotMatch(typesSource, /\bclass\??:|\bstyle\??:|\bcomponent\??:|\bicon\??:/u)
  const optionsContract = typesSource.match(
    /export interface QsToastOptions \{([\s\S]*?)\n\}/u,
  )?.[1]
  const promiseOptionsContract = typesSource.match(
    /export interface QsToastPromiseOptions<T> \{([\s\S]*?)\n\}/u,
  )?.[1]
  assert.ok(optionsContract)
  assert.ok(promiseOptionsContract)
  assert.doesNotMatch(optionsContract, /\bid\??:/u)
  assert.doesNotMatch(promiseOptionsContract, /\bid\??:/u)
})

test('轻提示独立页面覆盖完整状态和交互，不读取真实业务依赖', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/basic/toast.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/basic/components/QsToastShowcase.vue',
  )
  const readmeSource = readRelativeSource(
    '../../src/components/base/QsToast/README.md',
  )

  assert.match(pageSource, /defineOptions\(\{ name: 'ComponentLibraryQsToast' \}\)/u)
  assert.match(pageSource, /import QsToastShowcase from '\.\/components\/QsToastShowcase\.vue'/u)
  assert.match(pageSource, /title="轻提示"/u)
  assert.match(pageSource, /route-path="\/component-library\/basic\/toast"/u)
  assert.match(pageSource, /stage-label="轻提示组件已展示"/u)
  assert.match(pageSource, /<QsToastShowcase\s*\/>/u)

  assert.match(showcaseSource, /useQsToast/u)
  for (const method of ['show', 'success', 'info', 'warning', 'error', 'loading', 'promise']) {
    assert.match(showcaseSource, new RegExp(`toast\\.${method}`, 'u'))
  }
  assert.match(showcaseSource, /action:/u)
  assert.match(showcaseSource, /description:/u)
  assert.match(showcaseSource, /toast\.dismiss\(/u)
  assert.match(showcaseSource, /const promiseTimers = new Set/u)
  assert.match(showcaseSource, /promiseTimers\.forEach\(timer => clearTimeout\(timer\)\)/u)
  assert.match(showcaseSource, /:aria-label="`触发\$\{state\.label\}提示`"/u)
  assert.doesNotMatch(showcaseSource, /@\/api|useApp\w*Store/u)

  assert.match(readmeSource, /useQsToast/u)
  assert.match(readmeSource, /FaToast/u)
  assert.match(readmeSource, /Promise/u)
  assert.match(readmeSource, /prefers-reduced-motion/u)
})
