<script setup lang="ts">
import type { TableSortingState } from '@fantastic-admin/components'
import type { DictionaryTypeStatusAction } from './dictionary-status.logic'
import type {
  DictionaryItemDto,
  DictionaryTypeDto,
} from '@/api/generated/types.gen'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { hasVisibleTableColumn } from '../../shared/table-query'
import { resolveDictionaryItemEmptyKind } from './dictionary-management.logic'
import { resolveDictionaryItemActions } from './dictionary-status.logic'

defineOptions({ name: 'DictionaryItemTable' })

const props = withDefaults(defineProps<{
  canCreate: boolean
  canDisable: boolean
  canEnable: boolean
  canUpdate: boolean
  dictionaryType: DictionaryTypeDto
  error?: string
  items: DictionaryItemDto[]
  loading?: boolean
  total: number
}>(), {
  error: '',
  loading: false,
})

const emit = defineEmits<{
  add: []
  edit: [item: DictionaryItemDto]
  filterChange: [filters: QsGenericTableFilterValues]
  paginationChange: [pagination: { page: number, pageSize: number }]
  retry: []
  search: [search: string]
  sortingChange: [sorting: TableSortingState]
  status: [item: DictionaryItemDto, action: DictionaryTypeStatusAction]
}>()

const page = defineModel<number>('page', { default: 1 })
const pageSize = defineModel<number>('pageSize', { default: 20 })
const search = defineModel<string>('search', { default: '' })
const filters = defineModel<QsGenericTableFilterValues>('filters', {
  default: () => ({}),
})
const sorting = defineModel<TableSortingState>('sorting', {
  default: () => [{ id: 'sortOrder', desc: false }],
})

const itemColumns: QsGenericTableColumn<DictionaryItemDto>[] = [
  {
    accessorKey: 'label',
    enableMultiSort: false,
    id: 'label',
    minWidth: 190,
    sortable: true,
    title: 'Label',
  },
  {
    accessorKey: 'value',
    copyable: true,
    enableMultiSort: false,
    id: 'value',
    minWidth: 160,
    sortable: true,
    title: 'Value',
  },
  {
    accessorKey: 'tone',
    id: 'tone',
    title: 'Tone',
    width: 110,
  },
  {
    accessorKey: 'enabled',
    id: 'ownStatus',
    title: '自身状态',
    width: 110,
  },
  {
    accessorFn: item => dictionaryItemEffectiveStatusLabel(item),
    id: 'effectiveStatus',
    title: '有效状态',
    width: 130,
  },
  {
    accessorKey: 'sortOrder',
    align: 'right',
    enableMultiSort: false,
    id: 'sortOrder',
    sortable: true,
    title: '排序',
    width: 90,
  },
  {
    accessorKey: 'updatedAt',
    defaultVisible: false,
    enableMultiSort: false,
    id: 'updatedAt',
    minWidth: 180,
    sortable: true,
    title: '更新时间',
  },
]

const itemFilterDefinitions: QsGenericTableFilterDefinition[] = [
  {
    key: 'ownStatus',
    label: '自身状态',
    options: [
      { label: '启用', value: 'ENABLED' },
      { label: '停用', value: 'DISABLED' },
    ],
  },
]

const ITEM_TONE_LABELS: Readonly<Record<DictionaryItemDto['tone'], string>> = {
  DANGER: '危险',
  DEFAULT: '默认',
  INFO: '信息',
  PRIMARY: '主要',
  SUCCESS: '成功',
  WARNING: '警告',
}

const ITEM_TONE_CLASSES: Readonly<Record<DictionaryItemDto['tone'], string>> = {
  DANGER: 'border-destructive/30 bg-destructive/5 text-destructive',
  DEFAULT: 'border-border bg-muted text-muted-foreground',
  INFO: 'border-border bg-background text-foreground',
  PRIMARY: 'border-primary/30 bg-primary/10 text-primary',
  SUCCESS: 'border-primary/30 bg-primary/10 text-primary',
  WARNING: 'border-destructive/30 bg-destructive/5 text-destructive',
}

const itemEmptyKind = computed(() => resolveDictionaryItemEmptyKind({
  search: search.value,
  status: filters.value.ownStatus,
}))
const itemEmptyTitle = computed(() => itemEmptyKind.value === 'filtered'
  ? '没有匹配当前条件的条目'
  : '该类型暂无条目')
const itemEmptyDescription = computed(() => itemEmptyKind.value === 'filtered'
  ? '请调整搜索词或自身状态筛选后重试。'
  : '该字典类型尚未配置任何条目。')

function dictionaryItemToneLabel(tone: DictionaryItemDto['tone']): string {
  return ITEM_TONE_LABELS[tone]
}

