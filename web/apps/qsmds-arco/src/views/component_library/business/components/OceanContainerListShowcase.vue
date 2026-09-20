<script setup lang="ts">
import type { DemoOceanContainerLine } from '../fixtures/ocean-container.fixture'
import type { OceanContainerDetailPage, OceanContainerItemsRequest, OceanContainerLine, OceanContainerSourceRequest } from '@/components/business/QsOceanContainerList/types'
import type { QsStatusSwitchItem } from '@/components/business/QsStatusSwitchToolbar/types'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsOceanContainerList from '@/components/business/QsOceanContainerList/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { oceanContainerCurrencies, oceanContainerDemoLines, oceanContainerDemoSummaries } from '../fixtures/ocean-container.fixture'
import OceanContainerLineDrawer from './OceanContainerLineDrawer.vue'

const scenarios: readonly QsStatusSwitchItem[] = [
  { value: 'ready', label: '正常展示' },
  { value: 'loading', label: '加载中' },
  { value: 'empty', label: '空列表' },
  { value: 'error', label: '列表失败' },
  { value: 'detail-error', label: '明细失败' },
]
const scenario = ref('ready')
const page = ref(1)
const pageSize = ref(10)
const expandedIds = ref<string[]>([])
const details = ref<Record<string, OceanContainerDetailPage>>({})
const transientLoading = ref(false)
const listRecovered = ref(false)
const selectedLine = ref<DemoOceanContainerLine | null>(null)
const selectedContainerName = ref('')
const drawerVisible = ref(false)
const sourceVisible = ref(false)
const sourceKind = ref<'sales' | 'purchase'>('sales')
const timers = new Set<ReturnType<typeof setTimeout>>()
const cache = new Map<string, OceanContainerDetailPage>()
const failedContainers = new Set<string>()

const items = computed(() => scenario.value === 'empty' ? [] : oceanContainerDemoSummaries.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const total = computed(() => scenario.value === 'empty' ? 0 : oceanContainerDemoSummaries.length)
const listLoading = computed(() => scenario.value === 'loading' || transientLoading.value)
const listError = computed(() => scenario.value === 'error' && !listRecovered.value ? '柜次列表加载失败，请重试。' : null)

function defer(callback: () => void) {
  const timer = setTimeout(() => {
    timers.delete(timer)
    callback()
  }, 550)
  timers.add(timer)
}

function cancelPending() {
  // 切换演示场景和卸载时取消待完成回调，避免旧场景覆盖新状态。
  timers.forEach(clearTimeout)
  timers.clear()
}

watch(scenario, () => {
  cancelPending()
  cache.clear()
  failedContainers.clear()
  expandedIds.value = []
  details.value = {}
  page.value = 1
  pageSize.value = 10
  transientLoading.value = false
  listRecovered.value = false
  drawerVisible.value = false
  sourceVisible.value = false
})

onBeforeUnmount(cancelPending)

function requestItems(request: OceanContainerItemsRequest) {
  const { containerId, page: detailPage, pageSize: detailPageSize } = request
  const key = `${containerId}:${detailPage}:${detailPageSize}`
  const cached = cache.get(key)
  if (cached) {
    details.value[containerId] = cached
    return
  }
  const lines = oceanContainerDemoLines[containerId] ?? []
  details.value[containerId] = { status: 'loading', items: [], total: lines.length, page: detailPage, pageSize: detailPageSize }
  defer(() => {
    if (scenario.value === 'detail-error' && !failedContainers.has(containerId)) {
      failedContainers.add(containerId)
      details.value[containerId] = { ...details.value[containerId]!, status: 'error', error: '本柜次的个人明细加载失败，请重试。' }
      return
    }
    const result: OceanContainerDetailPage = {
      status: 'ready',
      items: lines.slice((detailPage - 1) * detailPageSize, detailPage * detailPageSize),
      total: lines.length,
      page: detailPage,
      pageSize: detailPageSize,
    }
    cache.set(key, result)
    details.value[containerId] = result
  })
}

function changePage(value: { page: number, pageSize: number }) {
  page.value = value.page
  pageSize.value = value.pageSize
  expandedIds.value = []
  transientLoading.value = true
  defer(() => transientLoading.value = false)
}

function retryList() {
  listRecovered.value = true
  transientLoading.value = true
  defer(() => transientLoading.value = false)
}

function viewLine(value: { containerId: string, line: OceanContainerLine }) {
  sourceVisible.value = false
  selectedLine.value = oceanContainerDemoLines[value.containerId]?.find(line => line.id === value.line.id) ?? null
  selectedContainerName.value = oceanContainerDemoSummaries.find(item => item.id === value.containerId)?.containerBatchName ?? ''
  drawerVisible.value = Boolean(selectedLine.value)
}

function viewSource(value: OceanContainerSourceRequest) {
  drawerVisible.value = false
  selectedLine.value = oceanContainerDemoLines[value.containerId]?.find(line => line.id === value.lineId) ?? null
  sourceKind.value = value.kind
  sourceVisible.value = Boolean(selectedLine.value)
}
</script>

<template>
  <section aria-label="海运柜次卡片演示" class="min-w-0 space-y-5">
    <div class="space-y-3">
      <div class="flex flex-wrap gap-3 items-center justify-between">
        <p class="qs-type-description text-muted-foreground m-0">
          演示销售员视角 · 12 个柜次 · 整柜概览与本人明细分开显示
        </p>
        <FaTag variant="secondary">
          演示数据
        </FaTag>
      </div>
      <QsStatusSwitchToolbar v-model="scenario" :items="scenarios" aria-label="演示场景" />
      <p class="qs-type-meta text-muted-foreground m-0" aria-live="polite">
        {{ scenario === 'detail-error' ? '展开有本人明细的柜次可查看失败状态；点击重试后恢复。' : '首柜含 23 条本人明细，可展开验证分页；第二柜没有本人明细，第三柜尚未装入明细。' }}
      </p>
    </div>
    <QsOceanContainerList
      v-model:expanded-ids="expandedIds"
      :items="items"
      :details="details"
      :currencies="oceanContainerCurrencies"
      :total="total"
      :page="page"
      :page-size="pageSize"
      :loading="listLoading"
      :error="listError"
      can-view-sales can-view-purchase
      @request-items="requestItems"
      @page-change="changePage"
      @retry="retryList"
      @view-line="viewLine"
      @view-source="viewSource"
    />
    <OceanContainerLineDrawer v-model="drawerVisible" :line="selectedLine" :container-name="selectedContainerName" />
    <QsGenericDrawer v-model="sourceVisible" :title="sourceKind === 'sales' ? '销售订单（演示）' : '采购订单（演示）'" description="来源单号联动演示，使用独立演示数据。" size="md">
      <dl v-if="selectedLine" class="m-0 space-y-5">
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            订单编号
          </dt>
          <dd class="qs-type-data m-0 mt-1 break-all">
            {{ sourceKind === 'sales' ? selectedLine.salesOrderNo : selectedLine.purchaseOrderNo }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            关联产品
          </dt>
          <dd class="qs-type-body m-0 mt-1 break-words">
            {{ selectedLine.goodsName }}
          </dd>
        </div>
      </dl>
      <template #footer>
        <FaButton variant="outline" @click="sourceVisible = false">
          关闭
        </FaButton>
      </template>
    </QsGenericDrawer>
  </section>
</template>
