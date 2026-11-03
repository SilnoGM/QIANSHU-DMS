<script setup lang="ts">
import type { ProxyNodeDto } from '../../../api/generated/types.gen'
import type { ProxyNodeCardMode } from './logic'
import type { ActionMenuItem } from '@/components/business/QsGenericTable/action-column-width'
import { EMPTY_DATE_TIME_TEXT, formatDateTime } from '@/components/base/DateTimeDisplay/format'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import {
  buildProxyNodeCopyText,
  isProxyNodeCredentialAvailable,
  resolveProxyNodeActionDisabledReason,
  resolveProxyNodeCountryLabel,
  resolveProxyNodeProtocolLabel,
  resolveProxyNodePublicIpLabel,
  resolveProxyNodeTypeLabel,
} from './logic'
import QsProxyNodeCountdown from './QsProxyNodeCountdown.vue'

defineOptions({ name: 'QsProxyNodeCard' })

const props = withDefaults(defineProps<{
  node: ProxyNodeDto
  mode: ProxyNodeCardMode
  busy?: boolean
  disabledReason?: string | null
}>(), {
  busy: false,
  disabledReason: null,
})

const emit = defineEmits<{
  assign: []
  release: []
}>()

const toast = useQsToast()
const hostId = useId()

const countryLabel = computed(() => resolveProxyNodeCountryLabel(props.node))
const typeLabel = computed(() => resolveProxyNodeTypeLabel(props.node.ipType))
const typeMeta = computed(() => `${typeLabel.value} · ${props.node.ipVersion}`)
const protocolLabel = computed(() => resolveProxyNodeProtocolLabel(props.node.protocol))
const publicIpLabel = computed(() => resolveProxyNodePublicIpLabel(props.node))
const isManagement = computed(() => props.mode === 'management')
const isAssigned = computed(() => props.node.assignedUser !== null)
const canCopy = computed(() => isProxyNodeCredentialAvailable(props.node))
const assignLabel = computed(() => isAssigned.value ? '改绑' : '绑定')
const hasPurchaseMeta = computed(() => props.node.boughtAt !== null || props.node.lastRenewedAt !== null)
const actionDisabledReason = computed(() => (
  props.disabledReason
  ?? resolveProxyNodeActionDisabledReason(props.node)
))
const copyDisabledReason = computed(() => (
  canCopy.value ? null : '凭证解密失败，请重新同步'
))
const expiresAtLabel = computed(() => {
  const text = formatDateTime(props.node.expiresAt, 'datetime')
  return text === EMPTY_DATE_TIME_TEXT ? text : text.slice(0, 16)
})
const synchronizedAtLabel = computed(() => {
  const text = formatDateTime(props.node.lastSyncedAt, 'datetime')
  return text === EMPTY_DATE_TIME_TEXT ? text : text.slice(5, 16)
})

const menuItems = computed<ActionMenuItem[][]>(() => {
  if (!isManagement.value || !isAssigned.value) {
    return []
  }
  return [[
    {
      label: '解绑',
      variant: 'destructive',
      disabled: props.busy,
      handle: () => emit('release'),
    },
  ]]
})

async function copy(): Promise<void> {
  if (!canCopy.value) {
    return
  }

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API is unavailable')
    }
    await navigator.clipboard.writeText(buildProxyNodeCopyText(props.node))
    toast.success('节点配置已复制')
  }
  catch {
    // 不把凭据内容或浏览器权限细节写入日志，失败只反馈当前用户。
    toast.error('复制失败，请手动选择字段')
  }
}
</script>