function dictionaryItemToneClass(tone: DictionaryItemDto['tone']): string {
  return ITEM_TONE_CLASSES[tone]
}

function dictionaryItemEffectiveStatusLabel(item: DictionaryItemDto): string {
  if (item.effectiveEnabled) {
    return '有效'
  }
  return item.enabled ? '随类型停用' : '条目已停用'
}

function dictionaryItemActions(item: DictionaryItemDto) {
  return resolveDictionaryItemActions(item, props.dictionaryType, {
    canDisable: props.canDisable,
    canEnable: props.canEnable,
    canUpdate: props.canUpdate,
  })
}
</script>

<template>
  <QsGenericTable
    v-model:page="page"
    v-model:page-size="pageSize"
    v-model:search="search"
    v-model:filters="filters"
    v-model:sorting="sorting"
    class="dictionary-item-table-surface"
    :class="{ 'dictionary-item-table-error': Boolean(error) }"
    data-testid="dictionary-item-table"
    row-key="id"
    :action-column="{ width: 210 }"
    :addable="canCreate"
    add-label="新增条目"
    :columns="itemColumns"
    :data="items"
    :empty-description="itemEmptyDescription"
    :empty-title="itemEmptyTitle"
    :error="error || undefined"
    :filter-definitions="itemFilterDefinitions"
    :loading="loading"
    :page-size-options="[20, 50, 100]"
    search-placeholder="搜索条目 Label、Value 或说明"
    :total="total"
    table-class="min-w-[1040px]"
    @add="emit('add')"
    @filter-change="emit('filterChange', $event)"
    @pagination-change="emit('paginationChange', $event)"
    @retry="emit('retry')"
    @search="emit('search', $event)"
    @sorting-change="emit('sortingChange', $event)"
  >
    <template #cell-label="{ row }">
      <div class="gap-0.5 grid min-w-0">
        <strong class="qs-type-body-medium break-words">
          {{ row.original.label }}
        </strong>
        <span class="qs-type-meta break-words">
          {{ row.original.description || '暂无说明' }}
        </span>
      </div>
    </template>

    <template #cell-value="{ row }">
      <code class="qs-type-data-emphasis [overflow-wrap:anywhere]">
        {{ row.original.value }}
      </code>
    </template>

    <template #cell-tone="{ row }">
      <FaTag
        variant="outline"
        class="qs-type-status-tag"
        :class="dictionaryItemToneClass(row.original.tone)"
      >
        {{ dictionaryItemToneLabel(row.original.tone) }}
      </FaTag>
    </template>

    <template #cell-ownStatus="{ row }">
      <FaTag
        variant="outline"
        class="qs-type-status-tag"
        :class="row.original.enabled
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-border bg-muted text-muted-foreground'"
      >
        {{ row.original.enabled ? '已启用' : '已停用' }}
      </FaTag>
    </template>

    <template #cell-effectiveStatus="{ row }">
      <FaTag
        variant="outline"
        class="qs-type-status-tag"
        :class="row.original.effectiveEnabled
          ? 'border-primary/30 bg-primary/10 text-primary'
          : row.original.enabled
            ? 'border-border bg-muted text-muted-foreground'
            : 'border-destructive/30 bg-destructive/5 text-destructive'"
      >
        {{ dictionaryItemEffectiveStatusLabel(row.original) }}
      </FaTag>
    </template>

    <template #cell-sortOrder="{ row }">
      <span class="qs-type-data tabular-nums">{{ row.original.sortOrder }}</span>
    </template>

    <template #cell-updatedAt="{ row }">
      <DateTimeDisplay :value="row.original.updatedAt" />
    </template>

    <template #actions="{ row: item }">
      <div
        v-if="dictionaryItemActions(item).hasAny
          || (dictionaryItemActions(item).disableBlockedReason && canDisable)"
        class="flex flex-wrap gap-1 min-w-0 w-full items-center"
      >
        <FaButton
          v-if="dictionaryItemActions(item).canEdit"
          variant="ghost"
          size="sm"
          class="min-h-11 w-full md:min-h-8 md:w-auto"
          :aria-label="`编辑条目 ${item.value}`"
          @click="emit('edit', item)"
        >
          编辑
        </FaButton>
        <FaButton
          v-if="dictionaryItemActions(item).canEnable"
          variant="ghost"
          size="sm"
          class="min-h-11 w-full md:min-h-8 md:w-auto"
          :aria-label="`启用条目 ${item.value}`"
          @click="emit('status', item, 'enable')"
        >
          启用
        </FaButton>
        <FaButton
          v-if="dictionaryItemActions(item).canDisable"
          variant="ghost"
          size="sm"
          class="text-destructive min-h-11 w-full md:min-h-8 md:w-auto"
          :aria-label="`停用条目 ${item.value}`"
          @click="emit('status', item, 'disable')"
        >
          停用
        </FaButton>
        <span
          v-else-if="dictionaryItemActions(item).disableBlockedReason && canDisable"
          class="qs-type-meta min-w-0 w-full whitespace-normal [overflow-wrap:anywhere]"
          role="status"
        >
          暂不可停用：{{ dictionaryItemActions(item).disableBlockedReason }}
        </span>
      </div>
      <span v-else class="qs-type-meta">仅查看</span>
    </template>

    <!-- 移动卡片只组合业务字段；操作区继续由 QsGenericTable 统一承载。 -->
    <template #mobile-row="{ columns: visibleColumns, row: item, rowNumber }">
      <div data-testid="dictionary-item-card" class="gap-4 grid min-w-0">
        <div class="flex gap-3 min-w-0 items-start justify-between">
          <div
            v-if="hasVisibleTableColumn(visibleColumns, 'label')"
            class="min-w-0"
          >
            <strong class="qs-type-body-medium block break-words">
              {{ item.label }}
            </strong>
            <span v-if="item.description" class="qs-type-meta mt-0.5 block break-words">
              {{ item.description }}
            </span>
          </div>
          <span class="qs-type-meta shrink-0 tabular-nums">#{{ rowNumber }}</span>
        </div>

        <div
          v-if="hasVisibleTableColumn(visibleColumns, 'value')"
          class="min-w-0"
        >
          <p class="qs-type-compact-label mb-1 mt-0">
            Value
          </p>
          <div class="group flex gap-1 min-w-0 items-start">
            <code class="qs-type-data-emphasis min-w-0 [overflow-wrap:anywhere]">
              {{ item.value }}
            </code>
            <CopyCellButton
              always-visible
              class="[&_button]:size-11"
              label="条目 Value"
              :text="item.value"
            />
          </div>
        </div>

        <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-2 max-[479px]:grid-cols-1">
          <div v-if="hasVisibleTableColumn(visibleColumns, 'tone')">
            <dt class="qs-type-compact-label mb-1">
              Tone
            </dt>
            <dd class="m-0">
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="dictionaryItemToneClass(item.tone)"
              >
                {{ dictionaryItemToneLabel(item.tone) }}
              </FaTag>
            </dd>
          </div>
          <div v-if="hasVisibleTableColumn(visibleColumns, 'ownStatus')">
            <dt class="qs-type-compact-label mb-1">
              自身状态
            </dt>
            <dd class="m-0">
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="item.enabled
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border bg-muted text-muted-foreground'"
              >
                {{ item.enabled ? '已启用' : '已停用' }}
              </FaTag>
            </dd>
          </div>
          <div v-if="hasVisibleTableColumn(visibleColumns, 'effectiveStatus')">
            <dt class="qs-type-compact-label mb-1">
              有效状态
            </dt>
            <dd class="m-0">
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="item.effectiveEnabled
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : item.enabled
                    ? 'border-border bg-muted text-muted-foreground'
                    : 'border-destructive/30 bg-destructive/5 text-destructive'"
              >
                {{ dictionaryItemEffectiveStatusLabel(item) }}
              </FaTag>
            </dd>
          </div>
          <div v-if="hasVisibleTableColumn(visibleColumns, 'sortOrder')">
            <dt class="qs-type-compact-label mb-1">
              排序
            </dt>
            <dd class="qs-type-data m-0 tabular-nums">
              {{ item.sortOrder }}
            </dd>
          </div>
          <div
            v-if="hasVisibleTableColumn(visibleColumns, 'updatedAt')"
            class="col-span-full max-[479px]:col-span-1"
          >
            <dt class="qs-type-compact-label mb-1">
              更新时间
            </dt>
            <dd class="m-0">
              <DateTimeDisplay :value="item.updatedAt" />
            </dd>
          </div>
        </dl>
      </div>
    </template>
  </QsGenericTable>
</template>

<style scoped>
/* QsGenericTable 继续拥有错误呈现；调用方只在失败态隐藏其数据空态区域。 */
.dictionary-item-table-error:deep(> [aria-busy]) {
  display: none;
}

@media (width <= 767px) {
  .dictionary-item-table-surface:deep(button) {
    min-width: 2.75rem;
    min-height: 2.75rem;
  }

  .dictionary-item-table-surface:deep([data-slot="input-group"]),
  .dictionary-item-table-surface:deep([data-slot="input-group-control"]),
  .dictionary-item-table-surface:deep([data-slot="select-trigger"]) {
    min-height: 2.75rem;
  }
}
</style>
