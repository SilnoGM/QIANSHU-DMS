<script setup lang="ts">
import type { TableSortingState } from '@fantastic-admin/components'
import type { QsGenericTableColumn, QsGenericTableFilterDefinition, QsGenericTableFilterValues } from '@/components/business/QsGenericTable/logic'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'

defineOptions({ name: 'GenericTableShowcase' })

interface SettlementRow {
  amount: number
  completionRate: number
  id: string
  orderSource: '客户委托' | '平台订单' | '自然流订单'
  owner: string
  region: string
  route: string
  settlementNo: string
  shipmentCount: number
  standardAmount: number
  status: '待复核' | '已完成' | '已暂停'
  updatedAt: string
}

const orderSources: SettlementRow['orderSource'][] = ['自然流订单', '客户委托', '平台订单']
const owners = ['林舟', '陈念', '周衡', '苏遥', '顾言'] as const
const regions = ['华东', '华南', '华北', '西南'] as const
const routes = [
  '上海 → 吉隆坡',
  '深圳 → 新加坡',
  '宁波 → 洛杉矶',
  '青岛 → 鹿特丹',
  '厦门 → 台北',
] as const
const statuses: SettlementRow['status'][] = ['待复核', '已完成', '已暂停', '已完成']

/**
 * 组件库示例使用确定性本地数据，既能稳定复现分页和汇总结果，也不会把演示页
 * 接到真实业务 API。页面只验证组件输入输出，不模拟服务端权限与写入成功。
 */
const sourceRows: SettlementRow[] = Array.from({ length: 64 }, (_, index) => ({
  amount: 8_600 + index * 437.25,
  completionRate: 72 + (index * 7) % 27,
  id: `settlement-${index + 1}`,
  orderSource: orderSources[index % orderSources.length]!,
  owner: owners[index % owners.length]!,
  region: regions[index % regions.length]!,
  route: routes[index % routes.length]!,
  settlementNo: `QS-202607-${String(index + 1).padStart(4, '0')}`,
  shipmentCount: 6 + (index * 3) % 18,
  standardAmount: 9_600 + index * 437.25,
  status: statuses[index % statuses.length]!,
  updatedAt: new Date(Date.UTC(2026, 6, 20, 8 + (index % 8), 5 + index)).toISOString(),
}))

const columns: QsGenericTableColumn<SettlementRow>[] = [
  {
    accessorKey: 'settlementNo',
    fixed: 'left',
    id: 'settlementNo',
    sortable: true,
    summary: { type: 'count' },
    title: '结算单信息',
    width: 208,
  },
  {
    accessorKey: 'route',
    copyable: true,
    id: 'route',
    sortable: true,
    title: '运输路线',
    width: 180,
  },
  {
    accessorKey: 'region',
    id: 'region',
    title: '区域',
    width: 92,
  },
  {
    accessorKey: 'owner',
    id: 'owner',
    sortable: true,
    title: '负责人',
    width: 96,
  },
  {
    accessorKey: 'shipmentCount',
    align: 'right',
    id: 'shipmentCount',
    sortable: true,
    summary: { type: 'sum' },
    title: '票数',
    width: 96,
  },
  {
    accessorKey: 'completionRate',
    align: 'right',
    id: 'completionRate',
    sortable: true,
    summary: { type: 'average' },
    title: '完成率',
    width: 112,
  },
  {
    accessorKey: 'amount',
    align: 'right',
    id: 'amount',
    sortable: true,
    summary: {
      component: AmountDisplay,
      componentProps: {
        currency: 'CNY',
      },
      type: 'sum',
    },
    title: '结算金额',
    width: 192,
  },
  {
    accessorKey: 'updatedAt',
    defaultVisible: false,
    id: 'updatedAt',
    sortable: true,
    title: '更新时间',
    width: 176,
  },
  {
    accessorKey: 'status',
    fixed: 'right',
    id: 'status',
    title: '状态',
    width: 104,
  },
]

const filterDefinitions: QsGenericTableFilterDefinition[] = [
  {
    key: 'region',
    label: '业务区域',
    options: regions.map(value => ({ label: value, value })),
  },
  {
    key: 'status',
    label: '结算状态',
    options: ['待复核', '已完成', '已暂停'].map(value => ({ label: value, value })),
  },
]

