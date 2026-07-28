import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 选择器公共契约与私有内核使用 Node.js 内置 runner 固定。
import test from 'node:test'

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('QsRegionSelector 只暴露 CITY UUID、typed change 与业务 Provider', () => {
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
  assert.match(source, /modelValue\?: string \| null/u)
  assert.match(source, /provider\?: RegionSelectorProvider/u)
  assert.match(source, /'update:modelValue': \[value: string \| null\]/u)
  assert.match(source, /change: \[detail: RegionSelectorChange\]/u)
  assert.match(source, /focus: \[event: FocusEvent\]/u)
  assert.match(source, /blur: \[event: FocusEvent\]/u)
  assert.match(source, /props\.provider \?\? inject\(regionSelectorProviderKey/u)
  assert.match(source, /defineExpose\(\{[\s\S]*?\bfocus\b/u)
  assert.match(source, /defineExpose\(\{[\s\S]*?\bblur\b/u)
  assert.doesNotMatch(source, /<script setup[^>]*>[\s\S]*?\bexport const\b/u)

  assert.match(
    typesSource,
    /export type RegionSelectorPath = readonly \[[\s\S]*?COUNTRY_REGION[\s\S]*?PROVINCE_STATE[\s\S]*?CITY/u,
  )
  assert.match(
    typesSource,
    /source: 'select'[\s\S]*?value: string[\s\S]*?path: RegionSelectorPath/u,
  )
  assert.match(
    typesSource,
    /source: 'clear'[\s\S]*?value: null[\s\S]*?path: null/u,
  )
  assert.doesNotMatch(source, /@\/api|useApp\w*Store|FaCascader/u)
  assert.doesNotMatch(typesSource, /@arco-design|CascaderOption/u)
})

test('私有 ACascader 固定单选叶子、lazy、远程搜索与受控弹层参数', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )

  assert.match(
    source,
    /import \{ Cascader as ACascader \} from '@arco-design\/web-vue'/u,
  )
  assert.match(source, /<ACascader/u)
  assert.match(
    source,
    /:model-value="modelValue \?\? ''"/u,
    '公共 null 必须显式传为空字符串，不能让 Arco 回退到内部非受控 value',
  )
  assert.match(source, /:multiple="false"/u)
  assert.match(source, /:path-mode="false"/u)
  assert.match(source, /:check-strictly="false"/u)
  assert.match(source, /expand-trigger="click"/u)
  assert.match(source, /:allow-search="!readonly"/u)
  assert.match(source, /:allow-clear="clearable && !readonly"/u)
  assert.match(source, /:search-option-only-label="false"/u)
  assert.match(source, /:search-delay="REGION_SELECTOR_SEARCH_DELAY_MS"/u)
  assert.match(source, /:fallback="formatFallback"/u)
  assert.match(source, /:input-value="inputValue"/u)
  assert.match(source, /:popup-visible="popupVisible"/u)
  assert.match(source, /:load-more="loadChildren"/u)
  assert.match(source, /:filter-option="filterOption"/u)
  assert.match(source, /:format-label="formatLabel"/u)
  assert.match(source, /:trigger-props="triggerProps"/u)
  assert.match(source, /:popup-container="popupContainer"/u)
  assert.match(source, /qs-region-selector-popup/u)
  assert.match(source, /@input-value-change="handleInputValueChange"/u)
  assert.match(source, /@popup-visible-change="handlePopupVisibleChange"/u)
  assert.match(source, /@change="handleChange"/u)
  assert.match(source, /@clear="handleClear"/u)
  assert.match(source, /:key="cascaderGeneration"/u)
})

test('组件分别管理 path、root、lazy、search 的取消、版本、防迟到与重试', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )

  for (const token of [
    'navigationTree',
    'resolvedPathTree',
    'searchTree',
    'pathRequestVersion',
    'rootRequestVersion',
    'searchRequestVersion',
    'lazyRequests',
    'rootLoaded',
    'searchCompleted',
    'cascaderGeneration',
    'AbortController',
    'subscribeInvalidation',
  ]) {
    assert.match(source, new RegExp(`\\b${token}\\b`, 'u'), token)
  }

  assert.match(source, /REGION_SELECTOR_SEARCH_DELAY_MS = 250/u)
  assert.match(source, /async function resolveCurrentPath/u)
  assert.match(source, /async function loadRoot/u)
  assert.match(source, /function loadChildren/u)
  assert.match(source, /async function searchRegions/u)
  assert.match(source, /function retryPath/u)
  assert.match(source, /function retryRoot/u)
  assert.match(source, /function retryLazy/u)
  assert.match(source, /function retrySearch/u)
  assert.match(
    source,
    /loadChildren[\s\S]*?\.catch\([\s\S]*?done\(\)/u,
  )
  assert.match(
    source,
    /const pending = Promise\.resolve\(\)\.then\(\(\) => \{[\s\S]*?provider\.listChildren/u,
  )
  assert.doesNotMatch(source, /done\(\[\]\)/u)
  assert.match(
    source,
    /watch\([\s\S]*?\(\) => props\.modelValue[\s\S]*?resolveCurrentPath/u,
  )
  assert.match(
    source,
    /handlePopupVisibleChange[\s\S]*?loadRoot/u,
  )
  assert.match(
    source,
    /handleInvalidation[\s\S]*?cascaderGeneration\.value \+= 1[\s\S]*?navigationTree\.value = \[\][\s\S]*?searchTree\.value = \[\][\s\S]*?resolveCurrentPath/u,
  )
  assert.match(source, /<template #empty>/u)
  assert.match(source, /暂无可选地区/u)
  assert.match(source, /未找到匹配的城市/u)

  const subscriptionIndex = source.indexOf(
    'unsubscribeInvalidation = provider?.subscribeInvalidation?.(',
  )
  const immediateModelWatchIndex = source.indexOf(
    'watch(\n  () => props.modelValue,',
  )
  assert.ok(subscriptionIndex >= 0)
  assert.ok(immediateModelWatchIndex >= 0)
  assert.ok(
    subscriptionIndex < immediateModelWatchIndex,
    '必须先订阅 provider invalidation，再启动 immediate path 请求',
  )
})

test('外部回显不触发 change，选择只接受有效 CITY，清空只发一次 null', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )

  const resolveSection = source.match(
    /async function resolveCurrentPath[\s\S]*?\n\}\n/u,
  )?.[0] ?? ''
  assert.doesNotMatch(resolveSection, /emit\(['"]change/u)
  assert.match(source, /resolveRegionSelection/u)
  assert.match(source, /selection\.source === 'select'/u)
  assert.match(source, /emit\('update:modelValue', selection\.value\)/u)
  assert.match(
    source,
    /emit\('change', selection\)/u,
  )
  assert.match(source, /function handleClear/u)
  assert.match(source, /emit\('update:modelValue', null\)/u)
  assert.match(
    source,
    /source: 'clear'[\s\S]*?value: null[\s\S]*?path: null/u,
  )
  assert.match(source, /value === '' \|\| value === undefined/u)
  assert.match(
    source,
    /verifiedCityValue[\s\S]*?findRegionPathByCityId\(/u,
  )
  assert.match(source, /modelValue: props\.modelValue \?\? null/u)
  assert.match(
    source,
    /hasValidCitySelection: verifiedCityValue\.value !== null/u,
  )
})

test('回显树只提供安全 label 与校验，不污染普通 lazy 交互树', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )
  const interactiveSection = source.match(
    /const interactiveOptions = computed\([\s\S]*?\n\)/u,
  )?.[0] ?? ''

  assert.match(source, /createRegionInteractiveTree/u)
  assert.match(interactiveSection, /navigationTree\.value/u)
  assert.match(interactiveSection, /searchTree\.value/u)
  assert.doesNotMatch(interactiveSection, /resolvedPathTree/u)
  assert.match(source, /function formatFallback\(value: unknown\): string/u)
  assert.match(source, /return formatRegionPathLabel/u)
  assert.match(source, /:options="interactiveOptions"/u)
  assert.match(
    source,
    /resolveRegionSelection\(value, interactiveOptions\.value\)/u,
  )
})

test('状态、真实 input bridge 与私有 popup 样式覆盖可访问响应式边界', () => {
  const source = readSource(
    '../../src/components/business/QsRegionSelector/index.vue',
  )

  assert.match(source, /createRegionSelectorControlBridge/u)
  assert.match(source, /splitRegionSelectorAttrs/u)
  assert.match(source, /onUpdated\(updateControlBridge\)/u)
  assert.match(
    source,
    /watch\(\s*\[\(\) => props\.readonly, \(\) => props\.disabled\]/u,
  )
  assert.match(
    source,
    /invalid: props\.error \|\| pathError\.value !== null/u,
  )
  assert.match(source, /data-slot="qs-region-selector"/u)
  assert.match(source, /role="status"/u)
  assert.match(source, /aria-live="polite"/u)
  assert.match(source, /role="alert"/u)
  assert.match(source, /重试加载/u)
  assert.match(source, /重试搜索/u)
  assert.match(source, /重试回显/u)
  assert.match(source, /已停用/u)
  assert.match(source, /只读/u)
  assert.match(source, /已禁用/u)
  assert.match(source, /requestId/u)
  assert.match(source, /w-full/u)
  assert.match(
    source,
    /const cascaderLoading = computed\(\(\) =>[\s\S]*?pathLoading\.value[\s\S]*?rootLoading\.value[\s\S]*?searchLoading\.value[\s\S]*?\)/u,
    '整面板 loading 必须排除 lazyRequests，避免 Arco 销毁已有级联列',
  )
  assert.match(
    source,
    /const busy = computed\(\(\) =>[\s\S]*?cascaderLoading\.value[\s\S]*?lazyRequests\.size > 0[\s\S]*?\)/u,
    '无障碍 busy 状态仍需覆盖单节点懒加载',
  )
  assert.match(source, /:loading="cascaderLoading"/u)
  assert.doesNotMatch(source, /:loading="busy"/u)
  assert.match(source, /max-width:\s*calc\(100vw - 24px\)/u)
  assert.match(source, /max-height:\s*min\(18rem, calc\(100dvh - 6rem\)\)/u)
  assert.match(source, /overflow:\s*auto hidden/u)
  assert.match(source, /--qs-region-selector-column-width:\s*11rem/u)
  assert.match(
    source,
    /inline-size:\s*min\(33rem, calc\(100vw - 24px\)\)/u,
    '普通级联面板应始终预留三个固定列宽',
  )
  assert.match(
    source,
    /\.arco-cascader-panel:not\(\.arco-cascader-search-panel\)::before\)/u,
  )
  assert.match(
    source,
    /inline-size:\s*calc\(var\(--qs-region-selector-column-width\) \+ var\(--qs-region-selector-column-width\) \+ var\(--qs-region-selector-column-width\)\)/u,
    '纯视觉背景层应扩展为三个列宽且不参与 Arco TransitionGroup',
  )
  assert.match(source, /box-shadow:[\s\S]*?--qs-region-selector-column-width/u)
  assert.match(source, /min-height:\s*44px/u)
  assert.match(
    source,
    /\.arco-select-view-clear-btn\)[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/u,
  )
  assert.match(
    source,
    /\.qs-region-selector :deep\(\.arco-select-view-single \.arco-select-view-clear-btn\)[\s\S]*?display:\s*inline-flex[\s\S]*?visibility:\s*visible/u,
    '已选值的清空控件必须覆盖 Arco 的 display 与 visibility 并保留可 Tab 到达的操作',
  )
  assert.match(source, /prefers-reduced-motion:\s*reduce/u)
  assert.match(source, /:global\(\.qs-region-selector-popup/u)
  assert.match(source, /oklch\(var\(--(?:background|foreground|border|muted|ring)\)\)/u)
  assert.doesNotMatch(source, /:global\(\.arco-/u)
  assert.doesNotMatch(
    source,
    /gradient|backdrop-filter|font-family|#[0-9a-f]{3,8}\b|rgba?\(/iu,
  )
})
