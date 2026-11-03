<script setup lang="ts">
import type { ProxyNodeDto } from '../../../api/generated/types.gen'
import type { ProxyNodeCardMode } from './logic'
import type { ActionMenuItem } from '@/components/business/QsGenericTable/action-column-width'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import {
  buildProxyNodeCopyText,
  isProxyNodeCredentialAvailable,
  resolveProxyNodeActionDisabledReason,
  resolveProxyNodeAutoExtendLabel,
  resolveProxyNodeCountryLabel,
  resolveProxyNodeHostLabel,
  resolveProxyNodeProtocolLabel,
  resolveProxyNodePublicIpLabel,
  resolveProxyNodeTypeLabel,
} from './logic'
import QsProxyNodeCountdown from './QsProxyNodeCountdown.vue'
import QsProxyNodeStatusTag from './QsProxyNodeStatusTag.vue'
import QsProxyNodeWarning from './QsProxyNodeWarning.vue'

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
const protocolLabel = computed(() => resolveProxyNodeProtocolLabel(props.node.protocol))
const hostLabel = computed(() => resolveProxyNodeHostLabel(props.node))
const publicIpLabel = computed(() => resolveProxyNodePublicIpLabel(props.node))
const autoExtendLabel = computed(() => resolveProxyNodeAutoExtendLabel(props.node))
const isManagement = computed(() => props.mode === 'management')
const isAssigned = computed(() => props.node.assignedUser !== null)
const canCopy = computed(() => isProxyNodeCredentialAvailable(props.node))
const assignLabel = computed(() => isAssigned.value ? '改绑' : '绑定')
const actionDisabledReason = computed(() => (
  props.disabledReason
  ?? resolveProxyNodeActionDisabledReason(props.node)
))
const copyDisabledReason = computed(() => (
  canCopy.value ? null : '凭证解密失败，请重新同步'
))

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
    class="qs-proxy-node-card py-0 rounded-xl gap-0 overflow-hidden"
    content-class="p-0"
  >
    <header class="px-4 py-3 border-b border-border flex flex-wrap gap-2 items-center">
      <FaTag variant="outline" class="qs-type-meta whitespace-nowrap">
        {{ countryLabel }}
      </FaTag>
      <span class="qs-proxy-node-card__protocol">
        {{ protocolLabel }}
      </span>
      <QsProxyNodeStatusTag :expires-at="node.expiresAt" />
      <FaTag
        v-if="node.vendorMissing"
        variant="outline"
        class="qs-type-meta text-amber-700 border-amber-500/30 bg-amber-500/10 whitespace-nowrap dark:text-amber-400 dark:border-amber-400/30 dark:bg-amber-400/10"
      >
        <span class="inline-flex gap-1 items-center">
          <FaIcon name="i-lucide:triangle-alert" class="size-3.5" aria-hidden="true" />
          供应商侧不可见
        </span>
      </FaTag>

      <div class="ml-auto flex flex-wrap gap-2 items-center">
        <template v-if="isManagement">
          <FaTooltip v-if="actionDisabledReason" :text="actionDisabledReason">
            <span class="inline-flex" tabindex="0">
              <FaButton size="sm" disabled>
                {{ assignLabel }}
              </FaButton>
            </span>
          </FaTooltip>
          <FaButton
            v-else
            size="sm"
            :disabled="busy"
            @click="emit('assign')"
          >
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
        </template>

        <template v-else>
          <FaTooltip v-if="copyDisabledReason" :text="copyDisabledReason">
            <span class="inline-flex" tabindex="0">
              <FaButton size="sm" disabled>
                <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />
                复制配置
              </FaButton>
            </span>
          </FaTooltip>
          <FaButton
            v-else
            size="sm"
            @click="copy"
          >
            <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />
            复制配置
          </FaButton>
        </template>
      </div>
    </header>

    <div class="qs-proxy-node-card__body p-4">
      <div class="flex flex-col gap-1 min-w-0">
        <h3 :id="hostId" class="qs-proxy-node-card__host m-0">
          {{ hostLabel }}
        </h3>
        <div class="qs-proxy-node-card__meta">
          <span>{{ typeLabel }}</span>
          <span aria-hidden="true">·</span>
          <span>{{ node.ipVersion }}</span>
          <template v-if="publicIpLabel">
            <span aria-hidden="true">·</span>
            <span>{{ publicIpLabel }}</span>
          </template>
        </div>
      </div>

      <div class="qs-proxy-node-card__credentials">
        <div class="qs-proxy-node-card__credential">
          <span class="qs-proxy-node-card__label">账号</span>
          <span class="qs-proxy-node-card__value">{{ node.username }}</span>
        </div>
        <div class="qs-proxy-node-card__credential">
          <span class="qs-proxy-node-card__label">密码</span>
          <span class="qs-proxy-node-card__value">{{ node.password || '—' }}</span>
        </div>
        <div class="qs-proxy-node-card__meta">
          {{ autoExtendLabel }}
        </div>
        <p v-if="node.credentialUnavailable" class="text-xs text-destructive m-0">
          凭证解密失败，请重新同步
        </p>
      </div>

      <div class="qs-proxy-node-card__expiry">
        <span class="qs-proxy-node-card__label">到期</span>
        <DateTimeDisplay :value="node.expiresAt" format="datetime" />
        <QsProxyNodeCountdown :expires-at="node.expiresAt" />
      </div>
    </div>

    <div class="qs-proxy-node-card__footer px-4 py-3 border-t border-border bg-muted/20 flex flex-wrap gap-3 items-center">
      <div v-if="isManagement" class="flex gap-2 min-w-0 items-center">
        <span class="qs-proxy-node-card__label">绑定</span>
        <QsPersonDisplay
          v-if="node.assignedUser"
          :display-name="node.assignedUser.displayName"
          :avatar-url="node.assignedUser.avatarUrl"
          size="sm"
        />
        <span v-else class="text-sm text-muted-foreground">未绑定</span>
      </div>

      <div class="qs-proxy-node-card__meta">
        <span v-if="node.boughtAt">
          购买 <DateTimeDisplay :value="node.boughtAt" format="date" />
        </span>
        <span v-if="node.lastRenewedAt">
          最近续费 <DateTimeDisplay :value="node.lastRenewedAt" format="date" />
        </span>
        <span>
          最近同步 <DateTimeDisplay :value="node.lastSyncedAt" format="datetime" />
        </span>
      </div>

      <div class="ml-auto flex flex-wrap gap-3 items-center">
        <QsProxyNodeWarning :expires-at="node.expiresAt" :mode="mode" />
        <template v-if="isManagement">
          <FaTooltip v-if="copyDisabledReason" :text="copyDisabledReason">
            <span class="inline-flex" tabindex="0">
              <FaButton size="sm" variant="outline" disabled>
                <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />
                复制配置
              </FaButton>
            </span>
          </FaTooltip>
          <FaButton
            v-else
            size="sm"
            variant="outline"
            :disabled="busy"
            @click="copy"
          >
            <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />
            复制配置
          </FaButton>
        </template>
      </div>
    </div>
  </FaCard>
