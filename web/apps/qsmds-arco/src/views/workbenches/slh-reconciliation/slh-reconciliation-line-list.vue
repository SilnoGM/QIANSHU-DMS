<script setup lang="ts">
import type {
  SlhReconciliationBucketRowGroup,
  SlhReconciliationDiffBucket,
  SlhReconciliationRow,
  SlhReconciliationSortMode,
} from './diff.logic'
import { resolveSlhReconciliationBucketLabelKey } from './diff.logic'

/**
 * 核对清单：每条成员行一行，只回答「这条行有几处不一致、涉及哪些方面、核对到哪一步」。
 * 刻意不在行内内联任何字段数值——在清单里挑一个字段显示数值本身就是给它特权，
 * 而清单宽度只够容纳一两个字段。数值一律在右侧对照面板里看。
 */
const props = defineProps<{
  /** 已排序、已筛选的清单行。 */
  rows: readonly SlhReconciliationRow[]
  /** 按桶分组时的分组结果；分组关闭时为空数组。 */
  groups: readonly SlhReconciliationBucketRowGroup[]
  grouped: boolean
  /** 分组内同一行可能重复出现，用一次说明替代逐处标注。 */
  selectedLineId: string
  sortMode: SlhReconciliationSortMode
  differencesOnly: boolean
  inProgress: boolean
  /** 可勾选（未核对）的成员行 id。 */
  selectableLineIds: ReadonlySet<string>
  checkedLineIds: ReadonlySet<string>
}>()

const emit = defineEmits<{
  (event: 'select', lineId: string): void
  (event: 'toggleCheck', lineId: string, checked: boolean): void
  (event: 'toggleSort'): void
  (event: 'toggleGroup'): void
  (event: 'toggleDifferencesOnly'): void
}>()

const { t } = useI18n()

function bucketLabel(bucket: SlhReconciliationDiffBucket): string {
  return t(resolveSlhReconciliationBucketLabelKey(bucket))
}

function onCheck(lineId: string, checked: boolean): void {
  if (props.selectableLineIds.has(lineId)) {
    emit('toggleCheck', lineId, checked)
  }
}

/** 分组视图下同一行走廊会重复出现，只在第一次出现时给勾选框，避免重复提交同一行。 */
function isCheckable(lineId: string): boolean {
  return props.inProgress && props.selectableLineIds.has(lineId)
}
</script>

