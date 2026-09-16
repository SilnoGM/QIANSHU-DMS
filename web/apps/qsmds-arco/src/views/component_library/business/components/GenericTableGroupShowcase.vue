<i18n lang="yaml">
zh-cn:
  title: 按批次分组
  description: 每个批次包含两笔明细，整组分页与排序；折叠后，当前页金额汇总保持不变。
  dataset: 展示数据
  all: 全部 24 个批次
  subset: 前 4 个批次
  empty: 空数据
  expandAll: 全部展开
  collapseAll: 全部收起
  groupCount: 当前页 {count} 个批次
  childCount: '{count} 笔明细'
  groupNumber: 第 {number} 组
  name: 明细名称
  amount: 金额
  status: 状态
  pending: 待核对
  completed: 已核对
  basicService: 基础服务
  deliveryService: 配送服务
  search: 搜索批次编号或明细名称
  paginationUnit: 个批次
  view: 查看
  viewLabel: 查看 {group} 的{row}
  lastAction: 已选择：{group} · {row}
  initialAction: 点击明细的“查看”可核对分组与子行信息。
</i18n>

<script setup lang="ts">
import type { TableExpandedState, TableSortingState } from '@fantastic-admin/components'
import type { QsGenericTableColumn, QsGenericTableGrouping } from '@/components/business/QsGenericTable/logic'
import Decimal from 'decimal.js'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { sumMoneyValues } from '@/components/base/MoneyInput/logic'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { SHOWCASE_CURRENCIES } from '../../shared/currency.fixture'

defineOptions({ name: 'GenericTableGroupShowcase' })

interface GroupRow {
  amount: string
  children?: GroupRow[]
  id: string
  name: string
  status: 'pending' | 'completed'
}

const { t } = useI18n()

// 父组和子行使用同一行类型，ID 各自稳定；金额在生成时收敛为两位小数字符串。
const sourceGroups = computed<GroupRow[]>(() => Array.from({ length: 24 }, (_, index) => {
  const sequence = index + 1
  const children: GroupRow[] = [
    {
      id: `detail-${sequence}-basic`,
      name: t('basicService'),
      amount: new Decimal('860.25').plus(new Decimal('37.50').times(index)).toFixed(2),
      status: index % 3 === 0 ? 'completed' : 'pending',
    },
    {
      id: `detail-${sequence}-delivery`,
      name: t('deliveryService'),
      amount: new Decimal('128.50').plus(new Decimal('12.25').times(index)).toFixed(2),
      status: 'pending',
    },
  ]
  return {
    id: `batch-${sequence}`,
    name: `BATCH/202609-${String(sequence).padStart(4, '0')}`,
    amount: sumMoneyValues(children.map(row => row.amount), { precision: 2 }),
    status: 'pending',
    children,
  }
}))

const page = ref(1)
const pageSize = ref(20)
const search = ref('')
const sorting = ref<TableSortingState>([])
const expanded = ref<TableExpandedState>(true)
const dataset = ref('all')
const selectedDetail = ref<{ group: string, row: string }>()
const datasetOptions = computed(() => ['all', 'subset', 'empty'].map(value => ({
  label: t(value),
  value,
})))
const grouping: QsGenericTableGrouping<GroupRow> = {
  getRows: group => group.children ?? [],
  getLabel: group => group.name,
}
const columns = computed<QsGenericTableColumn<GroupRow>[]>(() => [
  { id: 'name', accessorKey: 'name', title: t('name'), width: 240, sortable: true },
  {
    id: 'amount',
    accessorKey: 'amount',
    title: t('amount'),
    align: 'right',
    width: 180,
    sortable: true,
    summary: {
      type: 'sum',
      component: AmountDisplay,
      componentProps: { currency: 'CNY', currencies: SHOWCASE_CURRENCIES },
    },
  },
  { id: 'status', accessorKey: 'status', title: t('status'), width: 140 },
])

const filteredGroups = computed(() => {
  const groups = dataset.value === 'empty'
    ? []
    : dataset.value === 'subset'
      ? sourceGroups.value.slice(0, 4)
      : sourceGroups.value
  const keyword = search.value.trim().toLocaleLowerCase('zh-CN')
  return groups.filter(group => !keyword
    || [group.name, ...group.children!.map(row => row.name)]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(keyword)))
})
const sortedGroups = computed(() => [...filteredGroups.value].sort((left, right) => {
  for (const rule of sorting.value) {
    const result = rule.id === 'amount'
      ? new Decimal(left.amount).comparedTo(right.amount)
      : left.name.localeCompare(right.name, 'zh-CN')
    if (result !== 0) {
      return rule.desc ? -result : result
    }
  }
  return 0
}))
const pageGroups = computed(() => sortedGroups.value.slice(
  (page.value - 1) * pageSize.value,
  page.value * pageSize.value,
))
const summaryValues = computed(() => ({
  // 只累计子行；父组金额仅供组头展示，折叠状态不参与汇总计算。
  amount: sumMoneyValues(pageGroups.value.flatMap(group => group.children!.map(row => row.amount)), { precision: 2 }),
}))
const actionText = computed(() => selectedDetail.value ? t('lastAction', selectedDetail.value) : t('initialAction'))

