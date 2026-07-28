import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- Showcase 与 fixture 契约使用 Node.js 内置 runner。
import test from 'node:test'
import {
  createRegionSelectorFixtureProvider,
  REGION_SELECTOR_FIXTURE_IDS,
} from '../../src/views/component_library/business/fixtures/region-selector.fixture'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function readSelectorTag(source: string, inputId: string): string {
  const tag = [...source.matchAll(/<QsRegionSelector\b[\s\S]*?\/>/gu)]
    .map(match => match[0])
    .find(candidate => candidate.includes(`id="${inputId}"`))

  assert.ok(tag, `QsRegionSelector ${inputId} should exist`)
  return tag
}

test('地区选择器拥有独立展示页且不聚合其他业务组件', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/business/region-selector.vue',
  )
  const tablePageSource = readRelativeSource(
    '../../src/views/component_library/business/index.vue',
  )

  assert.match(
    pageSource,
    /defineOptions\(\{ name: 'ComponentLibraryQsRegionSelector' \}\)/u,
  )
  assert.match(
    pageSource,
    /import RegionSelectorShowcase from '.\/components\/RegionSelectorShowcase\.vue'/u,
  )
  assert.match(pageSource, /title="地区选择器"/u)
  assert.match(
    pageSource,
    /route-path="\/component-library\/business\/region-selector"/u,
  )
  assert.match(pageSource, /<RegionSelectorShowcase\s*\/>/u)
  assert.match(pageSource, /原子绑定三级 ID/u)
  assert.doesNotMatch(
    pageSource,
    /Generic(Table|Drawer|Modal)Showcase|GoodTooltipShowcase/u,
  )
  assert.doesNotMatch(tablePageSource, /RegionSelectorShowcase/u)
})

test('Showcase 标准状态读取正式数据库且 fixture 只隔离异常边界', () => {
  const source = readRelativeSource(
    '../../src/views/component_library/business/components/RegionSelectorShowcase.vue',
  )
  const pageSource = readRelativeSource(
    '../../src/views/component_library/business/region-selector.vue',
  )

  assert.match(
    source,
    /import QsRegionSelector from '@\/components\/business\/QsRegionSelector\/index\.vue'/u,
  )
  assert.match(source, /createRegionSelectorFixtureProvider/u)
  for (const inputId of [
    'region-selector-showcase-standard',
    'region-selector-showcase-taiwan',
    'region-selector-showcase-readonly',
    'region-selector-showcase-disabled',
  ]) {
    assert.doesNotMatch(readSelectorTag(source, inputId), /:provider=/u)
  }
  assert.match(
    readSelectorTag(source, 'region-selector-showcase-stopped'),
    /:provider="stoppedProvider"/u,
  )
  assert.match(
    readSelectorTag(source, 'region-selector-showcase-retry'),
    /:provider="retryProvider"/u,
  )
  assert.equal(source.match(/:provider="stoppedProvider"/gu)?.length, 1)
  assert.match(pageSource, /标准状态直接读取数据库/u)
  assert.doesNotMatch(
    source,
    /@\/api|useApp\w*Store|regionSelectorProviderKey|createDefaultRegionSelectorProvider/u,
  )
})

test('Showcase 使用结构化三级 value 与空格完整路径', () => {
  const source = readRelativeSource(
    '../../src/views/component_library/business/components/RegionSelectorShowcase.vue',
  )
  const harnessSource = readRelativeSource(
    '../../src/views/component_library/business/region-selector-browser-harness.vue',
  )
  const readmeSource = readRelativeSource(
    '../../src/components/business/QsRegionSelector/README.md',
  )

  for (const candidate of [source, harnessSource, readmeSource]) {
    assert.doesNotMatch(candidate, /中国台湾\s*\/\s*台湾\s*\/\s*高雄市/u)
    assert.doesNotMatch(candidate, /join\(' \/ '\)/u)
  }
  assert.match(source, /RegionSelectorValue/u)
  assert.match(harnessSource, /RegionSelectorValue/u)
  assert.match(source, /中国台湾 台湾 高雄市/u)
  assert.match(source, /countryRegionId/u)
  assert.match(source, /provinceStateId/u)
  assert.match(source, /cityId/u)
  assert.match(source, /complete=\$\{change\.complete\}/u)
  assert.doesNotMatch(source, /远程搜索|搜索城市/u)
})

test('Browser harness 暴露三个受控 UUID 与稳定的三级 DOM 入口', () => {
  const source = readRelativeSource(
    '../../src/views/component_library/business/region-selector-browser-harness.vue',
  )

  for (const testId of [
    'region-selector-country-value',
    'region-selector-province-value',
    'region-selector-city-value',
    'region-selector-e2e-primary',
    'region-selector-e2e-secondary',
    'region-selector-e2e-readonly',
    'region-selector-e2e-disabled',
  ]) {
    assert.match(source, new RegExp(`data-testid="${testId}"`, 'u'))
  }
  assert.match(source, /createTaiwanValue/u)
  assert.match(source, /TAIWAN_COUNTRY_REGION_ID/u)
  assert.match(source, /TAIWAN_PROVINCE_STATE_ID/u)
})

test('fixture 固定台湾高雄与停用历史路径并支持一次失败后重试', async () => {
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

test('README 固定 Provider、缓存、错误、表单与调用方职责', () => {
  const fixtureSource = readRelativeSource(
    '../../src/views/component_library/business/fixtures/region-selector.fixture.ts',
  )
  const readmeSource = readRelativeSource(
    '../../src/components/business/QsRegionSelector/README.md',
  )

  assert.match(
    fixtureSource,
    /import type \{[\s\S]*?RegionSelectorProvider[\s\S]*?\} from '@\/components\/business\/QsRegionSelector\/types'/u,
  )
  assert.doesNotMatch(
    fixtureSource,
    /@\/api|useApp\w*Store|\.\/provider|QsRegionSelector\/provider/u,
  )

  for (const contract of [
    'Public API',
    'RegionSelectorValue',
    'Provider',
    '缓存与身份',
    '错误与重试',
    '原生表单与 FormData',
    'Showcase 边界',
    '调用方职责',
  ]) {
    assert.match(readmeSource, new RegExp(contract, 'u'))
  }
  assert.match(readmeSource, /不保存地区展示名称/u)
  assert.match(readmeSource, /中国台湾 台湾 高雄市/u)
  assert.match(readmeSource, /不下载全球完整地区树/u)
})
