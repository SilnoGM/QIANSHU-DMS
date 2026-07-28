import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 公共契约与私有实现边界使用 Node.js 内置 runner 固定。
import test from 'node:test'

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('QsRegionSelector 公开结构化三级 value、typed change 与业务 Provider', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )
  const typesSource = readSource(
    '../../src/components/business/QsRegionSelector/types.ts',
  )

  assert.match(
    source,
    /defineOptions\(\{[\s\S]*?name: 'QsRegionSelector'[\s\S]*?inheritAttrs: false/u,
  )
  assert.match(source, /modelValue\?: RegionSelectorValue/u)
  assert.match(source, /provider\?: RegionSelectorProvider/u)
  assert.match(
    source,
    /'update:modelValue': \[value: RegionSelectorValue\]/u,
  )
  assert.match(source, /change: \[detail: RegionSelectorChange\]/u)
  assert.match(source, /focus: \[event: FocusEvent\]/u)
  assert.match(source, /blur: \[event: FocusEvent\]/u)
  assert.match(source, /props\.provider \?\? inject\(regionSelectorProviderKey/u)
  assert.match(source, /defineExpose\(\{[\s\S]+?focus,[\s\S]+?blur,/u)

  assert.match(
    typesSource,
    /export interface RegionSelectorValue \{[\s\S]*?countryRegionId: string \| null[\s\S]*?provinceStateId: string \| null[\s\S]*?cityId: string \| null/u,
  )
  assert.match(
    typesSource,
    /export type RegionSelectorSelectedPath[\s\S]*?RegionSelectorCountryPath[\s\S]*?RegionSelectorProvincePath[\s\S]*?RegionSelectorPath/u,
  )
  assert.doesNotMatch(
    typesSource,
    /export interface RegionSelectorChange/u,
  )
  for (const contract of [
    /source: 'countryRegion'[\s\S]*?path: RegionSelectorCountryPath[\s\S]*?complete: false/u,
    /source: 'provinceState'[\s\S]*?path: RegionSelectorProvincePath[\s\S]*?complete: false/u,
    /source: 'city'[\s\S]*?path: RegionSelectorPath[\s\S]*?complete: true/u,
    /source: 'clear'[\s\S]*?path: readonly \[\][\s\S]*?complete: false/u,
  ]) {
    assert.match(typesSource, contract)
  }
  assert.doesNotMatch(source, /@\/api|useApp\w*Store/u)
  assert.doesNotMatch(typesSource, /@arco-design|AcceptableValue/u)
})

test('私有实现恰好使用三个 FaSelect，不再包含级联、组件搜索或整树代码', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )
  const logicSource = readSource(
    '../../src/components/business/QsRegionSelector/logic.ts',
  )

  assert.equal(source.match(/<FaSelect\b/gu)?.length, 3)
  assert.match(source, /data-region-level="COUNTRY_REGION"/u)
  assert.match(source, /data-region-level="PROVINCE_STATE"/u)
  assert.match(source, /data-region-level="CITY"/u)
  assert.match(source, /@update:model-value="handleCountryRegionChange"/u)
  assert.match(source, /@update:model-value="handleProvinceStateChange"/u)
  assert.match(source, /@update:model-value="handleCityChange"/u)
  assert.doesNotMatch(source, /<FaSelect[\s\S]*?@change=/u)

  for (const candidate of [source, logicSource]) {
    assert.doesNotMatch(
      candidate,
      /ACascader|FaCascader|RegionCascaderOption|arco-cascader/u,
    )
  }
  assert.doesNotMatch(
    source,
    /provider\.search|searchRegions|searchTree|allow-search/u,
  )
})

test('组件按国家、省州、城市与 path 独立管理取消、版本、防迟到和重试', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )

  for (const token of [
    'countryRequestVersion',
    'provinceRequestVersion',
    'cityRequestVersion',
    'pathRequestVersion',
    'countryController',
    'provinceController',
    'cityController',
    'pathController',
    'AbortController',
    'subscribeInvalidation',
  ]) {
    assert.match(source, new RegExp(`\\b${token}\\b`, 'u'), token)
  }
  assert.match(source, /async function loadCountries/u)
  assert.match(source, /async function loadProvinceStates/u)
  assert.match(source, /async function loadCities/u)
  assert.match(source, /async function hydrateCompleteValue/u)
  assert.match(
    source,
    /const countriesPromise = loadCountries\(force\)[\s\S]*?if \(isCompleteRegionSelectorValue\(value\)\)/u,
  )
  assert.match(source, /let hydrationStarted = false/u)
  assert.match(
    source,
    /if \(hydrationStarted && sameValue\(next, currentValue\.value\)\)[\s\S]*?hydrationStarted = true/u,
  )
  assert.match(source, /function retryVisibleError/u)
  assert.match(
    source,
    /loadProvinceStates[\s\S]*?currentValue\.value\.countryRegionId !== country\.id/u,
  )
  assert.match(
    source,
    /loadCities[\s\S]*?currentValue\.value\.provinceStateId !== province\.id/u,
  )
  assert.match(
    source,
    /handleInvalidation[\s\S]*?cancelAllRequests\(\)[\s\S]*?countries\.value = \[\][\s\S]*?hydrateCurrentValue\(true\)/u,
  )

  const subscriptionIndex = source.indexOf(
    'unsubscribeInvalidation = provider?.subscribeInvalidation?.(',
  )
  const immediateModelWatchIndex = source.indexOf(
    'watch(\n  () => [',
  )
  assert.ok(subscriptionIndex >= 0)
  assert.ok(immediateModelWatchIndex >= 0)
  assert.ok(subscriptionIndex < immediateModelWatchIndex)
})

