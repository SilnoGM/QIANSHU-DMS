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
  /** 当前生效的桶筛选；`all` 表示未按桶筛选。 */
  activeBucket: SlhReconciliationDiffBucket | 'all'
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

/** 按桶筛选时行内只报该桶的处数：否则数字与当前视野不一致。 */
function bucketCountOf(row: SlhReconciliationRow): number {
  return props.activeBucket === 'all' ? 0 : row.comparison.bucketCounts[props.activeBucket]
}

const filtered = computed(() => props.activeBucket !== 'all' || props.differencesOnly)

/** 分组头与行拍平成一个列表：分组头要能吸顶，所以它必须和行处在同一个滚动流里。 */
interface LineListItem { readonly key: string, readonly kind: 'group' | 'row', readonly label?: string, readonly count?: number, readonly row?: SlhReconciliationRow }
const items = computed<LineListItem[]>(() => (props.grouped
  ? props.groups.flatMap(group => [
      { count: group.rows.length, key: `group-${group.bucket}`, kind: 'group' as const, label: bucketLabel(group.bucket) },
      ...group.rows.map(row => ({ key: `${group.bucket}-${row.key}`, kind: 'row' as const, row })),
    ])
  : props.rows.map(row => ({ key: row.key, kind: 'row' as const, row }))))

/**
 * 步进（「下一条不一致」）或从别处改选中行时，把清单滚到该行：
 * 否则面板换了行、清单视口不动，用户不知道当前在哪一条。
 */
const listRoot = ref<HTMLElement | null>(null)
watch(() => props.selectedLineId, async (lineId) => {
  if (lineId === '' || listRoot.value === null) {
    return
  }
  await nextTick()
  const target = listRoot.value.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(lineId)}"]`)
  target?.scrollIntoView({ block: 'nearest' })
}, { flush: 'post' })
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

    <div ref="listRoot" class="flex-1 min-h-0 overflow-y-auto">
      <p v-if="grouped" class="qs-type-description text-muted-foreground m-0 px-3 py-2 border-b">
        {{ t('slhReconciliation.detail.groupNotice') }}
      </p>
      <!-- 空态分两种：批次真的没有成员行，与筛选后没有命中——前者是数据，后者是视图。 -->
      <p v-if="items.length === 0" class="qs-type-description text-muted-foreground m-0 px-3 py-6 text-center">
        {{ t(filtered ? 'slhReconciliation.detail.emptyFiltered' : 'slhReconciliation.detail.emptyMembers') }}
      </p>

      <template v-else>
        <template v-for="item in items" :key="item.key">
          <!-- 分组头吸顶：长列表滚到组中段时仍要知道自己在哪个桶。 -->
          <div v-if="item.kind === 'group'" class="px-3 py-1.5 border-y bg-muted flex gap-2 items-center top-0 sticky z-10">
            <span class="qs-type-component-title m-0">{{ item.label }}</span>
            <span class="qs-type-description text-muted-foreground tabular-nums">
              {{ t('slhReconciliation.detail.listCount', { count: item.count ?? 0 }) }}
            </span>
          </div>
          <div
            v-else-if="item.row"
            :data-line-id="item.row.key"
            class="px-3 py-2 border-l-2 flex gap-2 cursor-pointer items-start hover:bg-muted/30"
            :class="selectedLineId === item.row.key ? 'border-primary bg-primary/5' : 'border-transparent'"
            @click="emit('select', item.row.key)"
          >
            <FaCheckbox
              v-if="isCheckable(item.row.key)"
              class="mt-0.5"
              :model-value="checkedLineIds.has(item.row.key)"
              :aria-label="t('slhReconciliation.detail.selectLine', { line: item.row.comparison.lineNumber })"
              @click.stop
              @update:model-value="(value: unknown) => onCheck(item.row!.key, value === true)"
            />
            <div class="flex-1 min-w-0">
              <div class="flex gap-2 items-center">
                <span class="font-medium tabular-nums">{{ item.row.comparison.lineNumber }}</span>
                <span class="qs-type-description text-muted-foreground font-mono truncate">{{ item.row.member.matchedContainerBatchName }}</span>
                <span class="qs-type-description truncate">{{ item.row.member.goodsName }}</span>
                <div class="flex-1" />
                <!-- 筛选某桶时只报该桶的处数，否则数字描述的不是当前视野。 -->
                <span v-if="activeBucket !== 'all'" class="qs-type-status-tag tabular-nums" :class="bucketCountOf(item.row) > 0 ? 'text-destructive' : 'text-muted-foreground'">
                  {{ t('slhReconciliation.detail.bucketDifferenceCount', { count: bucketCountOf(item.row) }) }}
                </span>
                <template v-else>
                  <span v-if="item.row.comparison.conflictCount > 0" class="text-destructive qs-type-status-tag tabular-nums">
                    {{ t('slhReconciliation.detail.conflictCount', { count: item.row.comparison.conflictCount }) }}
                  </span>
                  <span v-if="item.row.comparison.gapCount > 0" class="text-muted-foreground qs-type-status-tag tabular-nums">
                    {{ t('slhReconciliation.detail.gapCount', { count: item.row.comparison.gapCount }) }}
                  </span>
                  <span v-if="item.row.comparison.findingCount > 0" class="qs-type-status-tag tabular-nums">
                    {{ t('slhReconciliation.detail.feeFindingCount', { count: item.row.comparison.findingCount }) }}
                  </span>
                  <span v-if="item.row.comparison.buckets.length === 0" class="qs-type-description text-muted-foreground">
                    {{ t('slhReconciliation.detail.diffNone') }}
                  </span>
                </template>
                <span class="qs-type-description text-muted-foreground whitespace-nowrap">
                  {{ item.row.member.reconciledAt === null ? t('slhReconciliation.detail.notReconciledYet') : t('slhReconciliation.detail.reconciledShort') }}
                </span>
              </div>
              <!-- 分组视图里行已经按桶归位，再挂桶标签是重复信息。 -->
              <div v-if="!grouped && item.row.comparison.buckets.length > 0" class="mt-1 flex flex-wrap gap-1">
                <FaTag v-for="bucket in item.row.comparison.buckets" :key="bucket" variant="outline" class="qs-type-status-tag">
                  {{ bucketLabel(bucket) }}
                </FaTag>
              </div>
            </div>
          </div>
        </template>
      </template>
    </div>
  </section>
</template>
