<script setup lang="ts">
import type { TableSortingState } from '@fantastic-admin/components'
import type { FundTransactionDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'

import {
  formatFundRateSnapshot,
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
  items: FundTransactionDto[]
  loading: boolean
  total: number
}>(), {
  error: undefined,
})

const emit = defineEmits<{
  detail: [transaction: FundTransactionDto]
  paginationChange: [pagination: { page: number, pageSize: number }]
  retry: []
  sortingChange: [sorting: TableSortingState]
}>()
const { auth } = useAppAuth()
const router = useRouter()

/**
 * 来源单号只有“服务端给了单据身份 + 当前角色有该详情路由权限”时才渲染成链接；
 * 其余情况保持纯文本，避免财务点进无权限页面。
 */
function sourceLink(transaction: FundTransactionDto) {
  const target = getFundSourceLinkTarget(transaction.source)
  return target !== null && auth(target.permission) ? target : null
}

function openSourceLink(transaction: FundTransactionDto): void {
  const target = sourceLink(transaction)
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

const batchKindTagClasses: Record<FundTransactionDto['batchKind'], string> = {
  BUSINESS: tagToneClasses.blue,
  MANUAL_ADJUSTMENT: tagToneClasses.purple,
  REVERSAL: tagToneClasses.orange,
}

const reversalStatusTagClasses: Record<FundTransactionDto['reversalStatus'], string> = {
  FULL: tagToneClasses.red,
  NONE: tagToneClasses.green,
  NOT_APPLICABLE: tagToneClasses.orange,
  PARTIAL: tagToneClasses.amber,
}

const businessCategoryTagClasses: Record<FundTransactionDto['businessCategory'], string> = {
  ADJUSTMENT: tagToneClasses.purple,
  COST: tagToneClasses.red,
  NEUTRAL: tagToneClasses.slate,
  REVENUE: tagToneClasses.green,
}

const columns: QsGenericTableColumn<FundTransactionDto>[] = [
  { accessorKey: 'batchNo', fixed: 'left', id: 'batch', minWidth: 185, title: '批次' },
  {
    accessorFn: transaction => transaction.account.user?.displayName ?? '公司资金账户',
    id: 'subject',
    minWidth: 210,
    title: '账户主体',
  },
  { accessorKey: 'postingTypeName', id: 'typeCategory', minWidth: 280, title: '类型 / 分类' },
  { accessorKey: 'businessSourceName', id: 'source', minWidth: 190, title: '业务来源' },
  {
    accessorKey: 'amount',
    align: 'right',
    id: 'amount',
    minWidth: 300,
    sortable: true,
    title: '方向 / 金额',
  },
  {
    accessorKey: 'balanceAfter',
    align: 'right',
    id: 'balance',
    minWidth: 220,
    title: '动账前后余额',
  },
  {
    accessorKey: 'userShareRateSnapshot',
    align: 'right',
    id: 'shareRate',
    minWidth: 180,
    title: '比例快照',
  },
  {
    accessorFn: transaction => transaction.source?.headline
      ?? transaction.businessNo
      ?? transaction.businessId,
    id: 'business',
    minWidth: 240,
    title: '业务来源',
  },
  {
    accessorKey: 'businessOccurredAt',
    id: 'businessOccurredAt',
    minWidth: 190,
    sortable: true,
    title: '发生时间',
  },
  {
    accessorKey: 'postedAt',
    id: 'postedAt',
    minWidth: 190,
    sortable: true,
    title: '入账时间',
  },
]
</script>

<template>
  <QsGenericTable
    v-model:page="page"
    v-model:page-size="pageSize"
    v-model:sorting="sorting"
    data-testid="fund-transaction-table"
    row-key="entryId"
    :action-column="{ fixed: 'right', minWidth: 84, width: 84 }"
    :addable="false"
    :columns="columns"
    :data="items"
    empty-title="暂无资金流水"
    empty-description="当前服务端筛选条件下没有可展示的账户流水。"
    :error="error"
    :loading="loading"
    :page-size-options="[20, 50, 100]"
    :searchable="false"
    :show-column-settings="true"
    :total="total"
    table-class="min-w-[2030px]"
    @pagination-change="emit('paginationChange', $event)"
    @retry="emit('retry')"
    @sorting-change="emit('sortingChange', $event)"
  >
    <template #cell-batch="{ row }">
      <div class="min-w-0">
        <div class="qs-type-data-emphasis break-all">
          {{ row.original.batchNo }}
        </div>
        <div class="mt-1 flex flex-wrap gap-1.5 items-center">
          <FaTag variant="outline" class="qs-type-status-tag" :class="batchKindTagClasses[row.original.batchKind]">
            {{ getFundBatchKindLabel(row.original.batchKind) }}
          </FaTag>
          <FaTag v-if="row.original.reversalStatus !== 'NOT_APPLICABLE'" variant="outline" class="qs-type-status-tag" :class="reversalStatusTagClasses[row.original.reversalStatus]">
            {{ getFundReversalStatusLabel(row.original.reversalStatus) }}
          </FaTag>
        </div>
      </div>
    </template>

    <template #cell-subject="{ row }">
      <div class="flex flex-wrap gap-2 min-w-0 items-center">
        <QsPersonDisplay
          v-if="row.original.account.user"
          :display-name="row.original.account.user.displayName"
          size="md" :avatar-url="row.original.account.user.avatarUrl"
        />
        <span v-else class="font-medium">公司资金账户</span>
        <FaTag variant="outline" class="qs-type-status-tag">
          {{ row.original.accountTarget === 'USER' ? '用户账户' : '公司账户' }}
        </FaTag>
      </div>
    </template>

    <template #cell-typeCategory="{ row }">
      <div class="min-w-0">
        <div class="font-medium break-words">
          {{ row.original.postingTypeName }}
        </div>
        <div class="mt-1 flex flex-wrap gap-2 items-center">
          <code class="qs-type-meta break-all">{{ row.original.postingTypeCode }}</code>
          <FaTag variant="outline" class="qs-type-status-tag" :class="businessCategoryTagClasses[row.original.businessCategory]">
            {{ getFundBusinessCategoryLabel(row.original.businessCategory) }}
          </FaTag>
        </div>
      </div>
    </template>

    <template #cell-source="{ row }">
      <div class="min-w-0">
        <div class="break-words">
          {{ row.original.businessSourceName }}
        </div>
        <code class="qs-type-meta mt-1 block break-all">{{ row.original.businessSourceCode }}</code>
      </div>
    </template>

    <template #cell-amount="{ row }">
      <div class="flex flex-nowrap gap-2 items-center justify-end">
        <span :class="getFundDirectionState(row.original.direction).tone === 'debit' ? 'text-destructive' : 'text-primary'" class="font-semibold shrink-0 whitespace-nowrap">{{ getFundDirectionState(row.original.direction).sign }} {{ getFundDirectionState(row.original.direction).label }}</span>
        <span class="shrink-0 whitespace-nowrap">
          <AmountDisplay :value="row.original.amount" currency="CNY" :currencies="currencies" />
        </span>
      </div>
    </template>

    <template #cell-balance="{ row }">
      <div class="gap-1 grid justify-items-end">
        <AmountDisplay :value="row.original.balanceBefore" currency="CNY" :currencies="currencies" />
        <span class="qs-type-meta">变更为</span>
        <AmountDisplay :value="row.original.balanceAfter" currency="CNY" :currencies="currencies" />
      </div>
    </template>

    <template #cell-shareRate="{ row }">
      <div class="gap-1 grid justify-items-end">
        <span class="qs-type-data">用户 {{ formatFundRateSnapshot(row.original.userShareRateSnapshot) }}</span>
        <span class="qs-type-data">公司 {{ formatFundRateSnapshot(row.original.companyShareRateSnapshot) }}</span>
      </div>
    </template>

    <template #cell-business="{ row }">
      <div class="min-w-0">
        <!-- 第一行：来源主标题，直接回答“这笔钱是为什么动的”。 -->
        <button
          v-if="sourceLink(row.original)"
          type="button"
          class="qs-type-data-emphasis text-left underline-offset-4 break-words focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 hover:underline"
          @click="openSourceLink(row.original)"
        >
          {{ row.original.source?.headline ?? row.original.businessNo ?? '—' }}
        </button>
        <div v-else class="qs-type-data-emphasis break-words">
          {{ row.original.source?.headline ?? row.original.businessNo ?? '—' }}
        </div>
        <!-- 第二行：来源单号 + 客户/供应商。 -->
        <p class="qs-type-meta text-muted-foreground m-0 mt-1 flex flex-wrap gap-x-2 items-center">
          <span class="qs-type-data-mono break-all">
            {{ row.original.source?.documentNo ?? row.original.businessNo ?? '—' }}
          </span>
          <span v-if="row.original.source?.customerName" class="break-words">
            {{ row.original.source.customerName }}
          </span>
          <span v-if="row.original.source?.supplierName" class="break-words">
            {{ row.original.source.supplierName }}
          </span>
        </p>
        <!-- 第三行：结构化细节（付款阶段、分摊目标等），最多两行。 -->
        <p
          v-if="row.original.source?.details.length"
          class="qs-type-meta m-0 mt-1 break-words line-clamp-2"
        >
          {{ row.original.source.details.map(item => `${item.label}：${item.value}`).join(' · ') }}
        </p>
        <p
          v-else
          class="qs-type-meta m-0 mt-1 break-words line-clamp-2"
        >
          {{ row.original.summary }}
        </p>
      </div>
    </template>

    <template #cell-businessOccurredAt="{ row }">
      <DateTimeDisplay :value="row.original.businessOccurredAt" />
    </template>
    <template #cell-postedAt="{ row }">
      <DateTimeDisplay :value="row.original.postedAt" />
    </template>

    <template #actions="{ row, rowNumber }">
      <FaButton variant="ghost" size="sm" class="min-h-11 sm:min-h-9" :aria-label="`查看第 ${rowNumber} 行批次 ${row.batchNo} 的详情`" @click="emit('detail', row)">
        详情
      </FaButton>
    </template>

    <template #mobile-row="{ row, rowNumber }">
      <article data-testid="fund-transaction-card" class="gap-4 grid min-w-0">
        <header class="pb-3 border-b border-border flex gap-3 min-w-0 items-start justify-between">
          <div class="min-w-0">
            <div class="qs-type-data-emphasis break-all">
              {{ row.batchNo }}
            </div>
            <div class="mt-1 flex flex-wrap gap-1.5 items-center">
              <FaTag variant="outline" class="qs-type-status-tag" :class="batchKindTagClasses[row.batchKind]">
                {{ getFundBatchKindLabel(row.batchKind) }}
              </FaTag>
              <FaTag v-if="row.reversalStatus !== 'NOT_APPLICABLE'" variant="outline" class="qs-type-status-tag" :class="reversalStatusTagClasses[row.reversalStatus]">
                {{ getFundReversalStatusLabel(row.reversalStatus) }}
              </FaTag>
            </div>
          </div>
          <span class="qs-type-meta shrink-0 tabular-nums">#{{ rowNumber }}</span>
        </header>

        <div class="flex flex-wrap gap-3 items-start justify-between">
          <div class="flex flex-wrap gap-2 min-w-0 items-center">
            <QsPersonDisplay
              v-if="row.account.user"
              :display-name="row.account.user.displayName"
              size="md" :avatar-url="row.account.user.avatarUrl"
            />
            <span v-else class="font-medium">公司资金账户</span>
            <FaTag variant="outline" class="qs-type-status-tag">
              {{ row.accountTarget === 'USER' ? '用户账户' : '公司账户' }}
            </FaTag>
          </div>
          <div class="flex flex-wrap gap-2 items-center justify-end">
            <span :class="getFundDirectionState(row.direction).tone === 'debit' ? 'text-destructive' : 'text-primary'" class="font-semibold">{{ getFundDirectionState(row.direction).sign }} {{ getFundDirectionState(row.direction).label }}</span>
            <AmountDisplay :value="row.amount" currency="CNY" :currencies="currencies" />
          </div>
        </div>

        <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-2 max-[479px]:grid-cols-1">
          <div>
            <dt class="qs-type-compact-label mb-1">
              类型 / 分类
            </dt><dd class="m-0">
              <span>{{ row.postingTypeName }}</span>
              <div class="mt-1">
                <FaTag variant="outline" class="qs-type-status-tag" :class="businessCategoryTagClasses[row.businessCategory]">
                  {{ getFundBusinessCategoryLabel(row.businessCategory) }}
                </FaTag>
              </div>
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              业务来源
            </dt><dd class="m-0">
              {{ row.businessSourceName }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              动账前余额
            </dt><dd class="m-0">
              <AmountDisplay :value="row.balanceBefore" currency="CNY" :currencies="currencies" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              动账后余额
            </dt><dd class="m-0">
              <AmountDisplay :value="row.balanceAfter" currency="CNY" :currencies="currencies" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              比例快照
            </dt><dd class="qs-type-data m-0">
              用户 {{ formatFundRateSnapshot(row.userShareRateSnapshot) }} / 公司 {{ formatFundRateSnapshot(row.companyShareRateSnapshot) }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              业务来源
            </dt><dd class="qs-type-data-emphasis m-0 break-words">
              {{ row.source?.headline ?? row.businessNo ?? '—' }}
            </dd>
            <dd class="qs-type-meta m-0 mt-1 break-all">
              {{ row.source?.documentNo ?? row.businessNo ?? '—' }}
              <template v-if="row.source?.customerName">
                · {{ row.source.customerName }}
              </template>
              <template v-if="row.source?.supplierName">
                · {{ row.source.supplierName }}
              </template>
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              发生时间
            </dt><dd class="m-0">
              <DateTimeDisplay :value="row.businessOccurredAt" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              入账时间
            </dt><dd class="m-0">
              <DateTimeDisplay :value="row.postedAt" />
            </dd>
          </div>
        </dl>
      </article>
    </template>
  </QsGenericTable>
</template>