test('列表重试重新进入当前 value hydration，恢复合法的外部部分路径', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )
  const retrySection = source.match(
    /function retryVisibleError[\s\S]*?\n\}\n/u,
  )?.[0] ?? ''

  assert.match(
    retrySection,
    /hydrateCurrentValue\(error\.scope === 'countries'\)/u,
  )
  assert.doesNotMatch(
    retrySection,
    /loadProvinceStates|loadCities/u,
  )
})

test('用户切换上级会立即清空下级，外部回显不会发业务 change', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )
  const countrySection = source.match(
    /function handleCountryRegionChange[\s\S]*?\n\}\n/u,
  )?.[0] ?? ''
  const provinceSection = source.match(
    /function handleProvinceStateChange[\s\S]*?\n\}\n/u,
  )?.[0] ?? ''
  const hydrationSection = source.match(
    /async function hydrateCurrentValue[\s\S]*?\n\}\n/u,
  )?.[0] ?? ''

  assert.match(countrySection, /provinceStates\.value = \[\]/u)
  assert.match(countrySection, /cities\.value = \[\]/u)
  assert.match(
    countrySection,
    /createRegionSelectorChange\('countryRegion', \[country\]\)/u,
  )
  assert.match(provinceSection, /cities\.value = \[\]/u)
  assert.match(provinceSection, /createRegionSelectorChange\('provinceState'/u)
  assert.match(source, /createRegionSelectorChange\('city'/u)
  assert.match(source, /createRegionSelectorChange\('clear', \[\]\)/u)
  assert.doesNotMatch(hydrationSection, /emit\(/u)
  assert.match(source, /emit\('update:modelValue', change\.value\)/u)
  assert.match(source, /emit\('change', change\)/u)
})

test('表单代理继续提交 CITY UUID，required 只认可已验证完整 path', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )
  const controlSource = readSource(
    '../../src/components/business/QsRegionSelector/control-attrs.ts',
  )

  assert.match(source, /data-slot="qs-region-selector-form-control"/u)
  assert.match(source, /type="text"/u)
  assert.match(source, /:value="currentValue\.cityId \?\? ''"/u)
  assert.match(source, /proxy\.setCustomValidity\(/u)
  assert.match(source, /!completePathVerified\.value/u)
  assert.match(source, /const nativeInvalid = ref\(false\)/u)
  assert.match(source, /requiredFeedbackVisible/u)
  assert.match(source, /'请选择完整地区'/u)
  assert.match(source, /@invalid="handleInvalid"/u)
  assert.match(
    source,
    /nativeInvalid\.value = true[\s\S]*?nextTick[\s\S]*?focusInvalidTarget/u,
  )
  assert.match(
    source,
    /invalid: props\.error[\s\S]*?\|\| pathError\.value !== null[\s\S]*?\|\| requiredFeedbackVisible\.value/u,
  )
  assert.match(
    source,
    /v-if="requiredFeedbackVisible"[\s\S]*?请选择完整地区/u,
  )
  assert.match(controlSource, /'form'[\s\S]*?'name'[\s\S]*?'required'/u)
  assert.match(controlSource, /必须包含三个 FaSelect trigger/u)
  assert.doesNotMatch(controlSource, /formdata|document\.querySelector/u)
})

