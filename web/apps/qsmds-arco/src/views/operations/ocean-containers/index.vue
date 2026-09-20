<script setup lang="ts">
import type { OperationsOceanContainerQuery } from '@/api/modules/operations-ocean-containers'
import type { OceanContainerLine, OceanContainerSourceRequest } from '@/components/business/QsOceanContainerList/types'
import operationsOceanApi from '@/api/modules/operations-ocean-containers'
import purchaseApi from '@/api/modules/purchase-orders'
import salesApi from '@/api/modules/sales-orders'
import QsOceanContainerList from '@/components/business/QsOceanContainerList/index.vue'
import QsPurchaseOrderDrawer from '@/components/business/QsPurchaseOrderDrawer/index.vue'
import QsSalesOrderDrawer from '@/components/business/QsSalesOrderDrawer/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import OceanContainerLineDrawer from './ocean-container-line-drawer.vue'
import { buildOceanContainerQuery, parseOceanContainerQuery } from './route-query'
import { useOceanContainerSource } from './use-ocean-container-source'
import { useOperationsOceanContainers } from './use-operations-ocean-containers'

defineOptions({ name: 'QsOperationsOceanContainers' })
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const active = ref(false)
const canRead = computed(() => account.isLogin && auth('sales-orders:read'))
const canViewPurchase = computed(() => account.isLogin && auth('purchase-orders:read'))
const instancePath = route.fullPath
// 布局按 fullPath 保活，旧查询实例一旦失活就清理个人数据，避免身份切换后的缓存复用。
const enabled = computed(() => active.value && canRead.value && route.name === 'qsOperationsOceanContainers' && route.fullPath === instancePath)
const query = computed(() => parseOceanContainerQuery(route.query))
const keyword = ref(query.value.search ?? '')
const state = useOperationsOceanContainers(enabled, computed(() => account.authEpoch), query, operationsOceanApi, page => navigate({ ...query.value, page }, true), {
  list: t('operationsOcean.listError'),
  items: t('operationsOcean.itemsError'),
  detail: t('operationsOcean.detailError'),
})
const { rows, total, loading, error, expandedIds, details, selectedLine, selectedContainerName, detailLoading, detailError } = state
const drawerVisible = computed({ get: () => state.drawerOpen.value, set: value => !value && state.closeDrawer() })
const source = useOceanContainerSource(enabled, computed(() => account.authEpoch), canRead, canViewPurchase, {
  item: operationsOceanApi.item,
  sales: salesApi.getById,
  purchase: purchaseApi.getById,
}, t('operationsOcean.sourceError'))

function navigate(next: OperationsOceanContainerQuery, replace = false): void {
  if (!enabled.value) {
    return
  }
  const location = { query: buildOceanContainerQuery(next) }
  if (router.resolve(location).fullPath === route.fullPath) {
    void state.reload()
  }
  else if (replace) {
    void router.replace(location)
  }
  else {
    void router.push(location)
  }
}
function search(): void {
  navigate({ ...query.value, search: keyword.value.trim() || undefined, page: 1 })
}
function paginate(value: { page: number, pageSize: number }): void {
  navigate({ ...query.value, ...value })
}
function viewLine(value: { containerId: string, line: OceanContainerLine }): void {
  source.close()
  void state.openLine(value.containerId, value.line.id)
}
function viewSource(value: OceanContainerSourceRequest): void {
  state.closeDrawer()
  void source.open(value)
}
// 查询或列表刷新后关闭来源抽屉，避免将上一组筛选的数据留在当前页面。
watch([query, loading], () => source.close(), { flush: 'sync' })

watch([enabled, query], ([isEnabled]) => {
  if (isEnabled) {
    keyword.value = query.value.search ?? ''
  }
}, { flush: 'sync' })
onMounted(() => active.value = true)
onActivated(() => active.value = true)
onDeactivated(() => active.value = false)
onBeforeUnmount(() => active.value = false)
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('operationsOcean.title')" :description="t('operationsOcean.description')" />
    <FaPageMain class="min-w-0">
      <FaEmpty v-if="!canRead" icon="i-lucide:shield-alert" :title="t('operationsOcean.noAccess')" :description="t('operationsOcean.noAccessDescription')" class="py-12" />
      <div v-else class="min-w-0 space-y-5">
        <form role="search" :aria-label="t('operationsOcean.search')" class="flex gap-2 items-center" @submit.prevent="search">
          <FaInput v-model="keyword" :placeholder="t('operationsOcean.searchPlaceholder')" :aria-label="t('operationsOcean.searchPlaceholder')" :maxlength="128" class="min-w-0 sm:max-w-96" />
          <FaButton type="submit" variant="outline" class="shrink-0" :disabled="!enabled">
            <FaIcon name="i-lucide:search" aria-hidden="true" />{{ t('operationsOcean.search') }}
          </FaButton>
        </form>
        <FaAlert v-if="currencyCatalog.errorMessage.value" variant="destructive" :title="currencyCatalog.errorMessage.value">
          <template #description>
            <FaButton variant="outline" size="sm" :loading="currencyCatalog.loading.value" @click="currencyCatalog.reload">
              {{ t('operationsOcean.retry') }}
            </FaButton>
          </template>
        </FaAlert>
        <QsOceanContainerList
          v-model:expanded-ids="expandedIds"
          :items="rows" :details="details" :currencies="currencyCatalog.currencies.value"
          :can-view-sales="canRead" :can-view-purchase="canViewPurchase"
          :total="total" :page="query.page" :page-size="query.pageSize" :loading="loading" :error="error"
          @request-items="state.requestItems" @page-change="paginate" @retry="state.reload" @view-line="viewLine"
          @view-source="viewSource"
        />
      </div>
    </FaPageMain>
    <OceanContainerLineDrawer
      v-model="drawerVisible" :line="selectedLine" :container-name="selectedContainerName"
      :currencies="currencyCatalog.currencies.value" :loading="detailLoading" :error="detailError"
      @retry="state.loadDetail"
    />
    <QsSalesOrderDrawer
      :model-value="source.target.value?.kind === 'sales'" :order="null" :detail="source.salesDetail.value"
      :currencies="currencyCatalog.currencies.value" :loading="source.loading.value" :error="source.error.value || null"
      @update:model-value="!$event && source.close()" @reload="source.reload"
    />
    <QsPurchaseOrderDrawer
      :model-value="source.target.value?.kind === 'purchase'" :order="null" :detail="source.purchaseDetail.value"
      :currencies="currencyCatalog.currencies.value" :loading="source.loading.value" :error="source.error.value || null"
      action-error="" :busy="false" :can-attach-document="false"
      @update:model-value="!$event && source.close()" @reload="source.reload"
    />
  </div>
</template>
