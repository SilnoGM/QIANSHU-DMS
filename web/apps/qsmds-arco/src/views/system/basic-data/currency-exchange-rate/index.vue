<script setup lang="ts">
import type { CurrencyExchangeRateTab } from './currency-exchange-rate.logic'

import {
  buildCurrencyExchangeRateQuery,
  buildCurrencyExchangeRateTabs,
  resolveCurrencyExchangeRateTab,
} from './currency-exchange-rate.logic'

defineOptions({ name: 'SystemBasicDataCurrencyExchangeRate' })

const CurrencyManagementPanel = defineAsyncComponent(
  () => import('../currencies/index.vue'),
)
const ExchangeRateManagementPanel = defineAsyncComponent(
  () => import('../exchange-rates/index.vue'),
)

const route = useRoute()
const router = useRouter()
const { auth } = useAppAuth()

const canReadCurrencies = computed(() => auth('currencies:read'))
const canReadExchangeRates = computed(() => auth('exchange-rates:read'))
const access = computed(() => ({
  canReadCurrencies: canReadCurrencies.value,
  canReadExchangeRates: canReadExchangeRates.value,
}))
const tabs = computed(() => {
  return buildCurrencyExchangeRateTabs(access.value).map(tab => ({
    ...tab,
    class: 'min-h-11 px-4 sm:min-w-36',
  }))
})
const activeTab = ref<CurrencyExchangeRateTab | null>(null)

function queryMatchesTab(tab: CurrencyExchangeRateTab): boolean {
  return tab === 'currencies'
    ? route.query.tab === undefined
    : route.query.tab === tab
}

/**
 * 路由 query 与权限快照共同决定活动区域。FaTabs 底层默认只挂载活动
 * TabsContent，因此异步面板只会在成为活动 Tab 时加载并发起请求。若权限
 * 变化导致当前 query 不再可读，先卸载原面板，再导航到新的规范地址。
 */
function syncActiveTab(): void {
  const nextTab = resolveCurrencyExchangeRateTab(
    route.query.tab,
    access.value,
  )
  activeTab.value = nextTab
  if (nextTab === null) {
    return
  }

  if (!queryMatchesTab(nextTab)) {
    activeTab.value = null
    void router.replace({
      query: buildCurrencyExchangeRateQuery(route.query, nextTab),
    })
  }
}

function handleTabChange(value: string | number): void {
  const nextTab = resolveCurrencyExchangeRateTab(value, access.value)
  if (nextTab === null || nextTab !== value) {
    return
  }

  if (queryMatchesTab(nextTab)) {
    return
  }

  void router.replace({
    query: buildCurrencyExchangeRateQuery(route.query, nextTab),
  })
}

/**
 * 应用 Shell 以 route.fullPath 作为页面 key。query 更新会创建新页面实例；
 * 导航开始时先清空父级活动值，阻止 FaTabs 的内部即时切换提前挂载目标面板，
 * 避免目标列表在旧实例和新实例中各请求一次。
 */
onBeforeRouteUpdate(() => {
  activeTab.value = null
})

/**
 * KeepAlive 会按 fullPath 缓存两个 query 状态。返回已缓存页面时重新以当前
 * route 与权限恢复活动 Tab，避免复用离开前已清空的过渡状态。
 */
onActivated(syncActiveTab)

watch(
  [canReadCurrencies, canReadExchangeRates],
  syncActiveTab,
  { immediate: true },
)
</script>

<template>
  <div class="currency-exchange-rate-page">
    <FaPageHeader
      title="货币汇率"
      description="统一维护系统货币与当前兑人民币汇率；两类数据继续使用独立权限、查询和操作边界。"
    />

    <FaPageMain>
      <FaEmpty
        v-if="tabs.length === 0"
        icon="i-lucide:shield-alert"
        title="暂无查看权限"
        description="当前账号缺少货币或当前汇率读取权限。"
        class="min-h-64"
      />

      <FaTabs
        v-else-if="activeTab !== null"
        :model-value="activeTab"
        :list="tabs"
        data-testid="currency-exchange-rate-tabs"
        class="min-w-0"
        list-class="h-auto min-h-11 w-full sm:w-fit"
        content-class="mt-5 min-w-0"
        @update:model-value="handleTabChange"
      >
        <template #currencies>
          <CurrencyManagementPanel v-if="activeTab === 'currencies'" />
        </template>
        <template #exchange-rates>
          <ExchangeRateManagementPanel v-if="activeTab === 'exchange-rates'" />
        </template>
      </FaTabs>

      <div
        v-else
        class="text-muted-foreground flex gap-2 min-h-64 items-center justify-center"
        role="status"
      >
        <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" />
        <span>正在切换业务区域…</span>
      </div>
    </FaPageMain>
  </div>
</template>
