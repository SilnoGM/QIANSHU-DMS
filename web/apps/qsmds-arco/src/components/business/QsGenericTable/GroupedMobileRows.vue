<script setup lang="ts" generic="TData extends object">
import type { TableExpandedState, TableProps } from '@fantastic-admin/components'
import type { QsGenericTableGroup } from './grouping'
import type { QsGenericTableActionColumn, QsGenericTableColumn } from './logic'
import CopyCellButton from './CopyCellButton.vue'
import GroupHeader from './GroupHeader.vue'
import { getGroupedRowId, isTableGroupExpanded, resolveGroupedRowKey } from './grouping'
import { getColumnRawValue, getContinuousRowNumber } from './logic'

const props = defineProps<{
  groups: QsGenericTableGroup<TData>[]
  columns: QsGenericTableColumn<TData>[]
  expanded: TableExpandedState
  loading: boolean
  rowKey: TableProps<TData>['rowKey']
  page: number
  pageSize: number
  actionColumn: QsGenericTableActionColumn
  hasActions: boolean
}>()
defineEmits<{ toggle: [key: string] }>()
const isExpanded = (key: string) => isTableGroupExpanded(props.expanded, key)
const groupScope = (group: QsGenericTableGroup<TData>) => ({ row: group.row, rows: group.rows, groupKey: group.key, index: group.index, rowNumber: getContinuousRowNumber(props.page, props.pageSize, group.index), expanded: isExpanded(group.key) })
const rowScope = (group: QsGenericTableGroup<TData>, row: TData, index: number) => ({ row, index, columns: props.columns, group: group.row, groupIndex: group.index, groupKey: group.key, rowNumber: getContinuousRowNumber(props.page, props.pageSize, group.index) })
function displayValue(row: TData, column: QsGenericTableColumn<TData>, index: number) {
  const value = getColumnRawValue(row, column, index)
  return value === undefined || value === null || value === '' ? '—' : String(value)
}
</script>

<template>
  <section
    v-for="group in groups" :key="group.key" data-slot="qs-generic-table-mobile-group"
    class="border border-border rounded-lg bg-background min-w-0 overflow-hidden"
    :class="loading ? 'pointer-events-none opacity-60' : undefined"
    :aria-label="group.label"
  >
    <GroupHeader class="p-3 bg-muted/30" :label="group.label" :expanded="isExpanded(group.key)" :disabled="loading" @toggle="$emit('toggle', group.key)">
      <slot name="group-header" v-bind="groupScope(group)">
        {{ group.label }}
      </slot>
    </GroupHeader>
    <div v-if="isExpanded(group.key)">
      <div v-for="(row, index) in group.rows" :key="getGroupedRowId(group.key, resolveGroupedRowKey(row, index, rowKey))" class="p-4 border-t border-border min-w-0">
        <slot name="mobile-row" v-bind="rowScope(group, row, index)">
          <dl class="m-0 gap-3 grid sm:grid-cols-2">
            <div v-for="column in columns" :key="column.id" class="min-w-0">
              <dt class="qs-type-compact-label mb-1">
                {{ column.title }}
              </dt>
              <dd class="qs-type-body m-0 flex gap-1 min-w-0 break-words items-center" :class="{ 'justify-end text-right': column.align === 'right', 'justify-center text-center': column.align === 'center' }">
                <span class="min-w-0">{{ displayValue(row, column, index) }}</span>
                <CopyCellButton v-if="column.copyable" always-visible :label="column.title" :text="displayValue(row, column, index)" />
              </dd>
            </div>
          </dl>
        </slot>
        <div v-if="hasActions" data-slot="qs-generic-table-mobile-actions" class="mt-3 pt-3 border-t border-border">
          <div class="flex flex-wrap gap-1 min-w-0 items-center" :class="{ 'justify-center': actionColumn.align === 'center', 'justify-end': actionColumn.align === 'right' }">
            <slot name="actions" v-bind="rowScope(group, row, index)" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
