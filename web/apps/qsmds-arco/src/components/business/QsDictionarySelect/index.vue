<script setup lang="ts">
import { FaCombobox, FaIcon } from '@fantastic-admin/components'
import {
  computed,
  nextTick,
  onBeforeUpdate,
  ref,
  shallowRef,
  useAttrs,
  useId,
  useTemplateRef,
  watch,
} from 'vue'
import { useDictionaryCatalog } from '../../../dictionary-catalog/use-dictionary-catalog'
import { normalizeDictionaryCatalogCode } from '../../../dictionary-catalog/validation'
import {
  buildDictionarySelectFormProxies,
  buildDictionarySelectInputAttrs,
  buildDictionarySelectInteractionKey,
  buildDictionarySelectOptions,
  filterDictionarySelectOption,
  fromDictionarySelectInnerValue,
  splitDictionarySelectAttrs,
  toDictionarySelectInnerValue,
} from './logic'

export interface QsDictionarySelectProps {
  dictionaryCode: string
  modelValue?: string | null
  placeholder?: string
  clearable?: boolean
  disabled?: boolean
}

export interface QsDictionarySelectEmits {
  'update:modelValue': [value: string | null]
  'focus': [event: FocusEvent]
  'blur': [event: FocusEvent]
}

export interface QsDictionarySelectExpose {
  focus: () => void
  blur: () => void
}

interface FaComboboxExpose {
  focus: () => void
  blur: () => void
}

defineOptions({
  name: 'QsDictionarySelect',
  inheritAttrs: false,
})

const props = withDefaults(defineProps<QsDictionarySelectProps>(), {
  modelValue: null,
  placeholder: '请选择',
  clearable: false,
  disabled: false,
})

const emit = defineEmits<QsDictionarySelectEmits>()
const attrs = useAttrs()
const attrsSnapshot = shallowRef({ ...attrs })
// useAttrs() 始终指向最新值但不能直接被 watch；更新前复制一次以驱动纯分组 computed。
onBeforeUpdate(() => {
  attrsSnapshot.value = { ...attrs }
})
const catalog = useDictionaryCatalog(() => props.dictionaryCode)
const comboboxRef = useTemplateRef<FaComboboxExpose>('comboboxRef')
const rootRef = useTemplateRef<HTMLElement>('rootRef')
const unavailableStatusRef = useTemplateRef<HTMLElement>(
  'unavailableStatusRef',
)
const retryRef = useTemplateRef<HTMLButtonElement>('retryRef')
const localNativeInvalid = ref(false)

const idPrefix = `qs-dictionary-select-${useId().replaceAll(':', '')}`
const loadingStatusId = `${idPrefix}-loading`
const emptyStatusId = `${idPrefix}-empty`
const missingStatusId = `${idPrefix}-missing`
const errorStatusId = `${idPrefix}-error`
const invalidStatusId = `${idPrefix}-invalid`
const requiredStatusId = `${idPrefix}-required`

const attrGroups = computed(() => (
  splitDictionarySelectAttrs(attrsSnapshot.value)
))
const formProxies = computed(() => buildDictionarySelectFormProxies({
  callerDisabled: props.disabled,
  formAttrs: attrGroups.value.formAttrs,
  inputAttrs: attrGroups.value.inputAttrs,
  modelValue: props.modelValue,
}))

/*
 * 交互 session 只认 Catalog 的规范 code。调用方仅改变大小写或边缘空白时
 * key 不变；切换到另一个规范 code 或 invalid 状态时，FaCombobox 会重建，
 * 从而关闭旧 Popover、清空旧搜索，但绝不写回外部 modelValue。
 */
