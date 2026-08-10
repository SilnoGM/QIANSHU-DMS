import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// eslint-disable-next-line test/no-import-node-test -- Showcase 与内存 Provider 契约使用 Node runner 固定，不依赖浏览器环境。
import test from 'node:test'
import {
  createDictionarySelectFixtureController,
  DICTIONARY_SELECT_FIXTURE_CODES,
  DICTIONARY_SELECT_FIXTURE_VALUES,
} from '../../src/views/component_library/business/fixtures/dictionary-select.fixture'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('fixture Provider 固定顺序、重复 Label、历史项、空与 missing', async () => {
  const fixture = createDictionarySelectFixtureController()
  const signal = new AbortController().signal
  const status = await fixture.provider.get({
    code: DICTIONARY_SELECT_FIXTURE_CODES.status,
    signal,
  })

  assert.deepEqual(status?.items.map(item => item.value), [
    DICTIONARY_SELECT_FIXTURE_VALUES.waiting,
    DICTIONARY_SELECT_FIXTURE_VALUES.running,
    DICTIONARY_SELECT_FIXTURE_VALUES.runningAlternate,
    DICTIONARY_SELECT_FIXTURE_VALUES.archived,
  ])
  assert.equal(status?.items[1]?.label, status?.items[2]?.label)
  assert.equal(status?.items[3]?.effectiveEnabled, false)

  const empty = await fixture.provider.get({
    code: DICTIONARY_SELECT_FIXTURE_CODES.empty,
    signal,
  })
  assert.ok(empty)
  assert.equal(empty.items.some(item => item.effectiveEnabled), false)
  assert.equal(await fixture.provider.get({
    code: DICTIONARY_SELECT_FIXTURE_CODES.missing,
    signal,
  }), null)
})

test('fixture Provider 首错重试、失效订阅和可控迟到响应均可重复验收', async () => {
  const fixture = createDictionarySelectFixtureController()
  const signal = new AbortController().signal

  await assert.rejects(
    fixture.provider.get({
      code: DICTIONARY_SELECT_FIXTURE_CODES.retry,
      signal,
    }),
    /fixture retry failure/u,
  )
  const retryCatalog = await fixture.provider.get({
    code: DICTIONARY_SELECT_FIXTURE_CODES.retry,
    signal,
  })
  assert.equal(retryCatalog?.code, DICTIONARY_SELECT_FIXTURE_CODES.retry)
  assert.equal(
    fixture.getRequestCount(DICTIONARY_SELECT_FIXTURE_CODES.retry),
    2,
  )

  const invalidations: (null | string)[] = []
  const unsubscribe = fixture.provider.subscribeInvalidation((event) => {
    invalidations.push(event.code)
  })
  fixture.invalidate(DICTIONARY_SELECT_FIXTURE_CODES.status)
  fixture.invalidate(null)
  unsubscribe()
  fixture.invalidate(DICTIONARY_SELECT_FIXTURE_CODES.empty)
  assert.deepEqual(invalidations, [
    DICTIONARY_SELECT_FIXTURE_CODES.status,
    null,
  ])

  const phaseController = new AbortController()
  const delayedPhase = fixture.provider.get({
    code: DICTIONARY_SELECT_FIXTURE_CODES.phase,
    signal: phaseController.signal,
  })
  assert.equal(fixture.hasPendingPhaseRequest(), true)
  phaseController.abort()
  fixture.releasePendingPhase()
  assert.equal(
    (await delayedPhase)?.code,
    DICTIONARY_SELECT_FIXTURE_CODES.phase,
  )
  assert.equal(fixture.hasPendingPhaseRequest(), false)
})

