<script setup lang="ts">
import type { ProxyNodeDto } from '@/api/generated/types.gen'
import { getApiClientFailureMessage } from '@/api/errors'
import proxyNodesApi from '@/api/modules/proxy-nodes'
import QsProxyNodeCard from '@/components/business/QsProxyNodeCard/index.vue'
import { resolveProxyNodeStatus } from '@/components/business/QsProxyNodeCard/logic'
import { PROXY_NODE_NOW_KEY } from '@/components/business/QsProxyNodeCard/now'
import { useNowTicker } from '@/composables/app/use-now-ticker'
import { recordServerClockSample, serverNowEpochMs } from '@/utils/server-clock'

defineOptions({ name: 'QsOperationsNetworkAdsStaticNodes' })

const { auth } = useAppAuth()
const canRead = computed(() => auth('proxy-nodes:read'))
const { nowMs } = useNowTicker()
provide(PROXY_NODE_NOW_KEY, nowMs)

const rows = ref<ProxyNodeDto[]>([])
const loading = ref(false)
const error = ref('')
let controller: AbortController | null = null

const expiringCount = computed(() => rows.value.filter((node) => {
  const status = resolveProxyNodeStatus(node.expiresAt, nowMs.value)
  return status === 'EXPIRING_SOON' || status === 'EXPIRING_CRITICAL'
}).length)

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
    const response = await proxyNodesApi.listMine(request.signal)
    if (!request.signal.aborted) {
      rows.value = response.data.items
      // serverNow 比 Date 头更精确，同时用于校准后续倒计时。
      recordServerClockSample(response.data.serverNow)
      nowMs.value = serverNowEpochMs()
    }
  }
  catch (failure) {
    if (!request.signal.aborted) {
      error.value = getApiClientFailureMessage(failure, '静态节点加载失败')
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
  <div class="min-w-0">
    <FaPageHeader
      title="静态节点"
      description="查看分配给本人的 IPFoxy 静态代理，复制配置后填入浏览器或指纹浏览器。"
    />

    <FaPageMain class="min-w-0">
      <FaEmpty
        v-if="!canRead"
        icon="i-lucide:shield-alert"
        title="无权限访问静态节点"
        description="请联系管理员分配 proxy-nodes:read 权限。"
        class="py-12"
      />

      <template v-else>
        <FaAlert
          v-if="!error && expiringCount > 0"
          :title="`${expiringCount} 个节点将在 7 天内到期`"
          description="请联系采运管理员在 IPFoxy 控制台续费，续费后由管理员重新同步。"
          class="mb-4"
        />

        <div v-if="error" class="py-12 flex flex-col gap-4 items-center">
          <FaEmpty
            icon="i-lucide:circle-alert"
            title="静态节点加载失败"
            :description="error"
          />
          <FaButton variant="outline" @click="load">
            重试
          </FaButton>
        </div>

        <div v-else-if="loading" class="gap-4 grid xl:grid-cols-2" aria-busy="true">
          <div
            v-for="index in 3"
            :key="index"
            aria-hidden="true"
            class="border border-border rounded-xl bg-card h-48 motion-safe:animate-pulse"
          />
        </div>

        <FaEmpty
          v-else-if="!rows.length"
          icon="i-lucide:server"
          title="尚未分配静态节点"
          description="请联系采运管理员在 IPFoxy 静态节点页面绑定。"
          class="py-12"
        />

        <div v-else class="gap-4 grid xl:grid-cols-2" aria-live="polite">
          <QsProxyNodeCard
            v-for="row in rows"
            :key="row.id"
            :node="row"
            mode="operations"
          />
        </div>
      </template>
    </FaPageMain>
  </div>
</template>
