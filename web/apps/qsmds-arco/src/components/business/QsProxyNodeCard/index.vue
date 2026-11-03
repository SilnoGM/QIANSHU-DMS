<script setup lang="ts">
import type { ProxyNodeDto } from '../../../api/generated/types.gen'
import type { ProxyNodeCardMode } from './logic'
import { EMPTY_DATE_TIME_TEXT, formatDateTime } from '@/components/base/DateTimeDisplay/format'
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
const assignToneClass = computed(() => (
  isAssigned.value
    ? 'text-sky-600 dark:text-sky-400'
    : 'text-primary'
))
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
const boughtAtLabel = computed(() => (
  props.node.boughtAt === null
    ? EMPTY_DATE_TIME_TEXT
    : formatDateTime(props.node.boughtAt, 'date')
))
const lastRenewedAtLabel = computed(() => (
  props.node.lastRenewedAt === null
    ? EMPTY_DATE_TIME_TEXT
    : formatDateTime(props.node.lastRenewedAt, 'date')
))

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
    <header class="px-5 py-3 flex flex-wrap gap-2 items-center">
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
            <button
              type="button"
              class="qs-proxy-node-card__link inline-flex gap-1 items-center"
              :class="assignToneClass"
              disabled
            >
              <FaIcon name="i-lucide:link" class="size-3.5" aria-hidden="true" />
              {{ assignLabel }}
            </button>
          </span>
        </FaTooltip>
        <button
          v-else
          type="button"
          class="qs-proxy-node-card__link inline-flex gap-1 items-center"
          :class="assignToneClass"
          :disabled="busy"
          @click="emit('assign')"
        >
          <FaIcon name="i-lucide:link" class="size-3.5" aria-hidden="true" />
          {{ assignLabel }}
        </button>

        <button
          v-if="isAssigned"
          type="button"
          class="qs-proxy-node-card__link text-destructive inline-flex gap-1 items-center"
          :disabled="busy"
          @click="emit('release')"
        >
          <FaIcon name="i-lucide:unlink" class="size-3.5" aria-hidden="true" />
          解绑
        </button>
      </div>
    </header>

    <div class="qs-proxy-node-card__body px-5 py-4 flex-1">
      <div class="qs-proxy-node-card__identity">
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
          到期: <time :datetime="node.expiresAt" class="tabular-nums">{{ expiresAtLabel }}</time>
        </span>
      </div>
    </div>

    <footer class="qs-proxy-node-card__footer px-5 py-3 border-t border-border bg-muted/30 flex flex-wrap gap-x-4 gap-y-2 items-center justify-between">
      <div v-if="hasPurchaseMeta" class="text-xs text-muted-foreground inline-flex flex-wrap gap-x-2 gap-y-1 items-baseline">
        <span v-if="node.boughtAt">
          购买: <time :datetime="node.boughtAt" class="tabular-nums">{{ boughtAtLabel }}</time>
        </span>
        <span v-if="node.boughtAt && node.lastRenewedAt" aria-hidden="true">·</span>
        <span v-if="node.lastRenewedAt">
          续费: <time :datetime="node.lastRenewedAt" class="tabular-nums">{{ lastRenewedAtLabel }}</time>
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

.qs-proxy-node-card__link {
  padding: 0;
  font: inherit;
  font-weight: var(--qs-type-weight-medium, 500);
  cursor: pointer;
  background: transparent;
  border: 0;
}

.qs-proxy-node-card__link:hover:not(:disabled) {
  text-decoration: underline;
}

.qs-proxy-node-card__link:disabled {
  color: oklch(var(--muted-foreground));
  cursor: not-allowed;
}

.qs-proxy-node-card__body {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  align-items: center;
  justify-content: space-between;
}

.qs-proxy-node-card__identity {
  flex: 1 1 20rem;
  min-width: 0;
}

.qs-proxy-node-card__host {
  font-family: var(--qs-font-mono);
  font-size: 1.5rem;
  font-weight: var(--qs-type-weight-bold, 700);
  line-height: 2rem;
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
    font-size: 1.875rem;
    line-height: 2.5rem;
  }
}

@container (width < 36rem) {
  .qs-proxy-node-card__expiry {
    flex-basis: 100%;
  }
}
</style>
