import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  createSnapdomFontIsolationPlugin,
  sanitizeSnapdomFontSource,
} from './sanitize-snapdom.ts'

const snapdomSource = readFileSync(
  new URL('../node_modules/@zumer/snapdom/dist/snapdom.mjs', import.meta.url),
  'utf8',
)
const stylesheetHost = ['fonts', 'googleapis', 'com'].join('.')
const binaryHost = ['fonts', 'gstatic', 'com'].join('.')

test('SnapDOM 清洗移除远程字体默认值并保留本地 icon font 覆盖能力', () => {
  const sanitizedSource = sanitizeSnapdomFontSource(snapdomSource)

  assert.doesNotMatch(sanitizedSource, new RegExp(`${stylesheetHost}|${binaryHost}`, 'u'))
  assert.match(sanitizedSource, /window\.__SNAPDOM_ICON_FONTS__/u)
  assert.match(sanitizedSource, /export\{Hi as preCache,N as snapdom\};/u)
})

test('SnapDOM 上游结构漂移时清洗必须失败而非静默放行', () => {
  assert.throws(
    () => sanitizeSnapdomFontSource('export const snapdom = {}'),
    /SnapDOM remote font contract changed/u,
  )
})

test('SnapDOM 转换后的 sourcemap 只保存清洗后源码', async () => {
  const plugin = createSnapdomFontIsolationPlugin()
  const transform = plugin.transform

  if (typeof transform !== 'function') {
    throw new TypeError('SnapDOM isolation plugin must expose a function transform hook')
  }
  const result = await transform.call(
    {} as never,
    snapdomSource,
    '/workspace/node_modules/@zumer/snapdom/dist/snapdom.mjs',
  )
  const transformed = result as {
    code: string
    map: { sourcesContent: string[] }
  }

  assert.deepEqual(transformed.map.sourcesContent, [transformed.code])
  assert.doesNotMatch(transformed.map.sourcesContent[0], new RegExp(`${stylesheetHost}|${binaryHost}`, 'u'))
})
