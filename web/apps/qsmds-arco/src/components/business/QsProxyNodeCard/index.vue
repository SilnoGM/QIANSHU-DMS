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
const passwordVisible = ref(true)

const countryLabel = computed(() => resolveProxyNodeCountryLabel(props.node))
const typeLabel = computed(() => resolveProxyNodeTypeLabel(props.node.ipType))
const typeMeta = computed(() => `${typeLabel.value} · ${props.node.ipVersion}`)
const protocolLabel = computed(() => resolveProxyNodeProtocolLabel(props.node.protocol))
const hostLabel = computed(() => resolveProxyNodeHostLabel(props.node))
const publicIpLabel = computed(() => resolveProxyNodePublicIpLabel(props.node))
const autoExtendLabel = computed(() => props.node.autoExtend ? '已开启' : '未开启')
const isManagement = computed(() => props.mode === 'management')
const isAssigned = computed(() => props.node.assignedUser !== null)
const canCopy = computed(() => isProxyNodeCredentialAvailable(props.node))
const assignLabel = computed(() => isAssigned.value ? '改绑' : '去绑定 →')
const hasPurchaseMeta = computed(() => props.node.boughtAt !== null || props.node.lastRenewedAt !== null)
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

async function writeClipboard(text: string, successMessage: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API is unavailable')
    }
    await navigator.clipboard.writeText(text)
    toast.success(successMessage)
  }
  catch {
    // 不把凭据内容或浏览器权限细节写入日志，失败只反馈当前用户。
    toast.error('复制失败，请手动选择字段')
  }
}

function copyAddress(): void {
  void writeClipboard(hostLabel.value, '代理地址已复制')
}

function copyUsername(): void {
  void writeClipboard(props.node.username, '账号已复制')
}

function copyPassword(): void {
  if (!canCopy.value) {
    return
  }
  void writeClipboard(props.node.password, '密码已复制')
}

