<script setup lang="ts">
import type { TableExpandedState, TableSortingState } from '@fantastic-admin/components'
import type {
  FundBatchGroupDto,
  FundTransactionEntryDto,
} from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import type { QsGenericTableColumn, QsGenericTableGrouping } from '@/components/business/QsGenericTable/logic'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'

import {
  getFundBatchKindLabel,
  getFundBusinessCategoryLabel,
  getFundDirectionState,
  getFundReversalStatusLabel,
  getFundSourceLinkTarget,
} from './fund-transaction.logic'

defineOptions({ name: 'FundTransactionTable' })

withDefaults(defineProps<{
  currencies: readonly CurrencyDescriptor[]
  error?: string
  items: FundLedgerRow[]
  loading: boolean
  total: number
}>(), {
  error: undefined,
})

const emit = defineEmits<{
  detail: [group: FundBatchGroupDto]
  paginationChange: [pagination: { page: number, pageSize: number }]
  retry: []
  sortingChange: [sorting: TableSortingState]
}>()

/** 父行是批次，子行是分录；表格泛型需要同一个类型，靠收窄函数在单元格里区分。 */
type FundLedgerRow = FundBatchGroupDto | FundTransactionEntryDto

function asGroup(row: FundLedgerRow): FundBatchGroupDto {
  return row as FundBatchGroupDto
}

function asEntry(row: FundLedgerRow): FundTransactionEntryDto {
  return row as FundTransactionEntryDto
}

/** 分组行才带 entries；分组头插槽拿到的是原始数据，不是 TanStack 的 Row 包装。 */
function groupOf(row: FundLedgerRow): FundBatchGroupDto | null {
  return 'entries' in row ? row : null
}

/** 移动端插槽拿到的是原始数据；只有分录行才渲染卡片。 */
function entryData(row: FundLedgerRow): FundTransactionEntryDto | null {
  return 'entryId' in row ? row : null
}

/** 单元格插槽拿到的是 Row 包装，需要先取 original 再收窄。 */
function entryOf(row: { readonly original: FundLedgerRow }): FundTransactionEntryDto | null {
  return 'entryId' in row.original ? row.original : null
}

const { auth } = useAppAuth()
const router = useRouter()

/**
 * 来源单号只有“服务端给了单据身份 + 当前角色有该详情路由权限”时才渲染成链接；
 * 其余情况保持纯文本，避免财务点进无权限页面。
 */
function sourceLink(group: FundBatchGroupDto) {
  const target = getFundSourceLinkTarget(group.source)
  return target !== null && auth(target.permission) ? target : null
}

function openSourceLink(group: FundBatchGroupDto): void {
  const target = sourceLink(group)
  if (target !== null) {
    void router.push({ name: target.name, params: { id: target.id } })
  }
}

/**
 * 主行标题：主体 · 动作。主体优先用结构化字段，其次客户/供应商，
 * 都没有时退回 headline 整句，保证历史未回填行不会空白。
 */
function mainTitle(group: FundBatchGroupDto): string {
  const subject = group.source?.subjectName
    ?? group.source?.customerName
    ?? group.source?.supplierName
    ?? null
  const action = group.source?.actionLabel ?? null
  if (subject !== null && action !== null) {
    return `${subject} · ${action}`
  }
  if (action !== null) {
    return action
  }
  return group.source?.headline ?? group.businessNo ?? group.batchNo
}

interface ShareBadge {
  readonly kind: 'COMPANY_ONLY' | 'SPLIT' | 'USER_ONLY'
  readonly user: { readonly displayName: string, readonly avatarUrl: string | null } | null
}

/**
 * 分摊归属：数据来自服务端的全量分录汇总，不受当前账户/方向筛选影响。
 * 只在收益与成本类展示——提款（中性）、管理员调账（调账）与冲账批次不显示，
 * 否则「用户独担」会被误读成成本承担方式。
 */
function shareBadge(group: FundBatchGroupDto): ShareBadge | null {
  if (group.batchKind === 'REVERSAL') {
    return null
  }
  if (group.businessCategory !== 'REVENUE' && group.businessCategory !== 'COST') {
    return null
  }

  const { hasUser, hasCompany, user } = group.shares
  if (hasUser && hasCompany) {
    return { kind: 'SPLIT', user }
  }
  if (hasCompany) {
    return { kind: 'COMPANY_ONLY', user: null }
  }
  if (hasUser) {
    return { kind: 'USER_ONLY', user }
  }
  return null
}

/** 副行只留单号；缺失时退回业务单号与批次号。 */
function secondaryDocument(group: FundBatchGroupDto): string {
  return group.source?.documentNo ?? group.businessNo ?? group.batchNo
}