const page = ref(1)
const pageSize = ref(20)
const search = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const sorting = ref<TableSortingState>([])
const lastEvent = ref('等待交互')

const filteredRows = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase('zh-CN')

  return sourceRows.filter((row) => {
    const matchesSearch = !keyword || [row.settlementNo, row.orderSource, row.route, row.owner]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(keyword))
    const matchesRegion = !filters.value.region || row.region === filters.value.region
    const matchesStatus = !filters.value.status || row.status === filters.value.status

    return matchesSearch && matchesRegion && matchesStatus
  })
})

const sortedRows = computed(() => {
  if (!sorting.value.length) {
    return filteredRows.value
  }

  return [...filteredRows.value].sort((left, right) => {
    for (const rule of sorting.value) {
      const leftValue = left[rule.id as keyof SettlementRow]
      const rightValue = right[rule.id as keyof SettlementRow]
      const result = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), 'zh-CN')

      if (result !== 0) {
        return rule.desc ? -result : result
      }
    }
    return 0
  })
})

const pageRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return sortedRows.value.slice(start, start + pageSize.value)
})

const pageStandardAmount = computed(() => pageRows.value.reduce(
  (total, row) => total + row.standardAmount,
  0,
))

function statusClass(status: SettlementRow['status']) {
  return {
    待复核: 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300',
    已完成: 'border-primary/30 bg-primary/8 text-primary',
    已暂停: 'border-border bg-muted text-muted-foreground',
  }[status]
}

function recordEvent(message: string) {
  lastEvent.value = message
}
</script>