watch(dataset, () => {
  page.value = 1
  selectedDetail.value = undefined
})
</script>

<template>
  <section aria-labelledby="generic-table-group-title" class="mt-6 p-5 border border-border rounded-xl bg-background sm-p-7">
    <div class="flex flex-wrap gap-4 items-start justify-between">
      <div class="min-w-0">
        <h3 id="generic-table-group-title" class="text-xl font-semibold m-0">
          {{ t('title') }}
        </h3>
        <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
          {{ t('description') }}
        </p>
      </div>
      <FaTag variant="secondary">
        QsGenericTable · grouping
      </FaTag>
    </div>

    <div class="mt-5 flex flex-wrap gap-2 items-center">
      <FaSelect v-model="dataset" :options="datasetOptions" :aria-label="t('dataset')" class="w-full sm-w-44" />
      <FaButton variant="outline" size="sm" @click="expanded = true">
        <FaIcon name="i-lucide:chevrons-up-down" />
        {{ t('expandAll') }}
      </FaButton>
      <FaButton variant="outline" size="sm" @click="expanded = {}">
        <FaIcon name="i-lucide:chevrons-down-up" />
        {{ t('collapseAll') }}
      </FaButton>
      <span class="qs-type-meta text-muted-foreground sm-ml-auto">{{ t('groupCount', { count: pageGroups.length }) }}</span>
    </div>

    <QsGenericTable
      v-model:page="page"
      v-model:page-size="pageSize"
      v-model:search="search"
      v-model:sorting="sorting"
      v-model:expanded="expanded"
      row-key="id"
      class="mt-4"
      :columns="columns"
      :data="pageGroups"
      :grouping="grouping"
      :summary-values="summaryValues"
      :total="sortedGroups.length"
      :addable="false"
      :action-column="{ width: 104 }"
      :page-size-options="[20, 50]"
      :search-placeholder="t('search')"
      :pagination-unit="t('paginationUnit')"
    >
      <template #group-header="{ row, rows, rowNumber }">
        <div class="flex flex-wrap gap-x-4 gap-y-1 min-w-0 w-full items-center">
          <span class="qs-type-meta text-muted-foreground">{{ t('groupNumber', { number: rowNumber }) }}</span>
          <strong class="qs-type-data-emphasis break-all">{{ row.name }}</strong>
          <span class="qs-type-meta text-muted-foreground">{{ t('childCount', { count: rows.length }) }}</span>
          <AmountDisplay :value="row.amount" :currencies="SHOWCASE_CURRENCIES" currency="CNY" class="sm-ml-auto" />
        </div>
      </template>
      <template #cell-amount="{ row }">
        <AmountDisplay :value="row.original.amount" :currencies="SHOWCASE_CURRENCIES" currency="CNY" />
      </template>
      <template #cell-status="{ row }">
        <FaTag :variant="row.original.status === 'completed' ? 'secondary' : 'outline'" class="qs-type-status-tag">
          {{ t(row.original.status) }}
        </FaTag>
      </template>
      <template #actions="{ row, group }">
        <FaButton
          v-if="group"
          variant="ghost"
          size="sm"
          :aria-label="t('viewLabel', { group: group.name, row: row.name })"
          @click="selectedDetail = { group: group.name, row: row.name }"
        >
          <FaIcon name="i-lucide:eye" />
          {{ t('view') }}
        </FaButton>
      </template>
      <template #mobile-row="{ row }">
        <div class="flex gap-3 items-start justify-between">
          <span class="qs-type-body font-medium">{{ row.name }}</span>
          <FaTag :variant="row.status === 'completed' ? 'secondary' : 'outline'" class="qs-type-status-tag shrink-0">
            {{ t(row.status) }}
          </FaTag>
        </div>
        <dl class="m-0 mt-3 flex gap-3 items-center justify-between">
          <dt class="qs-type-compact-label">
            {{ t('amount') }}
          </dt>
          <dd class="m-0">
            <AmountDisplay :value="row.amount" :currencies="SHOWCASE_CURRENCIES" currency="CNY" />
          </dd>
        </dl>
      </template>
    </QsGenericTable>

    <p role="status" class="qs-type-meta text-muted-foreground m-0 mt-3 break-words">
      {{ actionText }}
    </p>
  </section>
</template>
