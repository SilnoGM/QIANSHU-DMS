<script setup lang="ts">
import type {
  ComboboxGroupOption,
  ComboboxOption,
  FormExpose,
} from '@fantastic-admin/components'
import { FaCombobox } from '@fantastic-admin/components'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
import { dictionaryCatalogProviderKey } from '@/dictionary-catalog/injection'
import {
  createDictionarySelectFixtureController,
  DICTIONARY_SELECT_FIXTURE_CODES,
  DICTIONARY_SELECT_FIXTURE_VALUES,
} from '../fixtures/dictionary-select.fixture'

defineOptions({ name: 'DictionarySelectShowcase' })

const fixtureController = createDictionarySelectFixtureController()
provide(dictionaryCatalogProviderKey, fixtureController.provider)

const standardValue = ref<string | null>(null)
const standardUpdateCount = ref(0)
const standardLastUpdate = ref('尚未回写')
const disabledHistoryValue = ref<string | null>(
  DICTIONARY_SELECT_FIXTURE_VALUES.archived,
)
const unknownHistoryValue = ref<string | null>(
  DICTIONARY_SELECT_FIXTURE_VALUES.unknownHistory,
)
const duplicateLabelValue = ref<string | null>(null)
const emptyValue = ref<string | null>(null)
const missingValue = ref<string | null>(null)
const invalidValue = ref<string | null>(null)
const retryValue = ref<string | null>(null)
const disabledValue = ref<string | null>(
  DICTIONARY_SELECT_FIXTURE_VALUES.running,
)
const codeSwitchValue = ref<string | null>(
  DICTIONARY_SELECT_FIXTURE_VALUES.phaseAlpha,
)
const codeSwitchCode = ref<string>(DICTIONARY_SELECT_FIXTURE_CODES.phase)
const nativeFormValue = ref<string | null>(null)
const nativeFormDisabled = ref(false)
const nativeFormRef = useTemplateRef<HTMLFormElement>('nativeFormRef')
const nativeFormSnapshot = ref('尚未提交')
const faFormModel = reactive({ status: null as string | null })
const faFormRef = useTemplateRef<FormExpose>('faFormRef')
const faFormSnapshot = ref('尚未提交')
const focusSummary = ref('等待焦点事件')

const faFormValidationSchema = {
  status(value: unknown) {
    return typeof value === 'string' ? true : '请选择表单状态'
  },
}

const primitiveOptions: ComboboxOption[] = [
  { label: '字符串 1', value: '1' },
  { label: '数字 1', value: 1 },
  { label: '大整数 1', value: 1n },
  { label: '空值 null', value: null },
]
const primitiveValue = shallowRef<ComboboxOption['value']>()
const primitiveEvents = reactive({ blur: 0, change: 0, clear: 0, focus: 0 })
const primitiveValueSummary = computed(() => {
  if (primitiveValue.value === undefined) {
    return 'undefined'
  }
  if (primitiveValue.value === null) {
    return 'null'
  }
  return `${typeof primitiveValue.value}:${String(primitiveValue.value)}`
})
const primitiveEventSummary = computed(() => (
  `change=${primitiveEvents.change};clear=${primitiveEvents.clear};focus=${primitiveEvents.focus};blur=${primitiveEvents.blur}`
))

const groupedOptions: ComboboxGroupOption[] = [
  {
    label: '首选分组',
    options: [
      { disabled: true, label: '跳过禁用', value: 'GROUP_DISABLED' },
      { label: '跳过禁用', value: 'GROUP_ENABLED' },
    ],
  },
  {
    label: '备用分组',
    options: [
      { label: '备用 Alpha', value: 'GROUP_ALPHA' },
      { label: '备用 Beta', value: 'GROUP_BETA' },
    ],
  },
]
const groupedValue = shallowRef<ComboboxOption['value']>()
const groupedValueSummary = computed(() => (
  groupedValue.value === undefined ? 'undefined' : String(groupedValue.value)
))