test('只读、禁用、清空、错误与响应式样式使用既有产品语言', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )

  assert.match(source, /data-slot="qs-region-selector-readonly"/u)
  assert.match(
    source,
    /<input[\s\S]*?data-slot="qs-region-selector-readonly"[\s\S]*?:value="readonlyPathLabel"[\s\S]*?readonly/u,
  )
  assert.match(source, /aria-readonly="true"/u)
  assert.match(source, /data-slot="qs-region-selector-clear"/u)
  assert.match(source, /aria-label="清空地区选择"/u)
  assert.match(source, /provinceStateDisabled/u)
  assert.match(source, /cityDisabled/u)
  assert.match(source, /data-slot="qs-region-selector-path"/u)
  assert.match(source, /role="status"/u)
  assert.match(source, /aria-live="polite"/u)
  assert.match(source, /role="alert"/u)
  assert.match(source, /requestId/u)
  assert.match(source, /重试加载/u)
  assert.match(source, /当前历史地区已停用，仅供回显/u)
  assert.match(
    source,
    /sm:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(0,1\.15fr\)\]/u,
  )
  assert.match(source, /min-height:\s*44px/u)
  assert.match(source, /prefers-reduced-motion:\s*reduce/u)
  assert.match(source, /oklch\(var\(--(?:foreground|border|muted|ring)\)\)/u)
  assert.doesNotMatch(
    source,
    /gradient|backdrop-filter|font-family|#[0-9a-f]{3,8}\b|rgba?\(/iu,
  )
})

test('成功加载空列表时显示明确空状态并禁用对应下拉', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )

  for (const state of [
    'countryEmpty',
    'provinceStateEmpty',
    'cityEmpty',
  ]) {
    assert.match(source, new RegExp(`const ${state} = computed`, 'u'))
  }
  assert.match(source, /暂无可选国家\/地区/u)
  assert.match(source, /暂无可选省\/州/u)
  assert.match(source, /暂无可选城市/u)
  assert.match(source, /:disabled="disabled \|\| countryLoading \|\| countryEmpty"/u)
  assert.match(
    source,
    /provinceStateDisabled[\s\S]*?\|\| provinceStateEmpty\.value/u,
  )
  assert.match(source, /cityDisabled[\s\S]*?\|\| cityEmpty\.value/u)
  assert.match(
    source,
    /focusInvalidTarget[\s\S]*?countryLoading\.value \|\| countryEmpty\.value/u,
  )
})

test('只有已验证 path 能显示选中值、启用下级并决定必填焦点', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )

  assert.match(
    source,
    /const selectedCountryRegionId = computed[\s\S]*?selectedPath\.value\[0\]\?\.id/u,
  )
  assert.match(
    source,
    /const selectedProvinceStateId = computed[\s\S]*?selectedPath\.value\[1\]\?\.id/u,
  )
  assert.match(
    source,
    /const selectedCityId = computed[\s\S]*?selectedPath\.value\[2\]\?\.id/u,
  )
  assert.match(
    source,
    /provinceStateDisabled[\s\S]*?selectedPath\.value\.length < 1/u,
  )
  assert.match(source, /cityDisabled[\s\S]*?selectedPath\.value\.length < 2/u)
  assert.match(
    source,
    /function firstIncompleteLevel[\s\S]*?selectedPath\.value\.length === 0[\s\S]*?selectedPath\.value\.length === 1[\s\S]*?selectedPath\.value\.length === 2/u,
  )
  assert.match(
    source,
    /:model-value="selectedCountryRegionId \?\? undefined"/u,
  )
  assert.match(
    source,
    /:model-value="selectedProvinceStateId \?\? undefined"/u,
  )
  assert.match(source, /:model-value="selectedCityId \?\? undefined"/u)
})

test('正式需求、技术设计与实施步骤同步三级独立下拉最终契约', () => {
  const requirements = readSource(
    '../../../../../specs/region-selector-management/requirements.md',
  )
  const design = readSource(
    '../../../../../specs/region-selector-management/design.md',
  )
  const tasks = readSource(
    '../../../../../specs/region-selector-management/tasks.md',
  )
  const specifications = `${requirements}\n${design}\n${tasks}`

  assert.match(specifications, /三个并列的? `FaSelect`/u)
  assert.match(specifications, /RegionSelectorValue/u)
  assert.match(
    specifications,
    /countryRegionId[\s\S]*?provinceStateId[\s\S]*?cityId/u,
  )
  assert.match(specifications, /中国台湾 台湾 高雄市/u)
  assert.doesNotMatch(specifications, /中国台湾 \/ 台湾 \/ 高雄市/u)
  assert.doesNotMatch(
    specifications,
    /内部采用项目已锁定的 `ACascader|`ACascader@2\.58\.0` 为私有内核/u,
  )
})
