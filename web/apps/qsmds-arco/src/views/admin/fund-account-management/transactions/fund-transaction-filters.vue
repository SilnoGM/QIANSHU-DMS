<script setup lang="ts">
import type { FundTransactionFilterState } from './fund-transaction.logic'
import QsDateTimeField from '@/components/business/QsDateTimeField/index.vue'

defineOptions({ name: 'FundTransactionFilters' })

const props = withDefaults(defineProps<{
  accountOptions: FundTransactionFilterOption[]
  businessSourceOptions: FundTransactionFilterOption[]
  catalogError?: null | string
  catalogLoading?: boolean
  disabled?: boolean
  modelValue: FundTransactionFilterState
  postingTypeOptions: FundTransactionFilterOption[]
  userOptions: FundTransactionFilterOption[]
}>(), {
  catalogError: null,
  catalogLoading: false,
  disabled: false,
})

const emit = defineEmits<{
  apply: [filters: FundTransactionFilterState]
  refreshCatalog: []
  reset: []
}>()

interface FundTransactionFilterOption {
  readonly label: string
  readonly value: string
}

const draft = ref<FundTransactionFilterState>({ ...props.modelValue })

/**
 * 路由可以先于账户目录恢复 accountId。FaCombobox 在选项尚不存在时会按原始值
 * 回显，因此这里只在目录已经能够解析主体名称后再把 ID 交给显示组件；draft
 * 仍始终保留真实 ID，服务端筛选语义不会改变。
 */
const accountSelectionValue = computed(() => {
  const accountId = draft.value.accountId
  return accountId !== undefined
    && props.accountOptions.some(option => option.value === draft.value.accountId)
    ? accountId
    : undefined
})

const categoryOptions = [
  { label: '收益', value: 'REVENUE' },
  { label: '成本', value: 'COST' },
  { label: '中性', value: 'NEUTRAL' },
  { label: '调账', value: 'ADJUSTMENT' },
]
const directionOptions = [
  { label: '入账', value: 'CREDIT' },
  { label: '出账', value: 'DEBIT' },
]
const reversalStatusOptions = [
  { label: '未冲账', value: 'NONE' },
  { label: '部分冲账', value: 'PARTIAL' },
  { label: '已全部冲账', value: 'FULL' },
  { label: '冲账批次', value: 'NOT_APPLICABLE' },
]

const activeCount = computed(() => Object.values(props.modelValue).filter(value => (
  value !== undefined && value !== ''
)).length)

function updateDraft(
  key: keyof FundTransactionFilterState,
  value: unknown,
): void {
  draft.value = {
    ...draft.value,
    [key]: typeof value === 'string' && value !== '' ? value : undefined,
  }
}

function submit(): void {
  if (!props.disabled) {
    emit('apply', { ...draft.value })
  }
}

function reset(): void {
  if (props.disabled) {
    return
  }
  draft.value = {}
  emit('reset')
  emit('apply', {})
}

watch(() => props.modelValue, (value) => {
  draft.value = { ...value }
}, { deep: true })
</script>

