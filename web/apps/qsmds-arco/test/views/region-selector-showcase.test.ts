import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 展示页与 fixture 契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  createRegionSelectorFixtureProvider,
  REGION_SELECTOR_FIXTURE_IDS,
} from '../../src/views/component_library/business/fixtures/region-selector.fixture'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('地区选择器拥有第十个独立展示页且不聚合其他业务组件', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/business/region-selector.vue',
  )
  const tablePageSource = readRelativeSource(
    '../../src/views/component_library/business/index.vue',
  )

  assert.match(pageSource, /defineOptions\(\{ name: 'ComponentLibraryQsRegionSelector' \}\)/u)
  assert.match(pageSource, /import RegionSelectorShowcase from '.\/components\/RegionSelectorShowcase\.vue'/u)
  assert.match(pageSource, /title="地区选择器"/u)
  assert.match(pageSource, /route-path="\/component-library\/business\/region-selector"/u)
  assert.match(pageSource, /<RegionSelectorShowcase\s*\/>/u)
  assert.doesNotMatch(pageSource, /Generic(Table|Drawer|Modal)Showcase|GoodTooltipShowcase/u)
  assert.doesNotMatch(tablePageSource, /RegionSelectorShowcase/u)
})

test('Showcase 显式使用本地 provider 并醒目标注数据边界', () => {
  const source = readRelativeSource(
    '../../src/views/component_library/business/components/RegionSelectorShowcase.vue',
  )

  assert.match(source, /import QsRegionSelector from '@\/components\/business\/QsRegionSelector\/index\.vue'/u)
  assert.match(source, /createRegionSelectorFixtureProvider/u)
  assert.match(source, /:provider="fixtureProvider"/u)
  assert.match(source, /:provider="retryProvider"/u)
  assert.match(source, /交互样例，不是正式地区数据/u)
  assert.match(source, /中国台湾\s*\/\s*台湾\s*\/\s*高雄市/u)
  assert.match(source, /已停用历史路径/u)
  assert.match(source, /\breadonly\b/u)
  assert.match(source, /\bdisabled\b/u)
  assert.match(source, /一次失败后可重试/u)
  assert.match(source, /390px|窄屏/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store|regionSelectorProviderKey|createDefaultRegionSelectorProvider/u)
})

test('fixture provider 固定台湾高雄与停用历史路径并支持一次失败后重试', async () => {
  const provider = createRegionSelectorFixtureProvider()
  const signal = new AbortController().signal
  const taiwanPath = await provider.resolvePath({
    cityId: REGION_SELECTOR_FIXTURE_IDS.taiwanKaohsiung,
    signal,
  })
  const stoppedPath = await provider.resolvePath({
    cityId: REGION_SELECTOR_FIXTURE_IDS.stoppedCity,
    signal,
  })

  assert.deepEqual(
    taiwanPath.map(node => node.name),
    ['中国台湾', '台湾', '高雄市'],
  )
  assert.equal(taiwanPath[2].code, 'TW-64000')
  assert.equal(stoppedPath[2].effectiveEnabled, false)
  assert.equal(stoppedPath[2].enabled, false)

  const retryProvider = createRegionSelectorFixtureProvider({
    failFirstRoot: true,
  })
  await assert.rejects(
    retryProvider.listChildren({ parentId: null, signal }),
    /fixture root failure/u,
  )
  const roots = await retryProvider.listChildren({
    parentId: null,
    signal,
  })
  assert.deepEqual(
    roots.map(node => node.name),
    ['中国', '中国台湾', '马来西亚'],
  )
})

test('fixture 只依赖公共领域类型且 README 写明调用方职责', () => {
  const fixtureSource = readRelativeSource(
    '../../src/views/component_library/business/fixtures/region-selector.fixture.ts',
  )
  const readmeSource = readRelativeSource(
    '../../src/components/business/QsRegionSelector/README.md',
  )

  assert.match(fixtureSource, /import type \{[\s\S]*?RegionSelectorProvider[\s\S]*?\} from '@\/components\/business\/QsRegionSelector\/types'/u)
  assert.doesNotMatch(fixtureSource, /@\/api|useApp\w*Store|\.\/provider|QsRegionSelector\/provider/u)

  for (const contract of [
    'Public API',
    'Provider',
    'CITY UUID',
    '缓存与身份',
    '错误与重试',
    '原生表单与 FormData',
    'Showcase 边界',
    '调用方职责',
  ]) {
    assert.match(readmeSource, new RegExp(contract, 'u'))
  }
  assert.match(readmeSource, /不保存(?:地区)?展示名称/u)
  assert.match(readmeSource, /中国台湾[\s\S]*台湾[\s\S]*高雄市/u)
})