</template>

<style scoped>
/* 卡片自身是容器：页面侧边栏或未来栅格变化时，宽窄形态仍按实际卡片宽度判断。 */
.qs-proxy-node-card {
  container-type: inline-size;
}

.qs-proxy-node-card__protocol {
  padding: 0.125rem 0.375rem;
  font-size: 0.6875rem;
  font-weight: var(--qs-type-weight-medium, 500);
  line-height: 1rem;
  color: oklch(var(--muted-foreground));
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  border: 1px solid oklch(var(--border));
  border-radius: 0.25rem;
}

.qs-proxy-node-card__body {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) 15rem;
  gap: 1rem;
  align-items: start;
}

.qs-proxy-node-card__host {
  font-family: var(--qs-font-mono);
  font-size: 1.125rem;
  font-weight: var(--qs-type-weight-semibold, 600);
  line-height: 1.5rem;
  overflow-wrap: anywhere;
}

.qs-proxy-node-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  font-size: var(--qs-type-size-xs);
  line-height: 1rem;
  color: oklch(var(--muted-foreground));
}

.qs-proxy-node-card__credentials {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 0;
}

.qs-proxy-node-card__credential {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  min-width: 0;
}

.qs-proxy-node-card__label {
  flex: none;
  font-size: var(--qs-type-size-xs);
  line-height: 1rem;
  color: oklch(var(--muted-foreground));
  white-space: nowrap;
}

.qs-proxy-node-card__value {
  min-width: 0;
  font-family: var(--qs-font-mono);
  font-size: 0.875rem;
  font-weight: var(--qs-type-weight-medium, 500);
  line-height: 1.25rem;
  overflow-wrap: anywhere;
  user-select: all;
}

.qs-proxy-node-card__expiry {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: flex-start;
  min-width: 0;
}

@container (width < 56rem) {
  .qs-proxy-node-card__body {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .qs-proxy-node-card__expiry {
    grid-column: 1 / -1;
  }
}

@container (width < 36rem) {
  .qs-proxy-node-card__body {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