<template>
  <section class="border rounded-lg flex flex-col min-h-0">
    <!-- 标题与开关分两行：窄列里把三个开关挤在同一行会把标题压成竖排。 -->
    <div class="px-3 py-2 border-b">
      <div class="flex gap-2 items-center">
        <h2 class="qs-type-component-title m-0 whitespace-nowrap">
          {{ t('slhReconciliation.detail.listTitle') }}
        </h2>
        <span class="qs-type-description text-muted-foreground tabular-nums">
          {{ t('slhReconciliation.detail.listCount', { count: rows.length }) }}
        </span>
      </div>
      <div class="mt-1 flex flex-wrap gap-1">
        <!-- 两个开关都把「当前状态」写在标签里，避免按钮读起来像动作还是像状态。 -->
        <FaButton type="button" size="sm" variant="ghost" class="whitespace-nowrap" @click="emit('toggleSort')">
          {{ t('slhReconciliation.detail.sortPrefix') }}：{{ sortMode === 'DIFFERENCE_FIRST' ? t('slhReconciliation.detail.sortDifferenceFirst') : t('slhReconciliation.detail.sortByLine') }}
        </FaButton>
        <FaButton type="button" size="sm" :variant="grouped ? 'default' : 'ghost'" class="whitespace-nowrap" @click="emit('toggleGroup')">
          <FaIcon name="i-lucide:list-tree" aria-hidden="true" />
          {{ t('slhReconciliation.detail.groupPrefix') }}：{{ grouped ? t('slhReconciliation.detail.groupOn') : t('slhReconciliation.detail.groupOff') }}
        </FaButton>
        <FaButton
          type="button"
          size="sm"
          :variant="differencesOnly ? 'default' : 'ghost'"
          class="whitespace-nowrap"
          @click="emit('toggleDifferencesOnly')"
        >
          <FaIcon name="i-lucide:list-filter" aria-hidden="true" />
          {{ t('slhReconciliation.detail.differencesOnly') }}
        </FaButton>
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto">
      <p v-if="grouped" class="qs-type-description text-muted-foreground m-0 px-3 py-2 border-b">
        {{ t('slhReconciliation.detail.groupNotice') }}
      </p>
      <p v-if="rows.length === 0" class="qs-type-description text-muted-foreground m-0 px-3 py-6 text-center">
        {{ t('slhReconciliation.detail.emptyMembers') }}
      </p>

      <template v-else-if="grouped">
        <div v-for="group in groups" :key="group.bucket">
          <div class="px-3 py-1.5 bg-muted/40 flex gap-2 items-center">
            <span class="qs-type-component-title m-0">{{ bucketLabel(group.bucket) }}</span>
            <span class="qs-type-description text-muted-foreground tabular-nums">
              {{ t('slhReconciliation.detail.listCount', { count: group.rows.length }) }}
            </span>
          </div>
          <ul class="m-0 p-0 list-none divide-y">
            <li v-for="row in group.rows" :key="`${group.bucket}-${row.key}`">
              <div
                class="px-3 py-2 flex gap-2 cursor-pointer items-start hover:bg-muted/30"
                :class="selectedLineId === row.key ? 'bg-primary/5' : undefined"
                @click="emit('select', row.key)"
              >
                <FaCheckbox
                  v-if="isCheckable(row.key)"
                  class="mt-0.5"
                  :model-value="checkedLineIds.has(row.key)"
                  :aria-label="t('slhReconciliation.detail.selectLine', { line: row.comparison.lineNumber })"
                  @click.stop
                  @update:model-value="(value: unknown) => onCheck(row.key, value === true)"
                />
                <div class="flex-1 min-w-0">
                  <div class="flex gap-2 items-center">
                    <span class="font-medium tabular-nums">{{ row.comparison.lineNumber }}</span>
                    <span class="qs-type-description text-muted-foreground font-mono truncate">{{ row.member.matchedContainerBatchName }}</span>
                    <span class="qs-type-description truncate">{{ row.member.goodsName }}</span>
                    <div class="flex-1" />
                    <span class="qs-type-status-tag tabular-nums" :class="row.comparison.differenceCount > 0 ? 'text-destructive' : 'text-muted-foreground'">
                      {{ t('slhReconciliation.detail.differenceCount', { count: row.comparison.differenceCount }) }}
                    </span>
                    <span class="qs-type-description text-muted-foreground whitespace-nowrap">
                      {{ row.member.reconciledAt === null ? t('slhReconciliation.detail.notReconciledYet') : t('slhReconciliation.detail.reconciledShort') }}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </template>

      <ul v-else class="m-0 p-0 list-none divide-y">
        <li v-for="row in rows" :key="row.key">
          <div
            class="px-3 py-2 flex gap-2 cursor-pointer items-start hover:bg-muted/30"
            :class="selectedLineId === row.key ? 'bg-primary/5' : undefined"
            @click="emit('select', row.key)"
          >
            <FaCheckbox
              v-if="isCheckable(row.key)"
              class="mt-0.5"
              :model-value="checkedLineIds.has(row.key)"
              :aria-label="t('slhReconciliation.detail.selectLine', { line: row.comparison.lineNumber })"
              @click.stop
              @update:model-value="(value: unknown) => onCheck(row.key, value === true)"
            />
            <div class="flex-1 min-w-0">
              <div class="flex gap-2 items-center">
                <span class="font-medium tabular-nums">{{ row.comparison.lineNumber }}</span>
                <span class="qs-type-description text-muted-foreground font-mono truncate">{{ row.member.matchedContainerBatchName }}</span>
                <span class="qs-type-description truncate">{{ row.member.goodsName }}</span>
                <div class="flex-1" />
                <span class="qs-type-status-tag tabular-nums" :class="row.comparison.differenceCount > 0 ? 'text-destructive' : 'text-muted-foreground'">
                  {{ t('slhReconciliation.detail.differenceCount', { count: row.comparison.differenceCount }) }}
                </span>
                <span class="qs-type-description text-muted-foreground whitespace-nowrap">
                  {{ row.member.reconciledAt === null ? t('slhReconciliation.detail.notReconciledYet') : t('slhReconciliation.detail.reconciledShort') }}
                </span>
              </div>
              <div v-if="row.comparison.buckets.length > 0" class="mt-1 flex flex-wrap gap-1">
                <FaTag v-for="bucket in row.comparison.buckets" :key="bucket" variant="outline" class="qs-type-status-tag">
                  {{ bucketLabel(bucket) }}
                </FaTag>
              </div>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
