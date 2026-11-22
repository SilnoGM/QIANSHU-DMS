<script lang="ts" setup>
import type { AdAccountDto } from '@/api/generated/types.gen'
import type { QsStatusSwitchItem } from '@/components/business/QsStatusSwitchToolbar/types'
import { getApiClientFailureMessage } from '@/api/errors'
import adAccountsApi from '@/api/modules/ad-accounts'
import QsAdAccountCard from '@/components/business/QsAdAccountCard/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useAdAccountBadgeStore } from '@/store/modules/app/ad-account-badge'

defineOptions({ name: 'QsOperationsNetworkAdsLeopardAdAccounts' })

const { auth } = useAppAuth()
const badgeStore = useAdAccountBadgeStore()

const canRead = computed(() => auth('ad-accounts:read'))

const rows = ref<AdAccountDto[]>([])
const loading = ref(false)
const error = ref('')
const activeFilter = ref('all')

let controller: AbortController | null = null

const filters = computed<QsStatusSwitchItem[]>(() => [
  { value: 'all', label: '全部', count: rows.value.length },
  { value: 'low', label: '余额预警 <$30', count: rows.value.filter(row => row.lowBalance).length },
  { value: 'exhausted', label: '已耗尽', count: rows.value.filter(row => row.sustainableDays === 0).length },
  { value: 'frozen', label: '冻结', count: rows.value.filter(row => row.freeze === 1).length },
])

const visibleRows = computed(() => {
  switch (activeFilter.value) {
    case 'low':
      return rows.value.filter(row => row.lowBalance)
    case 'exhausted':
      return rows.value.filter(row => row.sustainableDays === 0)
    case 'frozen':
      return rows.value.filter(row => row.freeze === 1)
    default:
      return rows.value
  }
})

async function load(): Promise<void> {
  if (!canRead.value) {
    return
  }

  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  error.value = ''

  try {
    const response = await adAccountsApi.listMine(request.signal)
    if (!request.signal.aborted) {
      rows.value = response.data.list
      void badgeStore.refreshMine()
    }
  }
  catch (failure) {
    if (!request.signal.aborted) {
      error.value = getApiClientFailureMessage(failure, '加载猎豹广告户失败')
    }
  }
  finally {
    if (!request.signal.aborted) {
      loading.value = false
    }
  }
}

onMounted(load)
onUnmounted(() => controller?.abort())
</script>

<template>
  <FaPageHeader
    title="猎豹广告户"
    description="数据由猎豹侧约每小时更新；可用余额低于 $30 计入余额预警。"
  />
  <FaPageMain>
    <FaEmpty
      v-if="!canRead"
      icon="i-lucide:shield-alert"
      title="无权限访问猎豹广告户"
      description="请联系管理员分配 ad-accounts:read 权限。"
      class="py-12"
    />

    <template v-else>
      <QsStatusSwitchToolbar
        v-model="activeFilter"
        :items="filters"
        aria-label="广告账户筛选"
        class="mb-4"
      />

      <div v-if="error" class="text-sm text-destructive mb-4 px-4 py-3 border border-destructive/35 rounded-md bg-destructive/10 flex gap-3 items-center">
        <span class="flex-1">{{ error }}</span>
        <FaButton size="sm" variant="outline" @click="load">
          重试
        </FaButton>
      </div>

      <div v-if="loading" class="gap-4 grid lg:grid-cols-2">
        <div v-for="index in 4" :key="index" class="border rounded-lg bg-muted/40 h-44 motion-safe:animate-pulse" />
      </div>

      <FaEmpty
        v-else-if="rows.length === 0"
        icon="i-lucide:megaphone-off"
        title="暂无绑定的广告账户"
        description="请联系采运在「猎豹广告户管理」中分配。"
        class="py-12"
      />

      <FaEmpty
        v-else-if="visibleRows.length === 0"
        icon="i-lucide:filter-x"
        title="当前筛选条件下没有广告账户"
        description="切换上方筛选项查看其他账户。"
        class="py-12"
      />

      <div v-else class="gap-4 grid lg:grid-cols-2">
        <QsAdAccountCard
          v-for="row in visibleRows"
          :key="row.id"
          :account="row"
          mode="operations"
        />
      </div>
    </template>
  </FaPageMain>
</template>