<template>
  <section aria-labelledby="generic-table-title">
    <div class="p-5 border border-border rounded-xl bg-background sm-p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:table-properties" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">首个业务组件</span>
          </div>
          <h3 id="generic-table-title" class="text-xl tracking-tight font-semibold m-0 mt-3 sm-text-2xl">
            业务通用表格
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            基于 FaTable 与 FaPagination 组合查询、列设置、连续行号和当前页汇总。数据请求与写入仍由业务页面负责。
          </p>
        </div>
        <FaTag variant="secondary">
          QsGenericTable
        </FaTag>
      </div>

      <div class="mt-6 py-3 border-y border-border flex flex-wrap gap-x-6 gap-y-2 items-center">
        <span class="text-xs text-muted-foreground">
          示例数据 <strong class="text-foreground font-semibold">{{ sourceRows.length }}</strong> 条
        </span>
        <span class="text-xs text-muted-foreground">
          查询结果 <strong class="text-foreground font-semibold">{{ filteredRows.length }}</strong> 条
        </span>
        <span class="text-xs text-muted-foreground">
          汇总范围 <strong class="text-foreground font-semibold">当前页</strong>
        </span>
        <code class="text-xs text-muted-foreground ms-auto break-all">{{ lastEvent }}</code>
      </div>

      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="search"
        v-model:filters="filters"
        v-model:sorting="sorting"
        class="mt-5"
        row-key="id"
        :columns="columns"
        :data="pageRows"
        :total="sortedRows.length"
        :filter-definitions="filterDefinitions"
        :page-size-options="[20, 50, 100, 200]"
        table-class="min-w-[1320px]"
        search-placeholder="搜索结算单号、来源、路线或负责人"
        add-label="新增结算单"
        @add="recordEvent('add · 已通知业务页面')"
        @column-settings-change="recordEvent('column-settings-change · 展示状态已更新')"
        @filter-change="recordEvent('filter-change · 查询条件已应用')"
        @pagination-change="recordEvent('pagination-change · 页码或每页数量已更新')"
        @search="recordEvent('search · 搜索词已应用')"
        @sorting-change="recordEvent('sorting-change · 排序状态已更新')"
      >
        <template #cell-settlementNo="{ row }">
          <QsTableStackedCell class="group">
            <QsTableStackedLine
              nowrap
              weight="semibold"
              content-class="text-[13px] leading-5 tracking-[0.01em] font-mono tabular-nums"
            >
              {{ row.original.settlementNo }}
              <template #suffix>
                <CopyCellButton
                  label="结算单号"
                  :text="row.original.settlementNo"
                />
              </template>
            </QsTableStackedLine>
            <QsTableStackedLine
              tone="muted"
              content-class="text-xs leading-4"
            >
              {{ row.original.orderSource }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-shipmentCount="{ row }">
          <span class="tracking-tight font-medium tabular-nums">{{ row.original.shipmentCount }} 票</span>
        </template>

        <template #cell-completionRate="{ row }">
          <span class="tracking-tight font-medium tabular-nums">{{ row.original.completionRate }}%</span>
        </template>

        <template #summary-completionRate="{ label, value }">
          <div class="gap-0.5 grid">
            <span class="text-xs text-muted-foreground leading-4 font-normal">{{ label }}</span>
            <strong class="text-sm leading-5 font-semibold tabular-nums">{{ Number(value).toFixed(1) }}%</strong>
          </div>
        </template>

        <template #cell-amount="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine
              label="实际"
              nowrap
              tone="success"
              weight="medium"
              content-class="text-sm tabular-nums"
            >
              <AmountDisplay :value="row.original.amount" currency="CNY" />
            </QsTableStackedLine>
            <QsTableStackedLine
              label="标准"
              nowrap
              weight="medium"
              content-class="text-sm tabular-nums"
            >
              <AmountDisplay :value="row.original.standardAmount" currency="CNY" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #summary-amount="{ value }">
          <QsTableStackedCell>
            <QsTableStackedLine label="实际" tone="success" weight="semibold" content-class="text-sm tabular-nums">
              <AmountDisplay :value="value" currency="CNY" />
            </QsTableStackedLine>
            <QsTableStackedLine label="标准" weight="semibold" content-class="text-sm tabular-nums">
              <AmountDisplay :value="pageStandardAmount" currency="CNY" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-updatedAt="{ row }">
          <DateTimeDisplay class="text-[13px] leading-5" :value="row.original.updatedAt" />
        </template>

        <template #cell-status="{ row }">
          <FaTag variant="outline" :class="statusClass(row.original.status)">
            {{ row.original.status }}
          </FaTag>
        </template>

        <template #mobile-row="{ row, rowNumber }">
          <div class="mb-3 pb-3 border-b border-border flex gap-3 items-start justify-between">
            <QsTableStackedCell class="group min-w-0">
              <QsTableStackedLine
                weight="semibold"
                content-class="text-sm leading-5 tracking-[0.01em] font-mono break-all tabular-nums"
              >
                {{ row.settlementNo }}
                <template #suffix>
                  <CopyCellButton
                    always-visible
                    label="结算单号"
                    :text="row.settlementNo"
                  />
                </template>
              </QsTableStackedLine>
              <QsTableStackedLine tone="muted" content-class="text-xs leading-4">
                {{ row.orderSource }}
              </QsTableStackedLine>
            </QsTableStackedCell>
            <span class="text-xs text-muted-foreground leading-4 font-medium shrink-0 tabular-nums">#{{ rowNumber }}</span>
          </div>
          <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-2">
            <div class="col-span-2">
              <dt class="text-xs text-muted-foreground leading-4 font-medium mb-1">
                运输路线
              </dt>
              <dd class="text-sm leading-5 m-0">
                {{ row.route }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground leading-4 font-medium mb-1">
                结算金额
              </dt>
              <dd class="m-0">
                <QsTableStackedCell>
                  <QsTableStackedLine label="实际" tone="success" weight="medium" content-class="text-sm tabular-nums">
                    <AmountDisplay :value="row.amount" currency="CNY" />
                  </QsTableStackedLine>
                  <QsTableStackedLine label="标准" weight="medium" content-class="text-sm tabular-nums">
                    <AmountDisplay :value="row.standardAmount" currency="CNY" />
                  </QsTableStackedLine>
                </QsTableStackedCell>
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground leading-4 font-medium mb-1">
                状态
              </dt>
              <dd class="m-0">
                <FaTag variant="outline" :class="statusClass(row.status)">
                  {{ row.status }}
                </FaTag>
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground leading-4 font-medium mb-1">
                负责人
              </dt>
              <dd class="text-sm leading-5 m-0">
                {{ row.owner }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground leading-4 font-medium mb-1">
                完成率
              </dt>
              <dd class="text-sm leading-5 tracking-tight font-medium m-0 tabular-nums">
                {{ row.completionRate }}%
              </dd>
            </div>
          </dl>
        </template>
      </QsGenericTable>
    </div>
  </section>
</template>