function amountToneClass(group: FundBatchGroupDto): string {
  return group.businessAmount.trim().startsWith('-') ? 'text-destructive' : 'text-primary'
}

/** 金额固定带符号：出账为负、入账为正，与颜色一起表达方向。 */
function amountText(group: FundBatchGroupDto): string {
  const value = group.businessAmount.trim()
  return value.startsWith('-') ? value : `+${value}`
}

const page = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })
const sorting = defineModel<TableSortingState>('sorting', { required: true })
/**
 * 分组默认全部收起：财务先看批次列表，需要核对分录时再展开。
 * 空对象表示没有任何组处于展开状态（组件把 true 视为「全部展开」）。
 */
const expanded = ref<TableExpandedState>({})

const tagToneClasses = {
  blue: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:border-sky-500/30! dark:bg-sky-500/10! dark:text-sky-300',
  green: 'border-primary/30 bg-primary/10 text-primary dark:border-green-500/30! dark:bg-green-500/10! dark:text-green-300',
  purple: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:border-violet-500/30! dark:bg-violet-500/10! dark:text-violet-300',
  orange: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:border-orange-500/30! dark:bg-orange-500/10! dark:text-orange-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-500/30! dark:bg-amber-500/10! dark:text-amber-300',
  red: 'border-destructive/30 bg-destructive/10 text-destructive dark:border-destructive/30! dark:bg-destructive/10!',
  slate: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:border-slate-500/30! dark:bg-slate-500/10! dark:text-slate-300',
}

/** 分类用实色标签；amber-500 配白字对比度不足，成本统一压到 600。 */
const categorySolidClasses: Record<FundBatchGroupDto['businessCategory'], string> = {
  ADJUSTMENT: '!bg-violet-600 !text-white',
  COST: '!bg-amber-600 !text-white',
  NEUTRAL: '!bg-slate-500 !text-white',
  REVENUE: '!bg-primary !text-primary-foreground',
}

const batchKindTagClasses: Record<FundBatchGroupDto['batchKind'], string> = {
  BUSINESS: tagToneClasses.blue,
  MANUAL_ADJUSTMENT: tagToneClasses.purple,
  REVERSAL: tagToneClasses.orange,
}

const reversalStatusTagClasses: Record<FundBatchGroupDto['reversalStatus'], string> = {
  FULL: tagToneClasses.red,
  NONE: tagToneClasses.green,
  NOT_APPLICABLE: tagToneClasses.orange,
  PARTIAL: tagToneClasses.amber,
}

/**
 * 子行只保留分录级列：批次号、来源、类型、业务总额、发生时间都在分组行上，
 * 避免展开后同一条信息出现两遍。
 */
const columns: QsGenericTableColumn<FundLedgerRow>[] = [
  {
    accessorFn: row => asEntry(row).account.user?.displayName ?? '公司资金账户',
    id: 'subject',
    minWidth: 210,
    title: '账户主体',
  },
  {
    accessorFn: row => asEntry(row).amount,
    align: 'right',
    id: 'amount',
    minWidth: 260,
    sortable: true,
    title: '方向 / 金额',
  },
  {
    accessorFn: row => asEntry(row).balanceAfter,
    align: 'right',
    id: 'balance',
    minWidth: 220,
    title: '动账前后余额',
  },
  {
    accessorFn: row => asEntry(row).accountSequence,
    align: 'right',
    id: 'sequence',
    minWidth: 120,
    title: '分录序号',
  },
  {
    accessorFn: row => asEntry(row).postedAt,
    id: 'postedAt',
    minWidth: 190,
    sortable: true,
    title: '入账时间',
  },
]

/**
 * 操作列宽度同时用于三处：表头列、子行操作单元格、分组行右侧预留块。
 * 三者必须一致，否则「详情」会和操作列错位。
 */
const ACTION_COLUMN_WIDTH = 84
const actionColumn = {
  fixed: 'right' as const,
  minWidth: ACTION_COLUMN_WIDTH,
  width: ACTION_COLUMN_WIDTH,
}

/** 一个批次一行；`getRows` 直接展开该批次的分录。 */
const grouping: QsGenericTableGrouping<FundLedgerRow> = {
  getRows: row => asGroup(row).entries,
  getLabel: row => asGroup(row).batchNo,
}
</script>

