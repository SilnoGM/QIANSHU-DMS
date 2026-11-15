import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 部署后资源失效的识别与全局刷新提示使用 Node.js 内置 runner 校验。
import test from 'node:test'
import { isChunkLoadError } from '../../src/utils/chunk-load-error'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('只把动态 import 失效识别为需要刷新的 chunk 错误', () => {
  assert.equal(isChunkLoadError({ name: 'ChunkLoadError', message: 'anything' }), true)
  assert.equal(isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://dms.example/assets/page-abc.js')), true)
  assert.equal(isChunkLoadError(new Error('Importing a module script failed.')), true)
  assert.equal(isChunkLoadError(new Error('error loading dynamically imported module')), true)
  assert.equal(isChunkLoadError(new Error('Loading chunk 42 failed')), true)
  // 普通网络/业务错误不能触发刷新提示。
  assert.equal(isChunkLoadError(new Error('Network Error')), false)
  assert.equal(isChunkLoadError('Failed to fetch dynamically imported module'), false)
  assert.equal(isChunkLoadError(null), false)
})

test('路由 chunk 失败统一交给全局刷新提示', () => {
  const routerSource = readRelativeSource('../../src/router/index.ts')
  const componentSource = readRelativeSource('../../src/components/AppAssetReload/index.vue')
  const appSource = readRelativeSource('../../src/App.vue')

  assert.match(routerSource, /router\.onError\(/u)
  assert.match(routerSource, /isChunkLoadError\(error\)/u)
  assert.match(routerSource, /eventBus\.emit\('global-asset-reload-required'\)/u)

  assert.match(appSource, /<AppAssetReload \/>/u)
  assert.match(componentSource, /global-asset-reload-required/u)
  assert.match(componentSource, /<QsGenericModal/u)
  assert.match(componentSource, /window\.location\.reload\(\)/u)
})

test('资源刷新提示文案在三种语言下齐全', () => {
  for (const locale of ['zh-cn', 'zh-tw', 'en']) {
    const localeSource = readRelativeSource(
      `../../../../packages/locales/lang/app/components/asset-reload/${locale}.json`,
    )
    const messages = JSON.parse(localeSource) as {
      app: { components: { assetReload: Record<string, string> } }
    }
    for (const key of ['title', 'description', 'later', 'refreshNow']) {
      assert.equal(typeof messages.app.components.assetReload[key], 'string', `${locale} 缺少 ${key}`)
    }
  }
})