<template>
  <section
    aria-labelledby="fund-transaction-filter-title"
    class="mb-4 border border-border/70 bg-card"
    data-testid="fund-transaction-filters"
  >
    <header class="p-4 border-b border-border/70 flex flex-wrap gap-3 items-start justify-between">
      <div class="flex gap-3 min-w-0 items-start">
        <span class="text-primary rounded-md bg-primary/10 flex-center shrink-0 size-9">
          <FaIcon name="i-lucide:list-filter" class="size-4" />
        </span>
        <div class="min-w-0">
          <div class="flex flex-wrap gap-2 items-center">
            <h2 id="fund-transaction-filter-title" class="text-sm font-semibold m-0">
              服务端筛选
            </h2>
            <FaTag v-if="activeCount > 0" variant="outline" class="qs-type-status-tag">
              已应用 {{ activeCount }} 项
            </FaTag>
          </div>
          <p class="qs-type-meta m-0 mt-1">
            修改条件后点击“应用筛选”，输入过程不会逐键请求资金流水。
          </p>
        </div>
      </div>
      <FaButton
        v-if="catalogError"
        variant="outline"
        size="sm"
        class="min-h-11 sm:min-h-9"
        :disabled="disabled || catalogLoading"
        @click="emit('refreshCatalog')"
      >
        <FaIcon name="i-lucide:refresh-cw" />重试选项
      </FaButton>
    </header>

    <FaAlert
      v-if="catalogError"
      icon="i-lucide:triangle-alert"
      title="部分筛选选项暂不可用"
      :description="catalogError"
      class="m-4 mb-0"
      role="status"
    />

    <div class="p-4 gap-4 grid md:grid-cols-2 xl:grid-cols-4">
      <label class="gap-1.5 grid min-w-0">
        <span class="qs-type-compact-label">账户</span>
        <FaCombobox
          :model-value="accountSelectionValue"
          :options="accountOptions"
          :disabled="disabled || catalogLoading"
          :input-attrs="{ 'aria-label': '按账户筛选', 'aria-busy': catalogLoading }"
          clearable
          virtual-list
          class="w-full"
          empty-text="暂无可选账户"
          placeholder="搜索账户主体"
          @update:model-value="value => updateDraft('accountId', value)"
        />
      </label>

      <label class="gap-1.5 grid min-w-0">
        <span class="qs-type-compact-label">用户</span>
        <FaCombobox
          :model-value="draft.userId"
          :options="userOptions"
          :disabled="disabled || catalogLoading"
          :input-attrs="{ 'aria-label': '按用户筛选', 'aria-busy': catalogLoading }"
          clearable
          virtual-list
          class="w-full"
          empty-text="暂无可选用户"
          placeholder="搜索用户名或显示名称"
          @update:model-value="value => updateDraft('userId', value)"
        />
      </label>

      <label class="gap-1.5 grid min-w-0">
        <span class="qs-type-compact-label">业务类型</span>
        <FaCombobox
          :model-value="draft.postingTypeId"
          :options="postingTypeOptions"
          :disabled="disabled || catalogLoading"
          :input-attrs="{ 'aria-label': '按业务类型筛选', 'aria-busy': catalogLoading }"
          clearable
          virtual-list
          class="w-full"
          empty-text="暂无可选业务类型"
          placeholder="搜索类型名称"
          @update:model-value="value => updateDraft('postingTypeId', value)"
        />
      </label>

      <label class="gap-1.5 grid min-w-0">
        <span class="qs-type-compact-label">业务分类</span>
        <FaSelect
          :model-value="draft.businessCategory"
          :options="categoryOptions"
          :disabled="disabled"
          clearable
          class="min-h-11 w-full sm:min-h-9"
          placeholder="选择业务分类"
          @update:model-value="value => updateDraft('businessCategory', value)"
        />
      </label>

      <label class="gap-1.5 grid min-w-0">
        <span class="qs-type-compact-label">业务来源</span>
        <FaCombobox
          :model-value="draft.businessSourceId"
          :options="businessSourceOptions"
          :disabled="disabled || catalogLoading"
          :input-attrs="{ 'aria-label': '按业务来源筛选', 'aria-busy': catalogLoading }"
          clearable
          virtual-list
          class="w-full"
          empty-text="暂无可选业务来源"
          placeholder="搜索来源名称"
          @update:model-value="value => updateDraft('businessSourceId', value)"
        />
      </label>

      <label class="gap-1.5 grid min-w-0">
        <span class="qs-type-compact-label">收支方向</span>
        <FaSelect
          :model-value="draft.direction"
          :options="directionOptions"
          :disabled="disabled"
          clearable
          class="min-h-11 w-full sm:min-h-9"
          placeholder="选择入账或出账"
          @update:model-value="value => updateDraft('direction', value)"
        />
      </label>

      <label class="gap-1.5 grid min-w-0">
        <span class="qs-type-compact-label">业务单号</span>
        <FaInput
          :model-value="draft.businessNo"
          type="search"
          clearable
          autocomplete="off"
          class="min-h-11 w-full sm:min-h-9"
          maxlength="128"
          placeholder="输入完整编号或片段"
          :disabled="disabled"
          @update:model-value="value => updateDraft('businessNo', value)"
          @keydown.enter.prevent="submit"
        />
      </label>

      <label class="gap-1.5 grid min-w-0">
        <span class="qs-type-compact-label">冲账状态</span>
        <FaSelect
          :model-value="draft.reversalStatus"
          :options="reversalStatusOptions"
          :disabled="disabled"
          clearable
          class="min-h-11 w-full sm:min-h-9"
          placeholder="选择冲账状态"
          @update:model-value="value => updateDraft('reversalStatus', value)"
        />
      </label>

      <div class="gap-1.5 grid min-w-0 md:col-span-1 xl:col-span-2">
        <span class="qs-type-compact-label">发生时间从</span>
        <QsDateTimeField
          :model-value="draft.occurredFrom ?? ''"
          precision="minute"
          clearable
          :disabled="disabled"
          aria-label="发生时间从"
          @update:model-value="value => updateDraft('occurredFrom', value)"
        />
      </div>

      <div class="gap-1.5 grid min-w-0 md:col-span-1 xl:col-span-2">
        <span class="qs-type-compact-label">发生时间至</span>
        <QsDateTimeField
          :model-value="draft.occurredTo ?? ''"
          precision="minute"
          clearable
          :disabled="disabled"
          aria-label="发生时间至"
          @update:model-value="value => updateDraft('occurredTo', value)"
        />
      </div>
    </div>

    <footer class="p-3 border-t border-border/70 bg-muted/20 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
      <FaButton
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="disabled"
        @click="reset"
      >
        重置
      </FaButton>
      <FaButton
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="disabled"
        @click="submit"
      >
        <FaIcon name="i-lucide:search" />应用筛选
      </FaButton>
    </footer>
  </section>
</template>
