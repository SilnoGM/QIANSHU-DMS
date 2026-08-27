<script setup lang="ts">
import type { QsStatusSwitchItem } from '@/components/business/QsStatusSwitchToolbar/types'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'

const pendingStatus = ref('ALL_PENDING')
const orderStatus = ref('ALL_ORDERS')
const stateStatus = ref('ACTIVE')

const pendingItems: readonly QsStatusSwitchItem[] = [
  { value: 'ALL_PENDING', label: '全部待办', count: 38 },
  { value: 'PENDING_PURCHASE', label: '待采购', count: 12 },
  { value: 'PENDING_SHIPMENT', label: '待发货', count: 9 },
  { value: 'PENDING_WAREHOUSE', label: '待入仓', count: 7 },
  { value: 'PENDING_CONTAINER', label: '待装柜', count: 10 },
]

const orderItems: readonly QsStatusSwitchItem[] = [
  { value: 'ALL_ORDERS', label: '全部订单', count: 128 },
  { value: 'CONFIRMED', label: '已确认', count: 76 },
  { value: 'PENDING_RECONCILIATION', label: '待对账', count: 14 },
  { value: 'CANCELLED', label: '已取消', count: 8 },
  { value: 'COMPLETED', label: '已完成', count: 30 },
]

const stateItems: readonly QsStatusSwitchItem[] = [
  { value: 'ACTIVE', label: '选中状态', count: 24 },
  { value: 'DEFAULT', label: '默认状态', count: 16 },
  { value: 'NO_COUNT', label: '无计数状态' },
  { value: 'DISABLED', label: '禁用状态', count: 5, disabled: true },
]
</script>

<template>
  <section
    aria-labelledby="status-switch-toolbar-showcase-title"
    data-testid="status-switch-toolbar-showcase"
  >
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:list-filter" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">状态筛选</span>
          </div>
          <h3
            id="status-switch-toolbar-showcase-title"
            class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl"
          >
            订单状态切换场景
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            示例使用本地状态和固定计数，覆盖待办、全部订单、禁用项与窄屏横向浏览。
          </p>
        </div>
        <FaTag variant="secondary">
          QsStatusSwitchToolbar
        </FaTag>
      </div>

      <div class="mt-7 space-y-7">
        <div>
          <div class="mb-3 flex gap-3 items-center justify-between">
            <span class="qs-type-compact-label text-foreground">待办订单</span>
            <span class="text-xs text-muted-foreground font-mono">{{ pendingStatus }}</span>
          </div>
          <QsStatusSwitchToolbar
            v-model="pendingStatus"
            aria-label="待办订单状态"
            :items="pendingItems"
          />
        </div>

        <div>
          <div class="mb-3 flex gap-3 items-center justify-between">
            <span class="qs-type-compact-label text-foreground">全部订单</span>
            <span class="text-xs text-muted-foreground font-mono">{{ orderStatus }}</span>
          </div>
          <QsStatusSwitchToolbar
            v-model="orderStatus"
            aria-label="全部订单状态"
            :items="orderItems"
          />
        </div>

        <div class="gap-6 grid lg:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
          <div>
            <div class="mb-3">
              <span class="qs-type-compact-label text-foreground">390px 窄容器</span>
            </div>
            <div class="max-w-[390px]">
              <QsStatusSwitchToolbar
                v-model="pendingStatus"
                aria-label="窄容器状态浏览"
                :items="pendingItems"
              />
            </div>
          </div>

          <div>
            <div class="mb-3">
              <span class="qs-type-compact-label text-foreground">状态矩阵</span>
            </div>
            <QsStatusSwitchToolbar
              v-model="stateStatus"
              aria-label="组件状态矩阵"
              :items="stateItems"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
