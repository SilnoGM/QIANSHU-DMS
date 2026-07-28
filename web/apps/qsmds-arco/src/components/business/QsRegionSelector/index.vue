<script setup lang="ts">
import type { CascaderOption } from '@arco-design/web-vue/es/cascader/interface'
import type {
  RegionCascaderOption,
  RegionRequestVersion,
} from './logic'
import type {
  RegionSelectorChange,
  RegionSelectorProvider,
} from './types'
import { Cascader as ACascader } from '@arco-design/web-vue'
import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  shallowReactive,
  useAttrs,
  useId,
  watch,
  watchPostEffect,
} from 'vue'
import {
  createRegionSelectorControlBridge,
  splitRegionSelectorAttrs,
} from './control-attrs'
import {
  createRegionInteractiveTree,
  createRegionOptions,
  createRegionPathTree,
  createRegionRequestVersion,
  createRegionSearchTree,
  filterRegionOption,
  findRegionPathByCityId,
  formatRegionPathLabel,
  normalizeRegionSearchText,
  replaceRegionChildren,
  resolveRegionSelection,
  validateRegionChildren,
} from './logic'
import { regionSelectorProviderKey } from './provider'

interface QsRegionSelectorProps {
  modelValue?: string | null
  provider?: RegionSelectorProvider
  placeholder?: string
  clearable?: boolean
  disabled?: boolean
  readonly?: boolean
  error?: boolean
}

interface VisibleRequestError {
  readonly message: string
  readonly requestId: string | null
}

interface LazyRetry {
  readonly done: (children?: CascaderOption[]) => void
  readonly option: RegionCascaderOption
}

interface LazyRequest extends LazyRetry {
  readonly controller: AbortController
  readonly version: number
  readonly versionControl: RegionRequestVersion
}

interface QsRegionSelectorEvents {
  change: [detail: RegionSelectorChange]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
}

interface QsRegionSelectorModelEvent {
  'update:modelValue': [value: string | null]
}

defineOptions({
  name: 'QsRegionSelector',
  inheritAttrs: false,
})

const props = withDefaults(defineProps<QsRegionSelectorProps>(), {
  clearable: true,
  disabled: false,
  error: false,
  modelValue: null,
  placeholder: '请选择国家/地区、省/州和城市',
  provider: undefined,
  readonly: false,
})

const emit = defineEmits<
  QsRegionSelectorEvents & QsRegionSelectorModelEvent
>()

const REGION_SELECTOR_SEARCH_DELAY_MS = 250

const attrs = useAttrs()
// prop provider 的优先级高于应用注入；Showcase 和隔离测试因此不会接触正式 API。
const provider = props.provider ?? inject(regionSelectorProviderKey)
const selectorRoot = ref<HTMLElement | null>(null)
const navigationTree = ref<RegionCascaderOption[]>([])
const resolvedPathTree = ref<RegionCascaderOption[]>([])
const searchTree = ref<RegionCascaderOption[]>([])
const inputValue = ref('')
const popupVisible = ref(false)
const cascaderGeneration = ref(0)

const pathRequestVersion = createRegionRequestVersion()
const rootRequestVersion = createRegionRequestVersion()
const searchRequestVersion = createRegionRequestVersion()
const lazyVersions = new Map<string, RegionRequestVersion>()
const lazyRequests = shallowReactive(new Map<string, LazyRequest>())

const pathController = ref<AbortController | null>(null)
const rootController = ref<AbortController | null>(null)
const searchController = ref<AbortController | null>(null)
const pathLoading = ref(false)
const rootLoading = ref(false)
const searchLoading = ref(false)
const pathError = ref<VisibleRequestError | null>(null)
const rootError = ref<VisibleRequestError | null>(null)
const searchError = ref<VisibleRequestError | null>(null)
const lazyError = ref<(VisibleRequestError & LazyRetry) | null>(null)
const searchHasMore = ref(false)
const rootLoaded = ref(false)
const searchCompleted = ref(false)
const lastSearchQuery = ref('')
const clearLocked = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let unsubscribeInvalidation: (() => void) | undefined
let bridgeMounted = false