const normalizedDictionaryCode = computed<string | null>(() => {
  try {
    return normalizeDictionaryCatalogCode(props.dictionaryCode)
  }
  catch {
    return null
  }
})
const interactionSessionEpoch = ref(0)
watch(
  normalizedDictionaryCode,
  (nextCode, previousCode) => {
    if (nextCode !== previousCode) {
      interactionSessionEpoch.value += 1
    }
  },
  { flush: 'sync' },
)
/*
 * FaCombobox 会把当前显示文本保存在内部搜索值中。加载阶段先以 raw 回显，
 * Catalog 可信后必须重建一次，才能把同一 value 刷新为 ACTIVE/DISABLED/UNKNOWN
 * Label；失效与 retry 本就进入 fail-closed，因此该阶段切换也应关闭旧 Popover。
 */
const interactionDisplayPhase = computed(() => (
  !catalog.loading.value && catalog.catalog.value !== null
    ? 'trusted'
    : 'raw'
))
const interactionSessionKey = computed(() => (
  buildDictionarySelectInteractionKey(
    interactionSessionEpoch.value,
    interactionDisplayPhase.value,
  )
))

const options = computed(() => buildDictionarySelectOptions({
  catalog: catalog.catalog.value,
  currentValue: props.modelValue,
  loading: catalog.loading.value,
  selectableItems: catalog.selectableItems.value,
}))
const innerValue = computed(() => toDictionarySelectInnerValue(props.modelValue))
const catalogEmpty = computed(() => (
  !catalog.invalid.value
  && !catalog.loading.value
  && catalog.error.value === null
  && !catalog.missing.value
  && catalog.catalog.value !== null
  && catalog.selectableItems.value.length === 0
))
const interactionUnavailable = computed(() => (
  props.disabled
  || catalog.invalid.value
  || catalog.loading.value
  || catalog.error.value !== null
  || catalog.missing.value
  || catalog.catalog.value === null
))
const comboboxEmptyText = computed(() => (
  catalogEmpty.value
    ? '暂无可用选项'
    : '无匹配选项'
))

const activeStateDescriptionId = computed<string | undefined>(() => {
  if (catalog.invalid.value) {
    return invalidStatusId
  }
  if (catalog.loading.value) {
    return loadingStatusId
  }
  if (catalog.error.value !== null) {
    return errorStatusId
  }
  if (catalog.missing.value) {
    return missingStatusId
  }
  if (catalogEmpty.value) {
    return emptyStatusId
  }
  return undefined
})
const hasVisibleState = computed(() => (
  activeStateDescriptionId.value !== undefined || localNativeInvalid.value
))

/*
 * 内部状态只能提高 ARIA 严格度：loading 的 busy 和配置/加载/原生验证错误
 * 均优先于调用方冲突值；状态恢复后则自动还原 caller/FaForm 注入的原值。
 */
const mergedInputAttrs = computed(() => {
  const callerInputAttrs = attrGroups.value.inputAttrs
  const internallyInvalid = catalog.invalid.value
    || catalog.error.value !== null
    || localNativeInvalid.value

  return buildDictionarySelectInputAttrs({
    callerInputAttrs,
    describedBy: [
      activeStateDescriptionId.value,
      localNativeInvalid.value ? requiredStatusId : undefined,
    ],
    effectiveAriaRequired: formProxies.value.effectiveAriaRequired,
    internallyInvalid,
    loading: catalog.loading.value,
  })
})

function handleInnerValueUpdate(value: unknown): void {
  const nextValue = fromDictionarySelectInnerValue(value)
  emit('update:modelValue', nextValue)
}

function handleInputFocus(event: FocusEvent): void {
  emit('focus', event)
}

function handleInputBlur(event: FocusEvent): void {
  emit('blur', event)
}

/**
 * 可交互时聚焦真实搜索 input；内部 unavailable 时聚焦相邻状态或 retry。
 * caller disabled 是完整禁用语义，公开 focus() 必须安全 no-op。
 */
function focus(): void {
  if (props.disabled) {
    return
  }
  if (catalog.error.value !== null) {
    retryRef.value?.focus()
    return
  }
  if (interactionUnavailable.value) {
    unavailableStatusRef.value?.focus()
    return
  }
  comboboxRef.value?.focus()
}