const virtualListOptions: ComboboxOption[] = Array.from(
  { length: 100 },
  (_, index) => {
    const ordinal = String(index + 1).padStart(3, '0')
    return {
      label: `虚拟条目 ${ordinal}`,
      value: `VIRTUAL_${ordinal}`,
    }
  },
)
const virtualValue = shallowRef<ComboboxOption['value']>()
const virtualValueSummary = computed(() => (
  virtualValue.value === undefined ? 'undefined' : String(virtualValue.value)
))

const FIRST_OBJECT_VALUE = Object.freeze({ id: 'object-a', lane: 'north' })
const SECOND_OBJECT_VALUE = Object.freeze({ id: 'object-b', lane: 'south' })
const sameObjectLabelOptions: ComboboxOption[] = [
  { label: '相同显示名', value: FIRST_OBJECT_VALUE },
  { label: '相同显示名', value: SECOND_OBJECT_VALUE },
]
const objectValue = shallowRef<
  | typeof FIRST_OBJECT_VALUE
  | typeof SECOND_OBJECT_VALUE
  | undefined
>()
const objectValueSummary = computed(() => {
  if (objectValue.value === FIRST_OBJECT_VALUE) {
    return 'object-a · north'
  }
  if (objectValue.value === SECOND_OBJECT_VALUE) {
    return 'object-b · south'
  }
  return 'undefined'
})

function captureNativeForm(): void {
  const form = nativeFormRef.value
  if (form === null) {
    return
  }
  nativeFormSnapshot.value = JSON.stringify(
    [...new FormData(form).entries()],
  )
}

function handleFaFormSubmit(): void {
  faFormSnapshot.value = JSON.stringify(faFormModel)
}

function handleStandardUpdate(value: string | null): void {
  standardUpdateCount.value += 1
  standardLastUpdate.value = value === null ? 'null' : value
  standardValue.value = value
}

function setExternalValue(value: string | null): void {
  standardValue.value = value
}

function switchToStatusCode(): void {
  codeSwitchCode.value = DICTIONARY_SELECT_FIXTURE_CODES.status
  codeSwitchValue.value = DICTIONARY_SELECT_FIXTURE_VALUES.waiting
}

function switchToEquivalentStatusCode(): void {
  codeSwitchCode.value = ' WORKFLOW.STATUS '
}

function switchToInvalidCode(): void {
  codeSwitchCode.value = 'invalid-code'
}

function recoverStatusCode(): void {
  switchToStatusCode()
}

function releasePendingPhase(): void {
  fixtureController.releasePendingPhase()
}

function handleFocus(): void {
  focusSummary.value = 'focus'
}

function handleBlur(): void {
  focusSummary.value = 'blur'
}

function setNativeFormValue(value: string | null): void {
  nativeFormValue.value = value
}

function toggleNativeFormDisabled(): void {
  nativeFormDisabled.value = !nativeFormDisabled.value
}

function focusFaFormField(): void {
  faFormRef.value?.scrollToField('status')
}

function handlePrimitiveChange(): void {
  primitiveEvents.change += 1
}

function handlePrimitiveClear(): void {
  primitiveEvents.clear += 1
}

function handlePrimitiveFocus(): void {
  primitiveEvents.focus += 1
}

function handlePrimitiveBlur(): void {
  primitiveEvents.blur += 1
}
</script>