const idPrefix = `qs-region-selector-${useId().replaceAll(':', '')}`
const loadingStatusId = `${idPrefix}-loading`
const errorStatusId = `${idPrefix}-error`
const stateStatusId = `${idPrefix}-state`
const popupContainer = 'body'
const triggerProps = Object.freeze({
  contentClass: 'qs-region-selector-popup',
  unmountOnClose: true,
})

const interactiveOptions = computed(() =>
  createRegionInteractiveTree(
    navigationTree.value,
    searchTree.value,
    normalizeRegionSearchText(inputValue.value).length > 0,
  ),
)
const busy = computed(() =>
  pathLoading.value
  || rootLoading.value
  || searchLoading.value
  || lazyRequests.size > 0,
)
const visibleError = computed(() =>
  pathError.value
  ?? rootError.value
  ?? lazyError.value
  ?? searchError.value,
)
const resolvedPath = computed(() => {
  if (!props.modelValue) {
    return null
  }
  return findRegionPathByCityId(resolvedPathTree.value, props.modelValue)
})
const verifiedCityValue = computed(() => {
  if (!props.modelValue) {
    return null
  }
  const path = findRegionPathByCityId(
    resolvedPathTree.value,
    props.modelValue,
  ) ?? findRegionPathByCityId(
    interactiveOptions.value,
    props.modelValue,
  )
  return path?.[2].id === props.modelValue ? props.modelValue : null
})
const stoppedPath = computed(() =>
  resolvedPath.value?.some(node =>
    !node.enabled || !node.effectiveEnabled,
  ) ?? false,
)
const describedBy = computed(() => [
  busy.value ? loadingStatusId : null,
  visibleError.value ? errorStatusId : null,
  (
    stoppedPath.value
    || props.readonly
    || props.disabled
    || searchHasMore.value
  )
    ? stateStatusId
    : null,
])

