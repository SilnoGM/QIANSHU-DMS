<script setup lang="ts">
import type { TableSortingState } from '@fantastic-admin/components'
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

const page = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })
const sorting = defineModel<TableSortingState>('sorting', { required: true })

const tagToneClasses = {
  blue: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:border-sky-500/30! dark:bg-sky-500/10! dark:text-sky-300',
  green: 'border-primary/30 bg-primary/10 text-primary dark:border-green-500/30! dark:bg-green-500/10! dark:text-green-300',
  purple: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:border-violet-500/30! dark:bg-violet-500/10! dark:text-violet-300',
  orange: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:border-orange-500/30! dark:bg-orange-500/10! dark:text-orange-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-500/30! dark:bg-amber-500/10! dark:text-amber-300',
  red: 'border-destructive/30 bg-destructive/10 text-destructive dark:border-destructive/30! dark:bg-destructive/10!',
  slate: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:border-slate-500/30! dark:bg-slate-500/10! dark:text-slate-300',
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

const businessCategoryTagClasses: Record<FundBatchGroupDto['businessCategory'], string> = {
  ADJUSTMENT: tagToneClasses.purple,
  COST: tagToneClasses.red,
  NEUTRAL: tagToneClasses.slate,
  REVENUE: tagToneClasses.green,
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
    data-testid="fund-transaction-table"
    row-key="id"
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
    <!-- 分组行：一个批次一行，批次级操作与来源说明都在这里。 -->
    <template #group-header="{ row }">
      <div v-if="groupOf(row)" class="min-w-0 w-full space-y-2">
        <div class="flex flex-wrap gap-x-4 gap-y-2 items-center justify-between">
          <div class="flex flex-wrap gap-2 min-w-0 items-center">
            <span class="qs-type-data-emphasis break-all">{{ groupOf(row)!.batchNo }}</span>
            <FaTag variant="outline" class="qs-type-status-tag" :class="batchKindTagClasses[groupOf(row)!.batchKind]">
              {{ getFundBatchKindLabel(groupOf(row)!.batchKind) }}
            </FaTag>
            <FaTag
              v-if="groupOf(row)!.reversalStatus !== 'NOT_APPLICABLE'"
              variant="outline"
              class="qs-type-status-tag"
              :class="reversalStatusTagClasses[groupOf(row)!.reversalStatus]"
            >
              {{ getFundReversalStatusLabel(groupOf(row)!.reversalStatus) }}
            </FaTag>
            <FaTag variant="outline" class="qs-type-status-tag" :class="businessCategoryTagClasses[groupOf(row)!.businessCategory]">
              {{ getFundBusinessCategoryLabel(groupOf(row)!.businessCategory) }}
            </FaTag>
          </div>
          <div class="flex flex-wrap gap-2 items-center">
            <span class="qs-type-meta text-muted-foreground">业务金额</span>
            <AmountDisplay :value="groupOf(row)!.businessAmount" currency="CNY" :currencies="currencies" class="!text-base !font-semibold" />
            <span class="qs-type-meta text-muted-foreground">共 {{ groupOf(row)!.entries.length }} 条分录</span>
            <FaButton variant="ghost" size="sm" class="min-h-11 sm:min-h-9" @click="emit('detail', groupOf(row)!)">
              详情
            </FaButton>
          </div>
        </div>

        <div class="text-sm flex flex-wrap gap-x-5 gap-y-1 items-center">
          <button
            v-if="sourceLink(groupOf(row)!)"
            type="button"
            class="font-medium text-left underline-offset-4 break-words focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 hover:underline"
            @click="openSourceLink(groupOf(row)!)"
          >
            {{ groupOf(row)!.source?.headline ?? groupOf(row)!.businessNo ?? '—' }}
          </button>
          <span v-else class="font-medium break-words">
            {{ groupOf(row)!.source?.headline ?? groupOf(row)!.businessNo ?? '—' }}
          </span>
          <span class="qs-type-meta text-muted-foreground break-all">
            {{ groupOf(row)!.source?.documentNo ?? groupOf(row)!.businessNo ?? '—' }}
          </span>
          <span v-if="groupOf(row)!.source?.customerName" class="qs-type-meta text-muted-foreground">
            客户：{{ groupOf(row)!.source?.customerName }}
          </span>
          <span v-if="groupOf(row)!.source?.supplierName" class="qs-type-meta text-muted-foreground">
            供应商：{{ groupOf(row)!.source?.supplierName }}
          </span>
          <span class="qs-type-meta text-muted-foreground">{{ groupOf(row)!.postingTypeName }}</span>
          <span class="qs-type-meta text-muted-foreground">{{ groupOf(row)!.businessSourceName }}</span>
          <DateTimeDisplay :value="groupOf(row)!.businessOccurredAt" class="qs-type-meta text-muted-foreground" />
        </div>
      </div>
    </template>

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
      <div class="gap-1 grid justify-items-end">
        <AmountDisplay :value="entryOf(row)!.balanceBefore" currency="CNY" :currencies="currencies" />
        <span class="qs-type-meta">变更为</span>
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
