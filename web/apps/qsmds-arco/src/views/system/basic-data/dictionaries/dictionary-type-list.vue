<script setup lang="ts">
import type {
  DictionaryQueryState,
  DictionaryTypeEmptyKind,
} from './dictionary-management.logic'
import type { DictionaryTypeDto } from '@/api/generated/types.gen'

defineOptions({ name: 'DictionaryTypeList' })

const props = withDefaults(defineProps<{
  busy?: boolean
  emptyKind: DictionaryTypeEmptyKind
  error?: string
  items: DictionaryTypeDto[]
  page: number
  pageSize: number
  queryState: DictionaryQueryState
  search: string
  selectedTypeId?: string | null
  status?: 'DISABLED' | 'ENABLED'
  total: number
}>(), {
  busy: false,
  error: '',
  selectedTypeId: null,
  status: undefined,
})

const emit = defineEmits<{
  'pageChange': [page: number]
  'pageSizeChange': [pageSize: number]
  'retry': []
  'search': [search: string]
  'select': [typeId: string]
  'statusChange': [status: 'DISABLED' | 'ENABLED' | undefined]
  'update:page': [page: number]
  'update:pageSize': [pageSize: number]
  'update:search': [search: string]
}>()

// FaSelect 当前不提供可清空契约，因此用显式 sentinel 表达“全部状态”，
// 再在领域事件边界还原为 undefined，避免 UI 值泄漏进查询参数。
const DICTIONARY_TYPE_ALL_STATUS = 'ALL'
const statusOptions = [
  { label: '全部状态', value: DICTIONARY_TYPE_ALL_STATUS },
  { label: '已启用', value: 'ENABLED' },
  { label: '已停用', value: 'DISABLED' },
]
const searchDraft = ref(props.search)
const statusModel = computed(() => props.status ?? DICTIONARY_TYPE_ALL_STATUS)

const pageModel = computed({
  get: () => props.page,
  set: (value) => {
    emit('update:page', value)
    emit('pageChange', value)
  },
})
const pageSizeModel = computed({
  get: () => props.pageSize,
  set: (value) => {
    emit('update:pageSize', value)
    emit('pageSizeChange', value)
  },
})

function applySearch(): void {
  emit('update:search', searchDraft.value)
  emit('search', searchDraft.value)
}

function clearSearch(): void {
  searchDraft.value = ''
  emit('update:search', '')
  emit('search', searchDraft.value)
}

function changeStatus(value: unknown): void {
  emit(
    'statusChange',
    value === DICTIONARY_TYPE_ALL_STATUS
      ? undefined
      : value === 'ENABLED' || value === 'DISABLED' ? value : undefined,
  )
}

watch(
  () => props.search,
  (search) => {
    searchDraft.value = search
  },
)
</script>

