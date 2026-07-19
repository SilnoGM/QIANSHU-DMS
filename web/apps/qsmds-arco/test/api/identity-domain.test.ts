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

test('广播与公开认证重验统一协调路由，后台异常只记录脱敏固定文本', () => {
  const accountSource = readStore('account')

  assert.match(
    accountSource,
    /backgroundAuthSynchronizationQueue\.request\(false\)/u,
  )
  assert.match(
    accountSource,
    /backgroundAuthSynchronizationQueue\.request\(true\)/u,
  )
  assert.match(
    accountSource,
    /async function revalidateAuth\([\s\S]*?await revalidateAndReconcile\(true\)/u,
  )
  assert.doesNotMatch(accountSource, /\.catch\(\(\) => undefined\)/u)
  assert.doesNotMatch(
    accountSource,
    /console\.error\([^\n]*,\s*error\s*\)/u,
  )
})
