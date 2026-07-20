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

test('自动认证重验使用独立单调版本请求路由协调', () => {
  const accountSource = readStore('account')

  assert.match(accountSource, /let routeReconciliationRequestVersion = 0/u)
  assert.match(
    accountSource,
    /const previousAuthState = lifecycleState\.authState/u,
  )
  assert.match(
    accountSource,
    /shouldRequestAuthRouteReconciliation\(\{[\s\S]*?previousState: previousAuthState/u,
  )
  assert.match(
    accountSource,
    /routeReconciliationRequestVersion \+= 1/u,
  )
  assert.match(
    accountSource,
    /routeReconciliationQueue\.request\(routeReconciliationRequestVersion\)/u,
  )
  assert.doesNotMatch(
    accountSource,
    /routeReconciliationQueue\.request\(routeDomainVersion\)/u,
  )
})

test('Profile 保持非持久化，并随身份边界清理且驱动账户头像', () => {
  const accountSource = readStore('account')

  assert.match(accountSource, /profileCoordinator\.clearProfile\(\)/u)
  assert.match(
    accountSource,
    /const avatar = computed\(\(\) => profile\.value\?\.avatarUrl \?\? ''\)/u,
  )
  assert.match(accountSource, /persist: false/u)
  assert.doesNotMatch(accountSource, /persist:\s*\{[\s\S]*?profile/u)
})

test('只有正常 authenticated 状态后台加载 Profile，强制改密等状态同步清理', () => {
  const accountSource = readStore('account')

  assert.match(
    accountSource,
    /watch\(authState, \(state\) => \{[\s\S]*?state === 'authenticated'[\s\S]*?loadProfile\(\)[\s\S]*?else \{[\s\S]*?clearProfile\(\)/u,
  )
  assert.match(accountSource, /\}, \{ flush: 'sync' \}\)/u)
})

test('PROFILE_CHANGED 广播不携带资料，并独立触发 Profile GET', () => {
  const accountSource = readStore('account')

  assert.match(
    accountSource,
    /type AccountBroadcastType[\s\S]*?'PROFILE_CHANGED'/u,
  )
  assert.match(accountSource, /authChannel\?\.postMessage\(\{ type \}\)/u)
  assert.doesNotMatch(
    accountSource,
    /postMessage\(\{\s*type:\s*['"]PROFILE_CHANGED['"]\s*,/u,
  )
  assert.match(
    accountSource,
    /isProfileBroadcastMessage\(event\.data\)[\s\S]*?loadProfile\(\{ force: true \}\)[\s\S]*?else if \(isAuthBroadcastMessage\(event\.data\)\)/u,
  )
  assert.match(
    accountSource,
    /async function refreshProfileAfterMutation\([\s\S]*?loadProfile\(\{ force: true \}\)[\s\S]*?broadcast\('PROFILE_CHANGED'\)/u,
  )
})
