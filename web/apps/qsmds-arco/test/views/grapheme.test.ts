import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 字素簇纯函数使用 Node.js 内置 runner 验证。
import test from 'node:test'

import { countGraphemes } from '../../src/utils/grapheme'

const singleGraphemeCases = [
  ['ZWJ 家庭 Emoji', '👨‍👩‍👧‍👦'],
  ['带肤色 Emoji', '👍🏽'],
  ['地区旗帜 Emoji', '🇨🇳'],
  ['组合附加符号', 'e\u0301'],
] as const

for (const [label, value] of singleGraphemeCases) {
  test(`${label}按一个可见字素簇计数`, () => {
    assert.equal(countGraphemes(value), 1)
  })
}

test('空字符串与中英文混排按可见字素簇计数', () => {
  assert.equal(countGraphemes(''), 0)
  assert.equal(countGraphemes('ASCII中文'), 7)
})