function getWrapperAttrs(): Readonly<Record<string, unknown>> {
  return splitRegionSelectorAttrs(attrs).wrapperAttrs
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 只提取公开 requestId，错误正文与底层异常均不进入界面。
 */
function readRequestId(error: unknown): string | null {
  try {
    if (!isRecord(error)) {
      return null
    }
    if (typeof error.requestId === 'string') {
      return error.requestId
    }
    if (isRecord(error.body) && typeof error.body.requestId === 'string') {
      return error.body.requestId
    }
  }
  catch {
    // 不可信错误对象的 getter 也不能破坏安全错误呈现。
  }
  return null
}

function createVisibleError(
  message: string,
  error: unknown,
): VisibleRequestError {
  return {
    message,
    requestId: readRequestId(error),
  }
}

function isAbortError(error: unknown): boolean {
  try {
    return (
      error instanceof DOMException && error.name === 'AbortError'
    ) || (
      isRecord(error)
      && (error.name === 'AbortError' || error.code === 'ERR_CANCELED')
    )
  }
  catch {
    return false
  }
}

function cancelPathRequest(): void {
  pathController.value?.abort()
  pathController.value = null
  pathRequestVersion.invalidate()
  pathLoading.value = false
}

function cancelRootRequest(): void {
  rootController.value?.abort()
  rootController.value = null
  rootRequestVersion.invalidate()
  rootLoading.value = false
}

function cancelSearchRequest(): void {
  if (searchTimer !== undefined) {
    clearTimeout(searchTimer)
    searchTimer = undefined
  }
  searchController.value?.abort()
  searchController.value = null
  searchRequestVersion.invalidate()
  searchLoading.value = false
}

function cancelLazyRequests(): void {
  for (const request of lazyRequests.values()) {
    request.controller.abort()
    request.versionControl.invalidate()
    // 结束 Arco 内部 loading，但不传 []，保留之后再次加载的能力。
    request.done()
  }
  lazyRequests.clear()
  lazyVersions.clear()
}

async function resolveCurrentPath(cityId = props.modelValue): Promise<void> {
  cancelPathRequest()
  resolvedPathTree.value = []
  pathError.value = null

  if (!cityId) {
    return
  }

  const controller = new AbortController()
  const version = pathRequestVersion.next()
  pathController.value = controller
  pathLoading.value = true

  try {
    if (!provider) {
      throw new Error('Region selector provider is unavailable')
    }
    const path = await provider.resolvePath({
      cityId,
      signal: controller.signal,
    })
    if (
      controller.signal.aborted
      || !pathRequestVersion.isCurrent(version)
      || props.modelValue !== cityId
    ) {
      return
    }
    resolvedPathTree.value = createRegionPathTree(path)
  }
  catch (error) {
    if (
      controller.signal.aborted
      || !pathRequestVersion.isCurrent(version)
      || isAbortError(error)
    ) {
      return
    }
    pathError.value = createVisibleError(
      '已选地区回显失败，原值已保留。',
      error,
    )
  }
  finally {
    if (pathRequestVersion.isCurrent(version)) {
      pathLoading.value = false
      pathController.value = null
    }
  }
}

async function loadRoot(force = false): Promise<void> {
  if (!force && rootLoaded.value) {
    return
  }

  cancelRootRequest()
  rootError.value = null
  const controller = new AbortController()
  const version = rootRequestVersion.next()
  rootController.value = controller
  rootLoading.value = true

  try {
    if (!provider) {
      throw new Error('Region selector provider is unavailable')
    }
    const roots = await provider.listChildren({
      parentId: null,
      signal: controller.signal,
    })
    if (
      controller.signal.aborted
      || !rootRequestVersion.isCurrent(version)
    ) {
      return
    }
    navigationTree.value = replaceRegionChildren(
      navigationTree.value,
      null,
      roots,
    )
    rootLoaded.value = true
  }
  catch (error) {
    if (
      controller.signal.aborted
      || !rootRequestVersion.isCurrent(version)
      || isAbortError(error)
    ) {
      return
    }
    rootError.value = createVisibleError('地区列表加载失败。', error)
  }
  finally {
    if (rootRequestVersion.isCurrent(version)) {
      rootLoading.value = false
      rootController.value = null
    }
  }
}

function asRegionOption(option: CascaderOption): RegionCascaderOption | null {
  if (
    !isRecord(option)
    || typeof option.value !== 'string'
    || !isRecord(option.region)
    || option.region.id !== option.value
  ) {
    return null
  }
  return option as RegionCascaderOption
}

function loadChildren(
  rawOption: CascaderOption,
  done: (children?: CascaderOption[]) => void,
): void {
  const option = asRegionOption(rawOption)
  if (!option || option.region.level === 'CITY') {
    done()
    return
  }

  const parentId = option.region.id
  const versionControl = lazyVersions.get(parentId)
    ?? createRegionRequestVersion()
  lazyVersions.set(parentId, versionControl)

  const previous = lazyRequests.get(parentId)
  previous?.controller.abort()
  previous?.versionControl.invalidate()
  previous?.done()

  const controller = new AbortController()
  const version = versionControl.next()
  const request: LazyRequest = {
    controller,
    done,
    option,
    version,
    versionControl,
  }
  lazyRequests.set(parentId, request)
  if (lazyError.value?.option.region.id === parentId) {
    lazyError.value = null
  }

  // Provider 可能同步抛错；统一纳入 Promise 链，保证 Arco 的 done() 必定结束 loading。
  const pending = Promise.resolve().then(() => {
    if (!provider) {
      throw new Error('Region selector provider is unavailable')
    }
    return provider.listChildren({
      parentId,
      signal: controller.signal,
    })
  })

  pending
    .then((children) => {
      if (
        controller.signal.aborted
        || !versionControl.isCurrent(version)
        || lazyRequests.get(parentId) !== request
      ) {
        done()
        return
      }

      const validChildren = validateRegionChildren(option.region, children)
      navigationTree.value = replaceRegionChildren(
        navigationTree.value,
        parentId,
        validChildren,
      )
      done(createRegionOptions(validChildren))
    })
    .catch((error: unknown) => {
      if (
        !controller.signal.aborted
        && versionControl.isCurrent(version)
        && lazyRequests.get(parentId) === request
        && !isAbortError(error)
      ) {
        lazyError.value = {
          ...createVisibleError(
            `${option.region.name}的下级地区加载失败。`,
            error,
          ),
          done,
          option,
        }
      }
      // 失败或 stale 都必须结束 Arco loading；undefined 不会标记为“已加载空数组”。
      done()
    })
    .finally(() => {
      if (lazyRequests.get(parentId) === request) {
        lazyRequests.delete(parentId)
      }
    })
}

async function searchRegions(query = lastSearchQuery.value): Promise<void> {
  const normalizedQuery = normalizeRegionSearchText(query)
  cancelSearchRequest()
  searchError.value = null
  searchHasMore.value = false
  searchCompleted.value = false

  if (normalizedQuery.length < 1) {
    searchTree.value = []
    return
  }

  const controller = new AbortController()
  const version = searchRequestVersion.next()
  searchController.value = controller
  searchLoading.value = true
  lastSearchQuery.value = normalizedQuery

  try {
    if (!provider) {
      throw new Error('Region selector provider is unavailable')
    }
    const result = await provider.search({
      query: normalizedQuery,
      signal: controller.signal,
    })
    if (
      controller.signal.aborted
      || !searchRequestVersion.isCurrent(version)
      || normalizeRegionSearchText(inputValue.value) !== normalizedQuery
    ) {
      return
    }
    // 每次搜索整树替换，不能把历史关键词的分支持续累积在内存中。
    searchTree.value = createRegionSearchTree(result.paths)
    searchHasMore.value = result.hasMore
    searchCompleted.value = true
  }
  catch (error) {
    if (
      controller.signal.aborted
      || !searchRequestVersion.isCurrent(version)
      || isAbortError(error)
    ) {
      return
    }
    searchError.value = createVisibleError('地区搜索失败。', error)
  }
  finally {
    if (searchRequestVersion.isCurrent(version)) {
      searchLoading.value = false
      searchController.value = null
    }
  }
}

function retryPath(): void {
  void resolveCurrentPath()
}

function retryRoot(): void {
  void loadRoot(true)
}

function retryLazy(): void {
  const retry = lazyError.value
  if (!retry) {
    return
  }
  loadChildren(retry.option, retry.done)
}

function retrySearch(): void {
  void searchRegions()
}

function handleInputValueChange(value: string): void {
  inputValue.value = value
  cancelSearchRequest()
  searchError.value = null
  searchHasMore.value = false
  searchCompleted.value = false
  searchTree.value = []

  const normalizedQuery = normalizeRegionSearchText(value)
  lastSearchQuery.value = normalizedQuery
  if (normalizedQuery.length < 1 || props.readonly || props.disabled) {
    return
  }

  searchTimer = setTimeout(() => {
    searchTimer = undefined
    void searchRegions(normalizedQuery)
  }, REGION_SELECTOR_SEARCH_DELAY_MS)
}

function handlePopupVisibleChange(value: boolean): void {
  if (props.readonly || props.disabled) {
    popupVisible.value = false
    return
  }

  popupVisible.value = value
  if (value) {
    void loadRoot()
    return
  }

  handleInputValueChange('')
}

function filterOption(
  value: string,
  option: CascaderOption,
): boolean {
  const regionOption = asRegionOption(option)
  return regionOption ? filterRegionOption(value, regionOption) : false
}

function formatLabel(options: CascaderOption[]): string {
  const regionOptions = options
    .map(asRegionOption)
    .filter((option): option is RegionCascaderOption => option !== null)
  return formatRegionPathLabel(regionOptions)
}

/**
 * 历史回显通过 fallback 安全呈现，不把单条 resolved path 塞入普通 options。
 * 未完成或失败时只显示固定本地文案，绝不把未知 UUID 暴露给用户。
 */
function formatFallback(value: unknown): string {
  if (typeof value !== 'string' || value !== props.modelValue) {
    return ''
  }

  const tree = resolvedPathTree.value
  const country = tree[0]
  const province = country?.children?.[0]
  const city = province?.children?.[0]
  if (country && province && city) {
    return formatRegionPathLabel([country, province, city])
  }

  return pathError.value
    ? '已选地区无法回显'
    : '正在回显已选地区…'
}

function handleChange(value: unknown): void {
  // clear 只由 @clear / keyboard bridge 统一处理，避免 ACascader 同次交互双发 null。
  if (value === '' || value === undefined || value === null) {
    return
  }
  const selection = resolveRegionSelection(value, interactiveOptions.value)
  if (!selection) {
    return
  }

  if (selection.source === 'select') {
    inputValue.value = ''
    searchTree.value = []
    searchHasMore.value = false
    searchCompleted.value = false
    popupVisible.value = false
    emit('update:modelValue', selection.value)
    emit('change', selection)
  }
}

function handleClear(): void {
  if (
    clearLocked.value
    || props.readonly
    || props.disabled
  ) {
    return
  }

  // Arco clear 和局部 keyboard bridge 可能响应同一个 DOM 事件，按一个 microtask 去重。
  clearLocked.value = true
  queueMicrotask(() => {
    clearLocked.value = false
  })

  inputValue.value = ''
  resolvedPathTree.value = []
  searchTree.value = []
  searchHasMore.value = false
  searchCompleted.value = false
  pathError.value = null
  cancelPathRequest()
  emit('update:modelValue', null)
  emit('change', {
    source: 'clear',
    value: null,
    path: null,
  })
}

function handleInvalidation(): void {
  cancelPathRequest()
  cancelRootRequest()
  cancelSearchRequest()
  cancelLazyRequests()
  // ACascader 内部另存 lazyLoadOptions；仅清空外部 options 不足以移除旧 generation。
  cascaderGeneration.value += 1
  navigationTree.value = []
  resolvedPathTree.value = []
  searchTree.value = []
  rootLoaded.value = false
  searchCompleted.value = false
  pathError.value = null
  rootError.value = null
  lazyError.value = null
  searchError.value = null
  searchHasMore.value = false

  if (props.modelValue) {
    void resolveCurrentPath()
  }
  if (popupVisible.value) {
    void loadRoot()
  }
  if (normalizeRegionSearchText(inputValue.value).length > 0) {
    void searchRegions(inputValue.value)
  }
}

// 必须早于 immediate model watch，避免 setup→mounted 窗口漏掉身份/cache 失效通知。
unsubscribeInvalidation = provider?.subscribeInvalidation?.(
  handleInvalidation,
)

const controlBridge = createRegionSelectorControlBridge({
  onBlur: event => emit('blur', event),
  onClear: handleClear,
  onFocus: event => emit('focus', event),
})

function getClearControl(): HTMLElement | null {
  return selectorRoot.value?.querySelector<HTMLElement>(
    '.arco-select-view-clear-btn',
  ) ?? null
}

function updateControlBridge(): void {
  if (!bridgeMounted) {
    return
  }
  controlBridge.update({
    attrs,
    busy: busy.value,
    clearControl: getClearControl(),
    describedBy: describedBy.value,
    expanded: popupVisible.value,
    // root/lazy/search 属于可恢复加载错误，不应把已有表单值标记为 invalid。
    invalid: props.error || pathError.value !== null,
    // required/FormData 只承认已通过完整三级树校验的 CITY，不信任任意非空字符串。
    hasValidCitySelection: verifiedCityValue.value !== null,
    modelValue: props.modelValue ?? null,
    readonly: props.readonly,
    root: selectorRoot.value,
  })
}

function focus(): void {
  controlBridge.focus()
}

function blur(): void {
  controlBridge.blur()
}

defineExpose({
  focus,
  blur,
})

watch(
  () => props.modelValue,
  (value) => {
    if (value === null) {
      cancelPathRequest()
      resolvedPathTree.value = []
      pathError.value = null
      return
    }
    void resolveCurrentPath(value)
  },
  { immediate: true },
)

watch(
  [() => props.readonly, () => props.disabled],
  ([readonly, disabled]) => {
    if (readonly || disabled) {
      popupVisible.value = false
      handleInputValueChange('')
    }
  },
)

watchPostEffect(updateControlBridge)
// `useAttrs()` 始终指向最新值但不是可 watch 的响应式对象；attrs-only 更新由此兜底。
onUpdated(updateControlBridge)

onMounted(() => {
  bridgeMounted = true
  updateControlBridge()
})

onBeforeUnmount(() => {
  bridgeMounted = false
  unsubscribeInvalidation?.()
  unsubscribeInvalidation = undefined
  cancelPathRequest()
  cancelRootRequest()
  cancelSearchRequest()
  cancelLazyRequests()
  controlBridge.dispose()
})
</script>

<template>
  <div
    v-bind="getWrapperAttrs()"
    ref="selectorRoot"
    data-slot="qs-region-selector"
    class="qs-region-selector min-w-0 w-full"
  >
    <ACascader
      :key="cascaderGeneration"
      class="qs-region-selector__control min-w-0 w-full"
      :model-value="modelValue ?? ''"
      :options="interactiveOptions"
      :multiple="false"
      :path-mode="false"
      :check-strictly="false"
      expand-trigger="click"
      :allow-search="!readonly"
      :allow-clear="clearable && !readonly"
      :search-option-only-label="false"
      :search-delay="REGION_SELECTOR_SEARCH_DELAY_MS"
      :fallback="formatFallback"
      :input-value="inputValue"
      :popup-visible="popupVisible"
      :load-more="loadChildren"
      :filter-option="filterOption"
      :format-label="formatLabel"
      :trigger-props="triggerProps"
      :popup-container="popupContainer"
      :placeholder="placeholder"
      :disabled="disabled"
      :error="error || visibleError !== null"
      :loading="busy"
      @input-value-change="handleInputValueChange"
      @popup-visible-change="handlePopupVisibleChange"
      @change="handleChange"
      @clear="handleClear"
    >
      <template #empty>
        <div
          data-slot="qs-region-selector-empty"
          class="text-sm text-muted-foreground px-4 py-5 text-center"
          role="status"
          aria-live="polite"
        >
          <span v-if="rootLoading || searchLoading">正在加载地区…</span>
          <span v-else-if="rootError || searchError">
            地区数据暂不可用，请使用选择框下方的重试操作。
          </span>
          <span
            v-else-if="
              normalizeRegionSearchText(inputValue).length > 0
                && searchCompleted
            "
          >
            未找到匹配的城市。
          </span>
          <span v-else-if="rootLoaded && navigationTree.length === 0">
            暂无可选地区。
          </span>
          <span v-else>暂无可选地区。</span>
        </div>
      </template>
    </ACascader>

    <p
      v-if="busy"
      :id="loadingStatusId"
      data-slot="qs-region-selector-loading"
      class="text-xs text-muted-foreground m-0 mt-1.5"
      role="status"
      aria-live="polite"
    >
      {{
        pathLoading
          ? '正在加载已选地区…'
          : searchLoading
            ? '正在搜索地区…'
            : '正在加载地区…'
      }}
    </p>

    <div
      v-if="visibleError"
      :id="errorStatusId"
      data-slot="qs-region-selector-error"
      class="text-xs text-destructive mt-1.5 flex flex-wrap gap-x-2 gap-y-1 items-center"
      role="alert"
    >
      <span>{{ visibleError.message }}</span>
      <code
        v-if="visibleError.requestId"
        class="qs-type-data-mono break-all"
      >
        requestId: {{ visibleError.requestId }}
      </code>
      <button
        v-if="pathError"
        type="button"
        class="qs-region-selector__retry"
        @click="retryPath"
      >
        重试回显
      </button>
      <button
        v-else-if="rootError"
        type="button"
        class="qs-region-selector__retry"
        @click="retryRoot"
      >
        重试加载
      </button>
      <button
        v-else-if="lazyError"
        type="button"
        class="qs-region-selector__retry"
        @click="retryLazy"
      >
        重试加载
      </button>
      <button
        v-else-if="searchError"
        type="button"
        class="qs-region-selector__retry"
        @click="retrySearch"
      >
        重试搜索
      </button>
    </div>

    <div
      v-if="
        stoppedPath
          || readonly
          || disabled
          || searchHasMore
      "
      :id="stateStatusId"
      data-slot="qs-region-selector-state"
      class="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-2 gap-y-1"
      role="status"
      aria-live="polite"
    >
      <span v-if="stoppedPath">当前历史地区已停用，仅供回显。</span>
      <span v-if="readonly">只读</span>
      <span v-if="disabled">已禁用</span>
      <span v-if="searchHasMore">
        结果较多，请继续输入以缩小范围。
      </span>
    </div>
  </div>
</template>

<style scoped>
.qs-region-selector__control {
  width: 100%;
  min-width: 0;
}

.qs-region-selector__control :deep(.arco-select-view) {
  width: 100%;
  min-width: 0;
}

/*
 * Arco 默认同时用 display:none 与 visibility:hidden 隐藏 clear control，键盘用户
 * 即使获得 tabindex 也无法 Tab 到达。已选值本就需要公开清空能力，因此以包含
 * single view 的局部高优先级选择器覆盖；未选择时 Arco 不渲染该节点。
 */
.qs-region-selector :deep(.arco-select-view-single .arco-select-view-clear-btn) {
  display: inline-flex;
  visibility: visible;
}

.qs-region-selector :deep(.arco-select-view-single .arco-select-view-clear-btn ~ *) {
  display: none;
}

.qs-region-selector__retry {
  min-height: 28px;
  padding: 0 0.625rem;
  color: oklch(var(--foreground));
  cursor: pointer;
  background: oklch(var(--background));
  border: 1px solid oklch(var(--border));
  border-radius: var(--radius);
}

.qs-region-selector__retry:hover {
  background: oklch(var(--muted));
}

.qs-region-selector__retry:focus-visible {
  outline: 2px solid oklch(var(--ring));
  outline-offset: 2px;
}

:global(.qs-region-selector-popup) {
  max-width: calc(100vw - 24px);
}

:global(.qs-region-selector-popup .arco-cascader-panel) {
  max-width: calc(100vw - 24px);
  max-height: min(18rem, calc(100dvh - 6rem));
  overflow: auto hidden;
}

:global(.qs-region-selector-popup .arco-cascader-panel-column) {
  min-width: 120px;
  max-height: min(18rem, calc(100dvh - 6rem));
}

:global(.qs-region-selector-popup .arco-cascader-column-content),
:global(.qs-region-selector-popup .arco-cascader-search-panel) {
  max-height: min(18rem, calc(100dvh - 6rem));
  overflow-y: auto;
}

@media (width <= 640px) {
  .qs-region-selector__control :deep(.arco-select-view-single),
  .qs-region-selector__retry,
  :global(.qs-region-selector-popup .arco-cascader-option) {
    min-height: 44px;
  }

  .qs-region-selector__control :deep(.arco-select-view-clear-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
  }

  :global(.qs-region-selector-popup .arco-cascader-panel-column) {
    min-width: min(12rem, calc(100vw - 24px));
  }
}

@media (prefers-reduced-motion: reduce) {
  :global(.qs-region-selector-popup *),
  .qs-region-selector__retry {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
</style>