<template>
  <QsGenericTable
    v-model:page="page"
    v-model:page-size="pageSize"
    v-model:sorting="sorting"
    v-model:expanded="expanded"
    data-testid="fund-transaction-table"
    row-key="id"
    :action-column="actionColumn"
    :addable="false"
    :columns="columns"
    :data="items"
    :grouping="grouping"
    empty-title="暂无资金流水"
    empty-description="当前服务端筛选条件下没有可展示的账户流水。"
    :error="error"
    :loading="loading"
    :page-size-options="[20, 50, 100]"
    :searchable="false"
    :show-column-settings="true"
    :total="total"
    table-class="min-w-[1080px]"
    pagination-unit="批次"
    @pagination-change="emit('paginationChange', $event)"
    @retry="emit('retry')"
    @sorting-change="emit('sortingChange', $event)"
  >
    <!--
      分组行：左侧是「主体 · 动作 + 分类」与「单号 · 时间 · 批次号」；
      右侧两行分别右对齐「金额 + 分录数」与「人员 + 分账」；
      最右是与操作列等宽的视觉预留块，放「详情」。
    -->
    <template #group-header="{ row }">
      <div v-if="groupOf(row)" class="flex gap-4 min-w-0 w-full items-start">
        <div class="flex-1 min-w-0 space-y-1.5">
          <div class="flex flex-wrap gap-2 min-w-0 items-center">
            <span class="text-sm/6 font-semibold break-words">{{ mainTitle(groupOf(row)!) }}</span>
            <FaTag
              variant="default"
              class="qs-type-status-tag border-transparent"
              :class="categorySolidClasses[groupOf(row)!.businessCategory]"
            >
              {{ getFundBusinessCategoryLabel(groupOf(row)!.businessCategory) }}
            </FaTag>
            <FaTag
              v-if="groupOf(row)!.batchKind !== 'BUSINESS'"
              variant="outline"
              class="qs-type-status-tag"
              :class="batchKindTagClasses[groupOf(row)!.batchKind]"
            >
              {{ getFundBatchKindLabel(groupOf(row)!.batchKind) }}
            </FaTag>
            <FaTag
              v-if="groupOf(row)!.reversalStatus === 'PARTIAL' || groupOf(row)!.reversalStatus === 'FULL'"
              variant="outline"
              class="qs-type-status-tag"
              :class="reversalStatusTagClasses[groupOf(row)!.reversalStatus]"
            >
              {{ getFundReversalStatusLabel(groupOf(row)!.reversalStatus) }}
            </FaTag>
          </div>

          <div class="qs-type-meta text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 items-center">
            <button
              v-if="sourceLink(groupOf(row)!)"
              type="button"
              class="text-left underline-offset-4 break-words focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 hover:underline"
              @click="openSourceLink(groupOf(row)!)"
            >
              {{ secondaryDocument(groupOf(row)!) }}
            </button>
            <span v-else class="break-all font-mono!">
              {{ secondaryDocument(groupOf(row)!) }}
            </span>
            <span aria-hidden="true">·</span>
            <DateTimeDisplay :value="groupOf(row)!.businessOccurredAt" />
            <span aria-hidden="true">·</span>
            <span class="break-all font-mono!">{{ groupOf(row)!.batchNo }}</span>
          </div>
        </div>

        <!-- 右对齐块：金额与条数在上，分摊归属在下。 -->
        <div class="text-right flex shrink-0 flex-col gap-1 items-end">
          <div class="flex flex-wrap gap-3 items-center justify-end">
            <AmountDisplay
              :value="amountText(groupOf(row)!)"
              currency="CNY"
              :currencies="currencies"
              :show-code="false"
              class="tabular-nums !text-base !font-semibold"
              :class="amountToneClass(groupOf(row)!)"
            />
            <span class="qs-type-meta text-muted-foreground tabular-nums">
              {{ groupOf(row)!.entries.length }} 条分录
            </span>
          </div>
          <span
            v-if="shareBadge(groupOf(row)!)"
            class="inline-flex shrink-0 gap-2 whitespace-nowrap items-center"
          >
            <QsPersonDisplay
              v-if="shareBadge(groupOf(row)!)!.user"
              :display-name="shareBadge(groupOf(row)!)!.user!.displayName"
              size="sm"
              :avatar-url="shareBadge(groupOf(row)!)!.user!.avatarUrl"
            />
            <span
              v-if="shareBadge(groupOf(row)!)!.kind === 'SPLIT'"
              class="qs-type-meta text-amber-600 font-medium dark:text-amber-400"
            >分账</span>
            <span
              v-else-if="shareBadge(groupOf(row)!)!.kind === 'COMPANY_ONLY'"
              class="qs-type-meta text-destructive font-semibold"
            >公司独担</span>
            <span
              v-else
              class="qs-type-meta text-destructive font-semibold"
            >用户独担</span>
          </span>
        </div>

        <!-- 视觉操作列：宽度与 actionColumn 保持一致。 -->
        <div
          class="flex shrink-0 items-start justify-end"
          :style="{ width: `${ACTION_COLUMN_WIDTH}px` }"
        >
          <FaButton variant="ghost" size="sm" class="min-h-11 sm:min-h-9" @click="emit('detail', groupOf(row)!)">
            详情
          </FaButton>
        </div>
      </div>
    </template>

    <!-- 子行不重复展示详情：批次级操作已经在分组行上。 -->
    <template #actions />

    <template #cell-subject="{ row }">
      <div class="flex flex-wrap gap-2 min-w-0 items-center">
        <QsPersonDisplay
          v-if="entryOf(row)?.account.user"
          :display-name="entryOf(row)!.account.user!.displayName"
          size="md" :avatar-url="entryOf(row)!.account.user!.avatarUrl"
        />
        <span v-else class="font-medium">公司资金账户</span>
        <FaTag variant="outline" class="qs-type-status-tag">
          {{ entryOf(row)?.accountTarget === 'USER' ? '用户账户' : '公司账户' }}
        </FaTag>
      </div>
    </template>

    <template #cell-amount="{ row }">
      <div class="flex flex-nowrap gap-2 items-center justify-end">
        <span :class="getFundDirectionState(entryOf(row)!.direction).tone === 'debit' ? 'text-destructive' : 'text-primary'" class="font-semibold shrink-0 whitespace-nowrap">{{ getFundDirectionState(entryOf(row)!.direction).sign }} {{ getFundDirectionState(entryOf(row)!.direction).label }}</span>
        <span class="shrink-0 whitespace-nowrap">
          <AmountDisplay :value="entryOf(row)!.amount" currency="CNY" :currencies="currencies" />
        </span>
      </div>
    </template>

    <template #cell-balance="{ row }">
      <!-- 余额变化压成一行：前值 → 后值；箭头颜色跟随方向，入账绿、出账红。 -->
      <div class="flex flex-nowrap gap-2 items-center justify-end tabular-nums">
        <AmountDisplay :value="entryOf(row)!.balanceBefore" currency="CNY" :currencies="currencies" />
        <span
          class="qs-type-meta font-semibold"
          :class="entryOf(row)!.direction === 'CREDIT' ? 'text-primary' : 'text-destructive'"
          aria-hidden="true"
        >→</span>
        <AmountDisplay :value="entryOf(row)!.balanceAfter" currency="CNY" :currencies="currencies" />
      </div>
    </template>

    <template #cell-postedAt="{ row }">
      <DateTimeDisplay :value="entryOf(row)!.postedAt" />
    </template>

    <!-- 移动端：分组头 + 分录卡片，字段只在分录层展示一次。 -->
    <template #mobile-row="{ row, rowNumber }">
      <article v-if="entryData(row)" data-testid="fund-transaction-card" class="gap-3 grid min-w-0">
        <div class="flex flex-wrap gap-2 min-w-0 items-center justify-between">
          <div class="flex flex-wrap gap-2 min-w-0 items-center">
            <QsPersonDisplay
              v-if="entryData(row)!.account.user"
              :display-name="entryData(row)!.account.user!.displayName"
              size="md" :avatar-url="entryData(row)!.account.user!.avatarUrl"
            />
            <span v-else class="font-medium">公司资金账户</span>
            <FaTag variant="outline" class="qs-type-status-tag">
              {{ entryData(row)!.accountTarget === 'USER' ? '用户账户' : '公司账户' }}
            </FaTag>
          </div>
          <span class="qs-type-meta shrink-0 tabular-nums">#{{ rowNumber }}</span>
        </div>

        <div class="flex flex-wrap gap-2 items-center justify-between">
          <span :class="getFundDirectionState(entryData(row)!.direction).tone === 'debit' ? 'text-destructive' : 'text-primary'" class="font-semibold">{{ getFundDirectionState(entryData(row)!.direction).sign }} {{ getFundDirectionState(entryData(row)!.direction).label }}</span>
          <AmountDisplay :value="entryData(row)!.amount" currency="CNY" :currencies="currencies" />
        </div>

        <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-2 max-[479px]:grid-cols-1">
          <div>
            <dt class="qs-type-compact-label mb-1">
              动账前余额
            </dt><dd class="m-0">
              <AmountDisplay :value="entryData(row)!.balanceBefore" currency="CNY" :currencies="currencies" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              动账后余额
            </dt><dd class="m-0">
              <AmountDisplay :value="entryData(row)!.balanceAfter" currency="CNY" :currencies="currencies" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              分录序号
            </dt><dd class="qs-type-data m-0">
              #{{ entryData(row)!.accountSequence }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              入账时间
            </dt><dd class="m-0">
              <DateTimeDisplay :value="entryData(row)!.postedAt" />
            </dd>
          </div>
        </dl>
      </article>
    </template>
  </QsGenericTable>
</template>