/** 同时覆盖正常 input 与 unavailable 状态下可能获得焦点的本地节点。 */
function blur(): void {
  comboboxRef.value?.blur()
  retryRef.value?.blur()
  unavailableStatusRef.value?.blur()
  rootRef.value?.blur()
}

function handleRootFocus(event: FocusEvent): void {
  // 只转发 root 自身的程序化焦点；子 input 的 focus 不会再次触发公开事件。
  if (event.target === event.currentTarget) {
    focus()
  }
}

function handleNativeInvalid(event: Event): void {
  event.preventDefault()
  if (props.disabled) {
    return
  }
  localNativeInvalid.value = true
  // 错误说明需要先进入 DOM，再把浏览器对隐藏代理的焦点恢复到可见控件。
  void nextTick(() => focus())
}

function retry(): void {
  if (!props.disabled && catalog.error.value !== null) {
    void catalog.retry()
  }
}

watch(
  [
    () => props.modelValue,
    () => formProxies.value.nativeRequired,
    () => props.disabled,
  ],
  ([value, nativeRequired, disabled]) => {
    if (value !== null || !nativeRequired || disabled) {
      localNativeInvalid.value = false
    }
  },
)

defineExpose({
  blur,
  focus,
})
</script>

<template>
  <div
    v-bind="attrGroups.rootAttrs"
    ref="rootRef"
    class="qs-dictionary-select min-w-0 w-full"
    tabindex="-1"
    @focus="handleRootFocus"
  >
    <FaCombobox
      :key="interactionSessionKey"
      ref="comboboxRef"
      :model-value="innerValue"
      :options="options"
      :placeholder="placeholder"
      :clearable="clearable"
      :disabled="interactionUnavailable"
      :filter="filterDictionarySelectOption"
      :empty-text="comboboxEmptyText"
      :input-attrs="mergedInputAttrs"
      class="qs-dictionary-select__control w-full"
      content-class="qs-dictionary-select__content"
      clear-aria-label="清空字典选择"
      trigger-aria-label="展开或收起字典选项"
      @update:model-value="handleInnerValueUpdate"
      @focus="handleInputFocus"
      @blur="handleInputBlur"
    />

    <!-- 搜索 input 永不携带业务 name；只有精确 raw value 进入 FormData。 -->
    <input
      v-if="formProxies.submissionProxy"
      v-bind="formProxies.submissionProxy"
      data-qs-dictionary-submission-proxy
    >

    <!--
      required 代理只验证 null。空字符串是合法的历史 raw，使用 present sentinel；
      无 name 可保证该内部值永远不会进入 FormData。
    -->
    <input
      v-if="formProxies.validationProxy"
      v-bind="formProxies.validationProxy"
      class="qs-dictionary-select__validation-proxy"
      data-qs-dictionary-validation-proxy
      @invalid="handleNativeInvalid"
    >

    <div
      v-if="hasVisibleState"
      class="qs-dictionary-select__state-row text-xs mt-1.5"
    >
      <div
        v-if="catalog.invalid.value"
        :id="invalidStatusId"
        ref="unavailableStatusRef"
        class="text-destructive"
        role="alert"
        tabindex="-1"
      >
        字典编码配置无效
      </div>

      <div
        v-else-if="catalog.loading.value"
        :id="loadingStatusId"
        ref="unavailableStatusRef"
        class="text-muted-foreground inline-flex gap-1.5 items-center"
        role="status"
        aria-live="polite"
        tabindex="-1"
      >
        <FaIcon
          aria-hidden="true"
          class="qs-dictionary-select__loader size-3.5 animate-spin"
          name="i-lucide:loader-circle"
        />
        <span>正在加载字典选项</span>
      </div>

      <div
        v-else-if="catalog.error.value !== null"
        :id="errorStatusId"
        ref="unavailableStatusRef"
        class="text-destructive flex flex-wrap gap-x-2 gap-y-1 items-center"
        role="alert"
        tabindex="-1"
      >
        <span>{{ catalog.error.value }}</span>
        <button
          ref="retryRef"
          :disabled="disabled"
          aria-label="重试加载字典选项"
          class="qs-dictionary-select__retry"
          type="button"
          @click="retry"
        >
          重试加载
        </button>
      </div>

      <div
        v-else-if="catalog.missing.value"
        :id="missingStatusId"
        ref="unavailableStatusRef"
        class="text-muted-foreground"
        tabindex="-1"
      >
        未配置该字典类型
      </div>

      <div
        v-else-if="catalogEmpty"
        :id="emptyStatusId"
        class="text-muted-foreground"
      >
        暂无可用选项
      </div>

      <div
        v-if="localNativeInvalid"
        :id="requiredStatusId"
        class="text-destructive"
        role="alert"
      >
        请选择字典选项
      </div>
    </div>
  </div>
