import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 共享组件私有字素簇工具使用 Node.js 内置 runner 验证。
import test from 'node:test'

import {
  countGraphemes,
  splitGraphemes,
  takeGraphemes,
} from '../packages/components/src/utils'

function readComponentSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const singleGraphemeCases = [
  ['ZWJ 家庭 Emoji', '👨‍👩‍👧‍👦'],
  ['带肤色 Emoji', '👍🏽'],
  ['地区旗帜 Emoji', '🇨🇳'],
  ['组合附加符号', 'e\u0301'],
] as const

for (const [label, value] of singleGraphemeCases) {
  test(`${label}不会被共享组件拆分`, () => {
    assert.deepEqual(splitGraphemes(value), [value])
    assert.equal(countGraphemes(value), 1)
    assert.equal(takeGraphemes(value, 1), value)
  })
}

test('共享组件按完整字素簇截取可见文本', () => {
  const value = 'A👨‍👩‍👧‍👦👍🏽🇨🇳e\u0301中'

  assert.deepEqual(splitGraphemes(value), [
    'A',
    '👨‍👩‍👧‍👦',
    '👍🏽',
    '🇨🇳',
    'e\u0301',
    '中',
  ])
  assert.equal(takeGraphemes(value, 0), '')
  assert.equal(takeGraphemes(value, 2), 'A👨‍👩‍👧‍👦')
})

test('正式应用真实使用的共享组件消费私有字素簇工具', () => {
  const avatarSource = readComponentSource(
    '../packages/components/src/basic/avatar/index.vue',
  )
  const flipWordsSource = readComponentSource(
    '../packages/components/src/pro/flip-words/index.vue',
  )
  const passwordStrengthSource = readComponentSource(
    '../packages/components/src/basic/password-strength/index.vue',
  )
  const customPasswordRuleSource = readComponentSource(
    '../packages/components/src/basic/password-strength/_examples/_custom-rule.vue',
  )

  assert.match(avatarSource, /takeGraphemes\(fallback\s*\?\?\s*'',\s*2\)/u)
  assert.doesNotMatch(avatarSource, /\.slice\(0,\s*2\)/u)
  assert.match(flipWordsSource, /splitGraphemes\(word\)/u)
  assert.doesNotMatch(flipWordsSource, /word\.split\(''\)/u)
  assert.match(passwordStrengthSource, /countGraphemes\(value\)\s*>=\s*8/u)
  assert.doesNotMatch(passwordStrengthSource, /value\.length\s*>=\s*8/u)
  assert.match(customPasswordRuleSource, /countGraphemes\(value\)\s*>=\s*10/u)
  assert.doesNotMatch(customPasswordRuleSource, /value\.length\s*>=\s*10/u)
})

test('共享字素簇工具保持为组件包私有实现', () => {
  const publicIndex = readComponentSource('../packages/components/src/index.ts')
  const packageJson = JSON.parse(
    readComponentSource('../packages/components/package.json'),
  ) as { exports: Record<string, string> }

  assert.doesNotMatch(publicIndex, /(?:count|split|take)Graphemes/u)
  assert.equal(Object.hasOwn(packageJson.exports, './utils'), false)
})
