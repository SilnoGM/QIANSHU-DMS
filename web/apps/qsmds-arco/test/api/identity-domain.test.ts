import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 身份域源码契约使用 Node.js 内置 runner。
import test from 'node:test'

function readStore(name: string): string {
  return readFileSync(
    new URL(`../../src/store/modules/app/${name}.ts`, import.meta.url),
    'utf8',
  )
}

test('持久偏好按不可变 userId 分区且身份边界清空收藏内存', () => {
  const accountSource = readStore('account')
  const favoritesSource = readStore('favorites')
  const partitionedSources = [
    favoritesSource,
    readStore('preferences'),
    readStore('tabbar'),
  ]

  for (const source of partitionedSources) {
    assert.doesNotMatch(source, /appAccountStore\.account\]/u)
    assert.match(source, /appAccountStore\.userId/u)
  }
  assert.match(favoritesSource, /function clean\(\)/u)
  assert.match(accountSource, /appFavoritesStore\.clean\(\)/u)
})