<template>
  <FaCard
    role="article"
    :aria-labelledby="hostId"
    data-slot="qs-proxy-node-card"
    class="qs-proxy-node-card py-0 rounded-xl flex flex-col gap-0 h-full shadow-sm overflow-hidden"
    content-class="p-0 flex flex-1 flex-col"
  >
    <header class="px-4 py-3 flex flex-wrap gap-2 items-center">
      <span class="qs-proxy-node-card__country text-xs text-foreground font-medium px-2 py-1 border border-border rounded-md bg-muted/40 whitespace-nowrap">
        <FaIcon name="i-lucide:map-pin" class="text-primary size-3.5" aria-hidden="true" />
        {{ countryLabel }}
      </span>
      <span class="qs-proxy-node-card__protocol text-[11px] text-sky-700 tracking-wide font-semibold px-2 py-1 border border-sky-500/20 rounded-md bg-sky-500/10 whitespace-nowrap uppercase dark:text-sky-400 dark:border-sky-400/30 dark:bg-sky-400/10">
        {{ protocolLabel }}
      </span>
      <span class="text-xs text-muted-foreground whitespace-nowrap">{{ typeMeta }}</span>
      <FaTag
        v-if="node.vendorMissing"
        variant="outline"
        class="text-xs text-amber-700 border-amber-500/30 bg-amber-500/10 whitespace-nowrap dark:text-amber-400 dark:border-amber-400/30 dark:bg-amber-400/10"
      >
        <span class="inline-flex gap-1 items-center">
          <FaIcon name="i-lucide:triangle-alert" class="size-3.5" aria-hidden="true" />
          供应商侧不可见
        </span>
      </FaTag>

      <div
        v-if="isManagement"
        class="ml-auto flex flex-wrap gap-2 items-center"
      >
        <span v-if="isAssigned" class="text-xs text-muted-foreground">已绑定</span>
        <QsPersonDisplay
          v-if="node.assignedUser"
          :display-name="node.assignedUser.displayName"
          :avatar-url="node.assignedUser.avatarUrl"
          size="sm"
        />

        <FaTooltip v-if="actionDisabledReason" :text="actionDisabledReason">
          <span class="inline-flex" tabindex="0">
            <FaButton
              variant="ghost"
              size="sm"
              class="qs-proxy-node-card__bind-button"
              disabled
            >
              <FaIcon name="i-lucide:link" class="size-3.5" aria-hidden="true" />
              {{ assignLabel }}
            </FaButton>
          </span>
        </FaTooltip>
        <FaButton
          v-else
          variant="ghost"
          size="sm"
          class="qs-proxy-node-card__bind-button"
          :disabled="busy"
          @click="emit('assign')"
        >
          <FaIcon name="i-lucide:link" class="size-3.5" aria-hidden="true" />
          {{ assignLabel }}
        </FaButton>

        <FaDropdown
          v-if="isAssigned"
          :items="menuItems"
          align="end"
        >
          <FaButton
            variant="ghost"
            size="icon-sm"
            aria-label="更多操作"
          >
            <FaIcon name="i-lucide:ellipsis-vertical" class="size-4" aria-hidden="true" />
          </FaButton>
        </FaDropdown>
      </div>
    </header>

    <div class="qs-proxy-node-card__body p-4 flex-1">
      <div class="qs-proxy-node-card__identity">
        <span class="text-xs text-muted-foreground">代理地址(IP)</span>
        <div class="flex gap-2 min-w-0 items-center">
          <h3 :id="hostId" class="qs-proxy-node-card__host m-0">
            {{ node.host }}
          </h3>
          <FaTooltip v-if="copyDisabledReason" :text="copyDisabledReason">
            <span class="inline-flex" tabindex="0">
              <FaButton
                variant="ghost"
                size="icon-sm"
                class="text-muted-foreground shrink-0"
                disabled
                aria-label="复制完整配置"
              >
                <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />
              </FaButton>
            </span>
          </FaTooltip>
          <FaButton
            v-else
            variant="ghost"
            size="icon-sm"
            class="text-muted-foreground shrink-0"
            aria-label="复制完整配置"
            @click="copy"
          >
            <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />
          </FaButton>
        </div>
        <div v-if="publicIpLabel" class="text-xs text-muted-foreground">
          {{ publicIpLabel }}
        </div>
      </div>

      <div class="qs-proxy-node-card__expiry">
        <QsProxyNodeCountdown :expires-at="node.expiresAt" />
        <span class="text-xs text-muted-foreground inline-flex gap-1 items-baseline">
          到期：<time :datetime="node.expiresAt" class="tabular-nums">{{ expiresAtLabel }}</time>
        </span>
      </div>
    </div>

    <footer class="qs-proxy-node-card__footer px-4 py-3 border-t border-border bg-muted/20 flex flex-wrap gap-x-4 gap-y-2 items-center justify-between">
      <div v-if="hasPurchaseMeta" class="text-xs text-muted-foreground inline-flex flex-wrap gap-x-2 gap-y-1 items-baseline">
        <span v-if="node.boughtAt">
          购买：<DateTimeDisplay :value="node.boughtAt" format="date" />
        </span>
        <span v-if="node.boughtAt && node.lastRenewedAt" aria-hidden="true">·</span>
        <span v-if="node.lastRenewedAt">
          续费：<DateTimeDisplay :value="node.lastRenewedAt" format="date" />
        </span>
      </div>
      <div class="text-xs text-muted-foreground ml-auto inline-flex flex-wrap gap-1.5 items-center">
        <FaIcon name="i-lucide:refresh-cw" class="size-3.5" aria-hidden="true" />
        <time :datetime="node.lastSyncedAt" class="tabular-nums">同步于 {{ synchronizedAtLabel }}</time>
      </div>
    </footer>
  </FaCard>
</template>

<style scoped>
/* 卡片自身是容器：一行两列的栅格宽度变化时，仍按卡片实际宽度切换布局。 */
.qs-proxy-node-card {
  container-type: inline-size;
}

.qs-proxy-node-card__country {
  display: inline-flex;
  gap: 0.25rem;
  align-items: center;
}

.qs-proxy-node-card__protocol {
  display: inline-flex;
  align-items: center;
  line-height: 1rem;
}

.qs-proxy-node-card__bind-button {
  color: oklch(var(--primary));
  background: oklch(var(--primary) / 10%);
  border: 1px solid oklch(var(--primary) / 25%);
}

.qs-proxy-node-card__bind-button:hover:not(:disabled) {
  color: oklch(var(--primary-foreground));
  background: oklch(var(--primary));
  border-color: oklch(var(--primary));
}

.qs-proxy-node-card__bind-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.qs-proxy-node-card__body {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  align-items: flex-start;
  justify-content: space-between;
}

.qs-proxy-node-card__identity {
  flex: 1 1 20rem;
  min-width: 0;
}

.qs-proxy-node-card__host {
  font-family: var(--qs-font-mono);
  font-size: 1.375rem;
  font-weight: var(--qs-type-weight-bold, 700);
  line-height: 1.75rem;
  overflow-wrap: anywhere;
}

.qs-proxy-node-card__expiry {
  display: flex;
  flex: 0 1 13rem;
  flex-direction: column;
  gap: 0.375rem;
  align-items: flex-end;
  min-width: 0;
  text-align: right;
}

@container (min-width: 56rem) {
  .qs-proxy-node-card__host {
    font-size: 1.75rem;
    line-height: 2.25rem;
  }
}

@container (width < 36rem) {
  .qs-proxy-node-card__expiry {
    flex-basis: 100%;
  }
}
</style>