async function copy(): Promise<void> {
  if (!canCopy.value) {
    return
  }
  await writeClipboard(buildProxyNodeCopyText(props.node), '节点配置已复制')
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
    <header class="px-4 py-3 border-b border-border flex flex-wrap gap-2 items-center">
      <span class="qs-proxy-node-card__country text-xs text-foreground font-medium px-2 py-1 border border-border rounded-md bg-muted/40 whitespace-nowrap">
        <FaIcon name="i-lucide:map-pin" class="text-primary size-3.5" aria-hidden="true" />
        {{ countryLabel }}
      </span>
      <span class="qs-proxy-node-card__protocol text-[11px] text-sky-700 tracking-wide font-semibold px-2 py-1 border border-sky-500/20 rounded-md bg-sky-500/10 whitespace-nowrap uppercase dark:text-sky-400 dark:border-sky-400/30 dark:bg-sky-400/10">
        {{ protocolLabel }}
      </span>
      <QsProxyNodeStatusTag :expires-at="node.expiresAt" />
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

      <div class="ml-auto flex flex-wrap gap-2 items-center">
        <div
          v-if="isManagement"
          class="text-xs px-2.5 py-1.5 border border-border rounded-lg bg-muted/30 inline-flex flex-wrap gap-1.5 items-center"
        >
          <span class="text-muted-foreground">绑定状态：</span>
          <template v-if="node.assignedUser">
            <span class="text-foreground">已绑定</span>
            <QsPersonDisplay
              :display-name="node.assignedUser.displayName"
              :avatar-url="node.assignedUser.avatarUrl"
              size="sm"
            />
          </template>
          <span v-else class="text-foreground">未绑定</span>

          <FaTooltip v-if="actionDisabledReason" :text="actionDisabledReason">
            <span class="inline-flex" tabindex="0">
              <button
                type="button"
                class="qs-proxy-node-card__link"
                disabled
              >
                {{ assignLabel }}
              </button>
            </span>
          </FaTooltip>
          <button
            v-else
            type="button"
            class="qs-proxy-node-card__link"
            :disabled="busy"
            @click="emit('assign')"
          >
            {{ assignLabel }}
          </button>
        </div>

        <FaDropdown
          v-if="isManagement && isAssigned"
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

        <FaTooltip v-if="copyDisabledReason" :text="copyDisabledReason">
          <span class="inline-flex" tabindex="0">
            <FaButton size="sm" disabled>
              <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />
              复制完整配置
            </FaButton>
          </span>
        </FaTooltip>
        <FaButton
          v-else
          size="sm"
          @click="copy"
        >
          <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />
          复制完整配置
        </FaButton>
      </div>
    </header>

    <div class="qs-proxy-node-card__body p-4 flex-1">
      <div class="flex flex-col gap-1 min-w-0">
        <span class="text-xs text-muted-foreground">代理地址 (IP:Port)</span>
        <div class="flex gap-2 min-w-0 items-center">
          <h3 :id="hostId" class="qs-proxy-node-card__host m-0">
            {{ hostLabel }}
          </h3>
          <FaButton
            variant="ghost"
            size="icon-sm"
            class="text-muted-foreground shrink-0"
            aria-label="复制代理地址"
            @click="copyAddress"
          >
            <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />
          </FaButton>
        </div>
        <div v-if="publicIpLabel" class="text-xs text-muted-foreground">
          {{ publicIpLabel }}
        </div>
      </div>

      <div class="qs-proxy-node-card__credential-panel">
        <div class="flex gap-3 min-w-0 items-center">
          <span class="text-xs text-muted-foreground shrink-0">账号</span>
          <div class="ml-auto flex gap-0.5 min-w-0 items-center justify-end">
            <span class="qs-proxy-node-card__value">{{ node.username }}</span>
            <FaButton
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground shrink-0"
              aria-label="复制账号"
              @click="copyUsername"
            >
              <FaIcon name="i-lucide:copy" class="size-3.5" aria-hidden="true" />
            </FaButton>
          </div>
        </div>

        <div class="flex gap-3 min-w-0 items-center">
          <span class="text-xs text-muted-foreground shrink-0">密码</span>
          <div class="ml-auto flex gap-0.5 min-w-0 items-center justify-end">
            <span class="qs-proxy-node-card__value">
              {{ passwordVisible ? (node.password || '—') : '••••••••' }}
            </span>
            <FaButton
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground shrink-0"
              :disabled="node.credentialUnavailable"
              :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
              @click="passwordVisible = !passwordVisible"
            >
              <FaIcon
                :name="passwordVisible ? 'i-lucide:eye-off' : 'i-lucide:eye'"
                class="size-3.5"
                aria-hidden="true"
              />
            </FaButton>
            <FaButton
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground shrink-0"
              :disabled="!canCopy"
              aria-label="复制密码"
              @click="copyPassword"
            >
              <FaIcon name="i-lucide:copy" class="size-3.5" aria-hidden="true" />
            </FaButton>
          </div>
        </div>

        <p v-if="node.credentialUnavailable" class="text-xs text-destructive m-0">
          凭证解密失败，请重新同步
        </p>
      </div>

      <div class="qs-proxy-node-card__expiry">
        <QsProxyNodeCountdown :expires-at="node.expiresAt" />
        <span class="text-xs text-muted-foreground inline-flex gap-1 items-baseline">
          到期：<DateTimeDisplay :value="node.expiresAt" format="datetime" />
        </span>
        <span class="text-xs text-muted-foreground inline-flex gap-1.5 items-center">
          自动续费
          <span
            class="text-[11px] font-medium px-1.5 py-0.5 rounded"
            :class="node.autoExtend ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
          >
            {{ autoExtendLabel }}
          </span>
        </span>
        <QsProxyNodeWarning :expires-at="node.expiresAt" :mode="mode" />
      </div>
    </div>

    <footer class="qs-proxy-node-card__footer px-4 py-3 border-t border-border bg-muted/20 flex flex-wrap gap-x-4 gap-y-2 items-center justify-between">
      <div v-if="hasPurchaseMeta" class="text-xs text-muted-foreground inline-flex flex-wrap gap-x-2 gap-y-1 items-baseline">
        <span v-if="node.boughtAt">
          购买时间：<DateTimeDisplay :value="node.boughtAt" format="date" />
        </span>
        <span v-if="node.boughtAt && node.lastRenewedAt" aria-hidden="true">·</span>
        <span v-if="node.lastRenewedAt">
          最近续费：<DateTimeDisplay :value="node.lastRenewedAt" format="date" />
        </span>
      </div>
      <div class="text-xs text-muted-foreground ml-auto inline-flex flex-wrap gap-1.5 items-center">
        <FaIcon name="i-lucide:refresh-cw" class="size-3.5" aria-hidden="true" />
        最近同步：<DateTimeDisplay :value="node.lastSyncedAt" format="datetime" />
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
  color: oklch(var(--primary));
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
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) 13rem;
  gap: 1.25rem;
  align-items: start;
}

.qs-proxy-node-card__host {
  font-family: var(--qs-font-mono);
  font-size: 1.375rem;
  font-weight: var(--qs-type-weight-bold, 700);
  line-height: 1.75rem;
  overflow-wrap: anywhere;
}

.qs-proxy-node-card__credential-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.75rem;
  background: oklch(var(--muted) / 25%);
  border: 1px solid oklch(var(--border));
  border-radius: 0.5rem;
}

.qs-proxy-node-card__value {
  min-width: 0;
  font-family: var(--qs-font-mono);
  font-size: 0.875rem;
  line-height: 1.25rem;
  text-align: right;
  overflow-wrap: anywhere;
  user-select: all;
}

.qs-proxy-node-card__expiry {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  align-items: flex-start;
  min-width: 0;
}

@container (min-width: 56rem) {
  .qs-proxy-node-card__host {
    font-size: 1.75rem;
    line-height: 2.25rem;
  }
}

@container (width < 56rem) {
  .qs-proxy-node-card__body {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .qs-proxy-node-card__expiry {
    flex-flow: row wrap;
    grid-column: 1 / -1;
    gap: 0.5rem 1rem;
    align-items: center;
  }
}

@container (width < 36rem) {
  .qs-proxy-node-card__body {
    grid-template-columns: minmax(0, 1fr);
  }

  .qs-proxy-node-card__expiry {
    grid-column: auto;
  }
}
</style>