<template>
  <section
    class="dictionary-type-list-surface gap-4 grid min-w-0"
    aria-label="字典类型目录"
    :aria-busy="busy"
  >
    <div class="flex gap-3 items-start justify-between">
      <div class="min-w-0">
        <p class="qs-type-meta m-0">
          配置目录
        </p>
        <h2 class="qs-type-compact-title mb-0 mt-1">
          字典类型
        </h2>
      </div>
      <span class="qs-type-meta tabular-nums">{{ total }} 项</span>
    </div>

    <form class="gap-2 grid" role="search" @submit.prevent="applySearch">
      <FaInput
        v-model="searchDraft"
        aria-label="搜索字典类型"
        autocomplete="off"
        class="min-h-11 w-full"
        input-class="min-h-11"
        placeholder="搜索 code、名称或说明"
        @clear="clearSearch"
      >
        <template #start>
          <FaIcon name="i-lucide:search" />
        </template>
      </FaInput>
      <div class="gap-2 grid grid-cols-[minmax(0,1fr)_auto]">
        <label class="min-w-0">
          <span class="sr-only">筛选字典类型状态</span>
          <FaSelect
            :model-value="statusModel"
            :options="statusOptions"
            class="min-h-11 w-full"
            @update:model-value="changeStatus"
          />
        </label>
        <FaButton type="submit" variant="outline" class="px-3 min-h-11">
          查询
        </FaButton>
      </div>
    </form>

    <div
      v-if="busy && items.length === 0"
      class="text-muted-foreground flex gap-2 min-h-40 items-center justify-center"
      role="status"
      aria-busy="true"
    >
      <FaIcon
        name="i-lucide:loader-circle"
        class="dictionary-type-loading-indicator size-5 animate-spin"
      />
      <span>正在读取类型…</span>
    </div>

    <FaAlert
      v-else-if="queryState === 'error'"
      variant="destructive"
      icon="i-lucide:circle-alert"
      title="字典类型读取失败"
      :description="error"
      role="alert"
    >
      <template #action>
        <FaButton variant="outline" class="min-h-11" @click="emit('retry')">
          重试
        </FaButton>
      </template>
    </FaAlert>

    <FaEmpty
      v-else-if="queryState === 'empty' && emptyKind === 'system'"
      icon="i-lucide:book-dashed"
      title="暂无字典类型"
      description="系统尚未配置字典类型。"
      class="min-h-40"
    />

    <FaEmpty
      v-else-if="queryState === 'empty'"
      icon="i-lucide:search-x"
      title="未找到匹配类型"
      description="没有匹配当前条件的字典类型，请调整搜索或状态筛选。"
      class="min-h-40"
    />

    <template v-else>
      <p v-if="queryState === 'refreshing'" class="qs-type-meta m-0" role="status">
        正在刷新当前结果…
      </p>
      <ul class="m-0 p-0 list-none gap-2 grid" aria-label="字典类型">
        <li v-for="type in items" :key="type.id">
          <button
            type="button"
            class="p-3 text-left border border-border rounded-lg bg-background min-h-11 w-full transition-colors focus-visible:outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-primary/50"
            :class="selectedTypeId === type.id ? 'border-primary bg-primary/5' : ''"
            :aria-current="selectedTypeId === type.id ? 'true' : undefined"
            @click="emit('select', type.id)"
          >
            <span class="qs-type-compact-title block break-words">{{ type.name }}</span>
            <code class="qs-type-data mt-1 block break-all">{{ type.code }}</code>
            <span class="mt-2 flex flex-wrap gap-2 items-center">
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="type.enabled
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border bg-muted text-muted-foreground'"
              >
                {{ type.enabled ? '已启用' : '已停用' }}
              </FaTag>
              <span class="qs-type-meta">{{ type.itemCount }} 个条目</span>
            </span>
          </button>
        </li>
      </ul>
    </template>

    <FaPagination
      v-if="total > 0"
      v-model:page="pageModel"
      v-model:size="pageSizeModel"
      :sizes="[20, 50, 100]"
      :total="total"
      layout="pager, sizes"
      class="flex-wrap max-w-full justify-center"
    />
  </section>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .dictionary-type-loading-indicator {
    animation: none !important;
  }
}

@media (width <= 767px) {
  .dictionary-type-list-surface :deep(button) {
    min-width: 2.75rem;
    min-height: 2.75rem;
  }

  .dictionary-type-list-surface :deep([data-slot="input-group"]),
  .dictionary-type-list-surface :deep([data-slot="input-group-control"]),
  .dictionary-type-list-surface :deep([data-slot="select-trigger"]) {
    min-height: 2.75rem;
  }

  /*
   * FaSelect 的选项列表 Teleport 到 body。用当前 Type 列表中已展开的 trigger
   * 作为归属条件，只扩大该交互时出现的选项，不修改 FaSelect 的公共契约。
   */
  :global(body:has(.dictionary-type-list-surface [data-slot="select-trigger"][aria-expanded="true"]) [data-slot="select-content"] [role="option"]) {
    min-height: 2.75rem;
  }
}
</style>