<template>
  <section
    aria-labelledby="dictionary-select-showcase-title"
    data-testid="dictionary-select-showcase"
  >
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:list-filter" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">稳定 value 单选</span>
          </div>
          <h3
            id="dictionary-select-showcase-title"
            class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl"
          >
            字典目录交互状态
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            全部场景由中性内存 Provider 驱动，不读取或修改真实字典；每个字段继续使用正式 QsDictionarySelect。
          </p>
        </div>
        <FaTag variant="secondary">
          QsDictionarySelect
        </FaTag>
      </div>

      <p class="text-sm text-muted-foreground mb-0 mt-5 sm:hidden" role="status">
        当前为窄屏验收状态：真实输入、图标按钮与候选项触控目标均不小于 44px。
      </p>

      <div class="mt-6 gap-5 grid lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
        <article class="p-4 border border-border rounded-lg bg-muted/20 sm:p-5">
          <div class="flex flex-wrap gap-3 items-start justify-between">
            <div>
              <h4 class="qs-type-compact-title m-0">
                默认、搜索与清空
              </h4>
              <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                搜索同时匹配 Label 和 value；外部更新不伪造一次组件回写。
              </p>
            </div>
            <FaTag variant="outline">
              可交互
            </FaTag>
          </div>
          <label
            for="dictionary-select-showcase-standard"
            class="qs-type-compact-label mb-2 mt-5 block"
          >
            工作流状态
          </label>
          <QsDictionarySelect
            id="dictionary-select-showcase-standard"
            :model-value="standardValue"
            data-testid="dictionary-select-standard"
            :dictionary-code="DICTIONARY_SELECT_FIXTURE_CODES.status"
            clearable
            @update:model-value="handleStandardUpdate"
            @focus="handleFocus"
            @blur="handleBlur"
          />
          <div class="mt-4 flex flex-wrap gap-2">
            <button
              class="dictionary-showcase-button"
              type="button"
              @click="setExternalValue(DICTIONARY_SELECT_FIXTURE_VALUES.runningAlternate)"
            >
              外部设为第二个“处理中”
            </button>
            <button
              class="dictionary-showcase-button"
              type="button"
              @click="setExternalValue(null)"
            >
              外部清空
            </button>
          </div>
        </article>

        <aside class="p-4 border border-border rounded-lg bg-background sm:p-5">
          <span class="qs-type-compact-label text-muted-foreground">当前受控结果</span>
          <dl class="text-sm m-0 mt-4 gap-3 grid">
            <div class="flex gap-4 items-start justify-between">
              <dt class="text-muted-foreground">
                modelValue
              </dt>
              <dd class="qs-type-data-mono m-0 text-end break-all" data-testid="dictionary-select-standard-value">
                {{ standardValue === null ? 'null' : standardValue }}
              </dd>
            </div>
            <div class="pt-3 border-t border-border flex gap-4 items-start justify-between">
              <dt class="text-muted-foreground">
                update count
              </dt>
              <dd class="qs-type-data-mono m-0 text-end" data-testid="dictionary-select-standard-update-count">
                {{ standardUpdateCount }}
              </dd>
            </div>
            <div class="pt-3 border-t border-border flex gap-4 items-start justify-between">
              <dt class="text-muted-foreground">
                last update
              </dt>
              <dd class="qs-type-data-mono m-0 text-end break-all" data-testid="dictionary-select-standard-last-update">
                {{ standardLastUpdate }}
              </dd>
            </div>
            <div class="pt-3 border-t border-border flex gap-4 items-start justify-between">
              <dt class="text-muted-foreground">
                focus / blur
              </dt>
              <dd class="font-medium m-0 text-end" data-testid="dictionary-select-focus-summary">
                {{ focusSummary }}
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <div class="mt-5 gap-4 grid md:grid-cols-2">
        <article class="dictionary-showcase-card">
          <h4 class="qs-type-compact-title m-0">
            已停用历史值
          </h4>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            保留 Label 与 raw value，合成项不可作为新选择再次选中。
          </p>
          <QsDictionarySelect
            v-model="disabledHistoryValue"
            class="mt-4"
            data-testid="dictionary-select-history-disabled"
            :dictionary-code="DICTIONARY_SELECT_FIXTURE_CODES.status"
            clearable
            aria-label="已停用历史状态"
          />
        </article>

        <article class="dictionary-showcase-card">
          <h4 class="qs-type-compact-title m-0">
            未知历史值
          </h4>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            可信目录中未命中的 raw 仍可见、可提交，也可由用户明确清除。
          </p>
          <QsDictionarySelect
            v-model="unknownHistoryValue"
            class="mt-4"
            data-testid="dictionary-select-history-unknown"
            :dictionary-code="DICTIONARY_SELECT_FIXTURE_CODES.status"
            clearable
            aria-label="未知历史状态"
          />
        </article>

        <article class="dictionary-showcase-card">
          <h4 class="qs-type-compact-title m-0">
            重复 Label
          </h4>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            两个“处理中”拥有不同 value，搜索与选择始终按 value 区分。
          </p>
          <QsDictionarySelect
            v-model="duplicateLabelValue"
            class="mt-4"
            data-testid="dictionary-select-duplicate-label"
            :dictionary-code="DICTIONARY_SELECT_FIXTURE_CODES.status"
            aria-label="重复标签状态"
          />
          <output class="qs-type-data-mono text-xs mt-3 block break-all" data-testid="dictionary-select-duplicate-value">
            {{ duplicateLabelValue === null ? 'null' : duplicateLabelValue }}
          </output>
        </article>

        <article class="dictionary-showcase-card">
          <h4 class="qs-type-compact-title m-0">
            caller disabled
          </h4>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            当前值继续可读，但 input、展开、清空、重试和表单代理全部禁用。
          </p>
          <QsDictionarySelect
            v-model="disabledValue"
            class="mt-4"
            data-testid="dictionary-select-disabled"
            :dictionary-code="DICTIONARY_SELECT_FIXTURE_CODES.status"
            disabled
            aria-label="禁用状态"
          />
        </article>
      </div>

      <div class="mt-5 gap-4 grid lg:grid-cols-4 sm:grid-cols-2">
        <article class="dictionary-showcase-card">
          <h4 class="qs-type-compact-title m-0">
            空 Catalog
          </h4>
          <QsDictionarySelect
            v-model="emptyValue"
            class="mt-4"
            data-testid="dictionary-select-empty"
            :dictionary-code="DICTIONARY_SELECT_FIXTURE_CODES.empty"
            aria-label="空字典状态"
          />
        </article>

        <article class="dictionary-showcase-card">
          <h4 class="qs-type-compact-title m-0">
            missing
          </h4>
          <QsDictionarySelect
            v-model="missingValue"
            class="mt-4"
            data-testid="dictionary-select-missing"
            :dictionary-code="DICTIONARY_SELECT_FIXTURE_CODES.missing"
            aria-label="缺失字典状态"
          />
        </article>

        <article class="dictionary-showcase-card">
          <h4 class="qs-type-compact-title m-0">
            invalid
          </h4>
          <QsDictionarySelect
            v-model="invalidValue"
            class="mt-4"
            data-testid="dictionary-select-invalid"
            dictionary-code="invalid-code"
            aria-label="无效字典编码"
          />
        </article>

        <article class="dictionary-showcase-card">
          <h4 class="qs-type-compact-title m-0">
            首错后重试
          </h4>
          <QsDictionarySelect
            v-model="retryValue"
            class="mt-4"
            data-testid="dictionary-select-retry"
            :dictionary-code="DICTIONARY_SELECT_FIXTURE_CODES.retry"
            aria-label="错误重试状态"
          />
        </article>
      </div>

      <article class="dictionary-showcase-card mt-5 bg-muted/20">
        <div class="gap-5 grid lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.9fr)] lg:items-end">
          <div>
            <h4 class="qs-type-compact-title m-0">
              code 切换与迟到响应
            </h4>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              首个 phase 请求由按钮延迟释放；切换 code 后旧结果不得覆盖当前状态。同一规范 code 只改变大小写与空白，不重建交互。
            </p>
            <div class="mt-4 flex flex-wrap gap-2">
              <button class="dictionary-showcase-button" type="button" @click="switchToStatusCode">
                切换到 status
              </button>
              <button class="dictionary-showcase-button" type="button" @click="switchToEquivalentStatusCode">
                改为等价 code
              </button>
              <button class="dictionary-showcase-button" type="button" @click="switchToInvalidCode">
                切换为 invalid
              </button>
              <button class="dictionary-showcase-button" type="button" @click="recoverStatusCode">
                恢复为 status
              </button>
              <button class="dictionary-showcase-button" type="button" @click="releasePendingPhase">
                释放迟到 phase
              </button>
            </div>
          </div>
          <div>
            <label for="dictionary-select-showcase-code-switch" class="qs-type-compact-label mb-2 block">
              当前 code：<span class="qs-type-data-mono">{{ codeSwitchCode }}</span>
            </label>
            <QsDictionarySelect
              id="dictionary-select-showcase-code-switch"
              v-model="codeSwitchValue"
              data-testid="dictionary-select-code-switch"
              :dictionary-code="codeSwitchCode"
              clearable
            />
          </div>
        </div>
      </article>

      <div class="mt-5 gap-4 grid lg:grid-cols-2">
        <form
          ref="nativeFormRef"
          class="dictionary-showcase-card"
          @submit.prevent="captureNativeForm"
        >
          <h4 class="qs-type-compact-title m-0">
            原生 FormData 与 required
          </h4>
          <label for="dictionary-select-showcase-native-form" class="qs-type-compact-label mb-2 mt-4 block">
            必填工作流状态
          </label>
          <QsDictionarySelect
            id="dictionary-select-showcase-native-form"
            v-model="nativeFormValue"
            data-testid="dictionary-select-native-form"
            :dictionary-code="DICTIONARY_SELECT_FIXTURE_CODES.status"
            :disabled="nativeFormDisabled"
            name="workflowStatus"
            required
            clearable
          />
          <div class="mt-4 flex flex-wrap gap-2">
            <button class="dictionary-showcase-button" type="button" @click="captureNativeForm">
              读取 FormData
            </button>
            <button class="dictionary-showcase-button" type="submit">
              原生提交校验
            </button>
            <button class="dictionary-showcase-button" type="button" @click="setNativeFormValue('')">
              设为空字符串
            </button>
            <button
              class="dictionary-showcase-button"
              type="button"
              @click="setNativeFormValue(DICTIONARY_SELECT_FIXTURE_VALUES.unknownHistory)"
            >
              设为未知 raw
            </button>
            <button class="dictionary-showcase-button" type="button" @click="setNativeFormValue(null)">
              设为 null
            </button>
            <button class="dictionary-showcase-button" type="button" @click="toggleNativeFormDisabled">
              切换 caller disabled
            </button>
          </div>
          <output class="qs-type-data-mono text-xs mt-3 block break-all" data-testid="dictionary-select-form-data">
            {{ nativeFormSnapshot }}
          </output>
        </form>

        <div class="dictionary-showcase-card">
          <h4 class="qs-type-compact-title m-0">
            FaFormItem auto-bind
          </h4>
          <FaForm
            ref="faFormRef"
            :model="faFormModel"
            :validation-schema="faFormValidationSchema"
            class="mt-4 gap-4"
            scroll-to-error
            @submit="handleFaFormSubmit"
          >
            <FaFormItem name="status" label="表单状态" required>
              <QsDictionarySelect
                data-testid="dictionary-select-form-item"
                :dictionary-code="DICTIONARY_SELECT_FIXTURE_CODES.status"
                clearable
              />
            </FaFormItem>
            <button class="dictionary-showcase-button" type="button" @click="focusFaFormField">
              scrollToField(status)
            </button>
            <button class="dictionary-showcase-button" type="submit">
              提交 FaForm
            </button>
          </FaForm>
          <output class="qs-type-data-mono text-xs mt-3 block break-all" data-testid="dictionary-select-fa-form-result">
            {{ faFormSnapshot }}
          </output>
        </div>
      </div>

      <!--
        下列夹具只验证共享 FaCombobox 的 value identity 与底层 ARIA/事件契约。
        它们不经过字典 Provider，也不扩大 QsDictionarySelect 的 string 模型。
      -->
      <div class="mt-5 gap-4 grid lg:grid-cols-3">
        <article class="dictionary-showcase-card">
          <h4 class="qs-type-compact-title m-0">
            primitive identity
          </h4>
          <p id="dictionary-select-primitive-description" class="qs-type-meta text-muted-foreground m-0 mt-1">
            同一个可读值分别保留 string、number、bigint、null 与 clear 后 undefined。
          </p>
          <div class="mt-4" data-testid="dictionary-select-primitive-values">
            <label for="dictionary-select-showcase-primitive-values" class="qs-type-compact-label mb-2 block">
              Primitive value
            </label>
            <FaCombobox
              v-model="primitiveValue"
              :options="primitiveOptions"
              :input-attrs="{
                'id': 'dictionary-select-showcase-primitive-values',
                'aria-label': 'Primitive value',
                'aria-describedby': 'dictionary-select-primitive-description',
                'aria-required': 'true',
              }"
              clearable
              class="w-full"
              placeholder="选择 primitive"
              @change="handlePrimitiveChange"
              @clear="handlePrimitiveClear"
              @focus="handlePrimitiveFocus"
              @blur="handlePrimitiveBlur"
            />
          </div>
          <output class="qs-type-data-mono text-xs mt-3 block break-all" data-testid="dictionary-select-primitive-summary">
            {{ primitiveValueSummary }}
          </output>
          <output class="qs-type-data-mono text-xs mt-1 block break-all" data-testid="dictionary-select-primitive-events">
            {{ primitiveEventSummary }}
          </output>
        </article>

        <article class="dictionary-showcase-card">
          <h4 class="qs-type-compact-title m-0">
            grouped identity
          </h4>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            分组标题、重复 Label 与 disabled skip 继续回写原始 value。
          </p>
          <div class="mt-4" data-testid="dictionary-select-group-values">
            <label for="dictionary-select-showcase-group-values" class="qs-type-compact-label mb-2 block">
              分组 value
            </label>
            <FaCombobox
              v-model="groupedValue"
              :options="groupedOptions"
              :input-attrs="{ id: 'dictionary-select-showcase-group-values' }"
              class="w-full"
              placeholder="选择分组条目"
            />
          </div>
          <output class="qs-type-data-mono text-xs mt-3 block break-all" data-testid="dictionary-select-group-summary">
            {{ groupedValueSummary }}
          </output>
        </article>

        <article class="dictionary-showcase-card">
          <h4 class="qs-type-compact-title m-0">
            virtual identity
          </h4>
          <p class="qs-type-meta text-muted-foreground m-0 mt-1">
            一百个稳定 value 使用 virtual list，搜索后仍以键盘选择原始条目。
          </p>
          <div class="mt-4" data-testid="dictionary-select-virtual-values">
            <label for="dictionary-select-showcase-virtual-values" class="qs-type-compact-label mb-2 block">
              Virtual value
            </label>
            <FaCombobox
              v-model="virtualValue"
              :options="virtualListOptions"
              :input-attrs="{ id: 'dictionary-select-showcase-virtual-values' }"
              class="w-full"
              placeholder="搜索虚拟条目"
              virtual-list
            />
          </div>
          <output class="qs-type-data-mono text-xs mt-3 block break-all" data-testid="dictionary-select-virtual-summary">
            {{ virtualValueSummary }}
          </output>
        </article>
      </div>

      <article class="dictionary-showcase-card mt-5">
        <div class="gap-4 grid lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.8fr)] lg:items-end">
          <div>
            <h4 class="qs-type-compact-title m-0">
              底层 FaCombobox 对象 identity
            </h4>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              两个稳定对象引用使用相同 Label；该中性夹具只验证共享控件 WeakMap identity，不扩大字典选择器 string 模型。
            </p>
            <p class="qs-type-data-mono text-sm mb-0 mt-3" data-testid="dictionary-select-object-summary">
              {{ objectValueSummary }}
            </p>
          </div>
          <div data-testid="dictionary-select-object-values">
            <label for="dictionary-select-showcase-object-values" class="qs-type-compact-label mb-2 block">
              对象值
            </label>
            <FaCombobox
              v-model="objectValue"
              :options="sameObjectLabelOptions"
              placeholder="选择同名对象"
              :input-attrs="{ id: 'dictionary-select-showcase-object-values' }"
              class="w-full"
            />
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.dictionary-showcase-card {
  min-width: 0;
  padding: 1rem;
  background: oklch(var(--background));
  border: 1px solid oklch(var(--border));
  border-radius: calc(var(--radius) + 0.125rem);
}

.dictionary-showcase-button {
  min-height: 32px;
  padding: 0.375rem 0.75rem;
  color: oklch(var(--foreground));
  cursor: pointer;
  background: oklch(var(--background));
  border: 1px solid oklch(var(--border));
  border-radius: var(--radius);
}

.dictionary-showcase-button:hover {
  background: oklch(var(--muted));
}

.dictionary-showcase-button:focus-visible {
  outline: 2px solid oklch(var(--ring));
  outline-offset: 2px;
}

@media (width <= 640px) {
  .dictionary-showcase-button {
    min-height: 44px;
  }
}
</style>