test('独立页面组合真实组件与中性 fixture，不读取 API、Store 或写能力', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/business/dictionary-select.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/business/components/DictionarySelectShowcase.vue',
  )
  const fixtureSource = readRelativeSource(
    '../../src/views/component_library/business/fixtures/dictionary-select.fixture.ts',
  )

  assert.match(pageSource, /defineOptions\(\{ name: 'ComponentLibraryQsDictionarySelect' \}\)/u)
  assert.match(pageSource, /import ComponentCatalogPage from '\.\.\/shared\/ComponentCatalogPage\.vue'/u)
  assert.match(pageSource, /import DictionarySelectShowcase from '\.\/components\/DictionarySelectShowcase\.vue'/u)
  assert.match(pageSource, /title="字典选择器"/u)
  assert.match(pageSource, /<DictionarySelectShowcase\s*\/>/u)

  assert.match(showcaseSource, /import QsDictionarySelect from '@\/components\/business\/QsDictionarySelect\/index\.vue'/u)
  assert.match(showcaseSource, /import \{ FaCombobox \} from '@fantastic-admin\/components'/u)
  assert.match(showcaseSource, /provide\(dictionaryCatalogProviderKey, fixtureController\.provider\)/u)
  assert.match(showcaseSource, /new FormData/u)
  assert.match(showcaseSource, /<FaFormItem/u)
  assert.match(showcaseSource, /sameObjectLabelOptions/u)
  assert.match(showcaseSource, /releasePendingPhase/u)
  assert.match(showcaseSource, /<section[\s\S]*?aria-labelledby="dictionary-select-showcase-title"/u)

  const selectTags = [...showcaseSource.matchAll(/<QsDictionarySelect[\s\S]*?\/>/gu)]
    .map(match => match[0])
  const scenarios = [
    ['dictionary-select-standard', 'standardValue', 'DICTIONARY_SELECT_FIXTURE_CODES.status'],
    ['dictionary-select-history-disabled', 'disabledHistoryValue', 'DICTIONARY_SELECT_FIXTURE_CODES.status'],
    ['dictionary-select-history-unknown', 'unknownHistoryValue', 'DICTIONARY_SELECT_FIXTURE_CODES.status'],
    ['dictionary-select-duplicate-label', 'duplicateLabelValue', 'DICTIONARY_SELECT_FIXTURE_CODES.status'],
    ['dictionary-select-disabled', 'disabledValue', 'DICTIONARY_SELECT_FIXTURE_CODES.status'],
    ['dictionary-select-empty', 'emptyValue', 'DICTIONARY_SELECT_FIXTURE_CODES.empty'],
    ['dictionary-select-missing', 'missingValue', 'DICTIONARY_SELECT_FIXTURE_CODES.missing'],
    ['dictionary-select-invalid', 'invalidValue', 'invalid-code'],
    ['dictionary-select-retry', 'retryValue', 'DICTIONARY_SELECT_FIXTURE_CODES.retry'],
    ['dictionary-select-code-switch', 'codeSwitchValue', 'codeSwitchCode'],
    ['dictionary-select-native-form', 'nativeFormValue', 'DICTIONARY_SELECT_FIXTURE_CODES.status'],
    ['dictionary-select-form-item', 'faFormModel.status', 'DICTIONARY_SELECT_FIXTURE_CODES.status'],
  ] as const
  assert.equal(selectTags.length, scenarios.length)
  for (const [testId, model, code] of scenarios) {
    const matchingTags = selectTags.filter(tag => (
      tag.includes(`data-testid="${testId}"`)
    ))
    assert.equal(matchingTags.length, 1, `${testId} 必须唯一落在真实组件标签`)
    const [tag] = matchingTags
    assert.ok(tag?.includes(`v-model="${model}"`), `${testId} 缺少目标 model`)
    assert.ok(tag?.includes(code), `${testId} 缺少目标 dictionary code`)
  }
  const disabledTag = selectTags.find(tag => (
    tag.includes('data-testid="dictionary-select-disabled"')
  )) ?? ''
  assert.match(disabledTag, /\sdisabled[\s>]/u)
  const nativeFormTag = selectTags.find(tag => (
    tag.includes('data-testid="dictionary-select-native-form"')
  )) ?? ''
  assert.match(nativeFormTag, /name="workflowStatus"/u)
  assert.match(nativeFormTag, /\srequired[\s>]/u)
  assert.match(showcaseSource, /for="dictionary-select-showcase-native-form"/u)
  assert.match(
    showcaseSource,
    /<FaFormItem name="status" label="表单状态" required>[\s\S]*?<QsDictionarySelect[\s\S]*?data-testid="dictionary-select-form-item"/u,
  )
  assert.match(showcaseSource, /\.dictionary-showcase-card \{[\s\S]*?min-width:\s*0/u)
  assert.match(showcaseSource, /md:grid-cols-2/u)

  const objectFixture = showcaseSource.match(
    /<div data-testid="dictionary-select-object-values">[\s\S]*?<\/div>/u,
  )?.[0] ?? ''
  assert.match(objectFixture, /<FaCombobox/u)
  assert.match(objectFixture, /:options="sameObjectLabelOptions"/u)
  assert.match(objectFixture, /dictionary-select-showcase-object-values/u)
  assert.equal(
    showcaseSource.match(/data-testid="dictionary-select-object-values"/gu)?.length,
    1,
  )

  for (const source of [pageSource, showcaseSource, fixtureSource]) {
    assert.doesNotMatch(
      source,
      /@\/api|useApp\w*Store|dictionariesApi|\bfetch\(|axios|localStorage|sessionStorage/u,
    )
  }
  assert.doesNotMatch(fixtureSource, /DictionaryCatalogProviderController/u)
})

test('组件库文档记录真实十一个叶子页面与字典选择器边界', () => {
  const source = readRelativeSource(
    '../../../../../docs/前端文档/组件库建设方案.md',
  )
  assert.match(source, /字典选择器\s+\/component-library\/business\/dictionary-select/u)
  assert.match(source, /11 个/u)
  assert.match(source, /fixture Provider/u)
})