</template>

<style scoped>
.qs-dictionary-select :deep([data-slot="combobox"]) {
  display: block;
  width: 100%;
  min-width: 0;
}

/*
 * input 与右侧操作按钮的横向排列由 FaCombobox 统一负责；领域组件只约束尺寸，
 * 不能覆盖 control 的 display，否则 flex 子项会退回普通文档流并发生换行。
 */
.qs-dictionary-select :deep(.qs-dictionary-select__control) {
  width: 100%;
  min-width: 0;
  height: 36px;
}

/*
 * Popover 会 Teleport 到 body，只有公共 contentClass 能提供稳定 ownership。
 * 唯一 BEM 类确保长文本与动效约束不会泄漏到其他 FaCombobox 实例。
 */
:global(.qs-dictionary-select__content) {
  max-width: calc(100vw - 1.5rem);
}

:global(.qs-dictionary-select__content [data-slot="combobox-item"]) {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

.qs-dictionary-select__validation-proxy {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  white-space: nowrap;
  border: 0;
  clip-path: inset(50%);
}

.qs-dictionary-select__retry {
  min-height: 28px;
  padding: 0 0.625rem;
  color: oklch(var(--foreground));
  cursor: pointer;
  background: transparent;
  border: 1px solid oklch(var(--border));
  border-radius: var(--radius);
}

.qs-dictionary-select__retry:hover {
  background: oklch(var(--muted));
}

.qs-dictionary-select__retry:focus-visible,
.qs-dictionary-select [tabindex="-1"]:focus-visible {
  outline: 2px solid oklch(var(--ring));
  outline-offset: 2px;
}

.qs-dictionary-select__retry:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (width <= 640px) {
  .qs-dictionary-select :deep(.qs-dictionary-select__control) {
    box-sizing: border-box;
    height: auto;
    min-height: 44px;
    padding-block: 0;
  }

  /* 触控尺寸必须落到真实 input，而不是只放大外层视觉容器。 */
  .qs-dictionary-select :deep([data-slot="combobox-input"]),
  .qs-dictionary-select :deep([data-slot="combobox-clear"]),
  .qs-dictionary-select :deep([data-slot="combobox-trigger"]),
  .qs-dictionary-select__retry {
    min-height: 44px;
  }

  .qs-dictionary-select :deep([data-slot="combobox-input"]) {
    height: 44px;
  }

  .qs-dictionary-select :deep([data-slot="combobox-clear"]),
  .qs-dictionary-select :deep([data-slot="combobox-trigger"]) {
    min-width: 44px;
  }

  :global(.qs-dictionary-select__content [data-slot="combobox-item"]) {
    min-height: 44px;
    padding-block: 0.625rem;
    line-height: 1.25rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .qs-dictionary-select__loader,
  .qs-dictionary-select__retry,
  .qs-dictionary-select :deep(.qs-dictionary-select__control) {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }

  :global(.qs-dictionary-select__content),
  :global(.qs-dictionary-select__content *) {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
</style>
